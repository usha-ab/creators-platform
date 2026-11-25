import { randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPastEvent } from "@/lib/listings/sale-state";
import { decideSwishBooking, SWISH_LISTING_SELECT, type SwishListing } from "@/lib/swish/confirm";
import { SwishApiError, swishAmountToOre, type SwishClient, type SwishPaymentRequest } from "./client";
import type { SwishCommerceConfig } from "./config";

/**
 * Swish Handel: från vilande bokning till bekräftad, utan att någon trycker.
 *
 *   1. Biljettsidan ber om en betalning → startPayment() lägger en rad i
 *      swish_payment_requests och skapar betalningsförfrågan hos Swish (PUT).
 *   2. Gästen godkänner i Swish-appen.
 *   3. Swish anropar /api/swish/commerce/callback → handleCallback().
 *      Biljettsidan frågar samtidigt /status → pollBooking(), som hämtar
 *      förfrågan från Swish själv om callbacken dröjer.
 *   4. Båda vägarna slutar i applyRemote(), som bara litar på det Swish
 *      svarar på vår egen GET (mTLS), jämför id, mottagare, valuta och belopp
 *      mot raden vi skrev i steg 1, och först då anropar decideSwishBooking()
 *      — samma funktion som entréns Bekräfta.
 *
 * Swish signerar inte callbacken (v2). Skyddet är i stället:
 *   - callbackIdentifier: ett slumpat värde per förfrågan som bara vi och
 *     Swish känner till och som Swish skickar tillbaka som header.
 *   - Kroppen i callbacken används bara för att hitta raden. Status och belopp
 *     hämtas alltid med GET från Swish.
 *   - Allt är idempotent: bekräftelsen räknar bara när bokningen går från
 *     pending till confirmed, en gång.
 */

export const TABLE = "swish_payment_requests";

/** En betalningsförfrågan gäller ungefär tre minuter i appen. Återanvänd den lite kortare. */
const REUSE_MS = 150_000;
/** Polling: fråga Swish högst så här ofta per förfrågan. */
const POLL_EVERY_MS = 4_000;

export interface PaymentRow {
  id: string;
  booking_id: string;
  listing_id: string;
  env: string;
  payee_alias: string;
  amount_ore: number;
  callback_identifier: string;
  token: string | null;
  status: string;
  payment_reference: string | null;
  error_code: string | null;
  created_at: string;
  last_checked_at: string | null;
}

const ROW_FIELDS =
  "id, booking_id, listing_id, env, payee_alias, amount_ore, callback_identifier, token, status, payment_reference, error_code, created_at, last_checked_at";

/** Swishs instructionUUID: 32 tecken 0-9A-F. */
export function newInstructionId(): string {
  return randomUUID().replace(/-/g, "").toUpperCase();
}

/** callbackIdentifier: 32–36 tecken [0-9a-zA-Z-]. Ett nytt per förfrågan. */
export function newCallbackIdentifier(): string {
  return randomUUID().replace(/-/g, "").toUpperCase();
}

export const INSTRUCTION_ID = /^[0-9A-F]{32}$/;

/**
 * Meddelandet i Swish-appen: kväll, datum och bokningsreferens. Swish tillåter
 * bara a-ö A-Ö 0-9, mellanslag och !?(),.-:; och högst 50 tecken. Ett
 * snedstreck ger RP02 i MSS, därför "26-11" och inte "26/11".
 */
export function commerceMessage(title: string, eventDate: string | null, bookingId: string): string {
  const ref = ` ref ${bookingId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const date = eventDate ? ` ${eventDate.slice(8, 10)}-${eventDate.slice(5, 7)}` : "";
  const clean = (s: string) => s.replace(/[^a-zA-ZåäöÅÄÖéÉüÜ0-9 !?(),.\-:;]/g, " ").replace(/\s+/g, " ").trim();
  const short = clean(title.replace(/\s*[–-]\s.*$/, "")) || clean(title) || "Usha";
  const room = 50 - ref.length - date.length;
  return `${short.slice(0, Math.max(1, room)).trim()}${date}${ref}`.slice(0, 50);
}

/** payeePaymentReference: bokningens id utan bindestreck (32 tecken, a-z0-9). */
export function paymentReferenceFor(bookingId: string): string {
  return bookingId.replace(/-/g, "").slice(0, 35);
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Stämmer Swishs svar med raden vi skrev? Allt annat än ja = ingen bekräftelse. */
export function verifyRemote(row: Pick<PaymentRow, "id" | "payee_alias" | "amount_ore">, remote: SwishPaymentRequest): string | null {
  if (String(remote.id ?? "").toUpperCase() !== row.id) return "id";
  if (String(remote.payeeAlias ?? "").replace(/\D/g, "") !== row.payee_alias) return "payee";
  if (remote.currency !== "SEK") return "currency";
  if (swishAmountToOre(remote.amount) !== row.amount_ore) return "amount";
  return null;
}

export type ApplyOutcome =
  | { outcome: "confirmed"; bookingId: string }
  | { outcome: "alreadyHandled"; bookingId: string }
  | { outcome: "notPaid"; status: string }
  | { outcome: "waiting" }
  | { outcome: "mismatch"; field: string };

/**
 * Stäm av en rad mot Swishs eget svar. Anropas av både callback och polling,
 * hur många gånger som helst: bara den första som flyttar bokningen från
 * pending till confirmed räknar och mejlar (decideSwishBooking).
 */
export async function applyRemote(admin: SupabaseClient, row: PaymentRow, remote: SwishPaymentRequest): Promise<ApplyOutcome> {
  const mismatch = verifyRemote(row, remote);
  if (mismatch) {
    console.error(`Swish Handel: svaret stämmer inte med förfrågan (${mismatch}), bokningen bekräftas inte`, { requestId: row.id, bookingId: row.booking_id });
    await admin.from(TABLE).update({ status: "MISMATCH", error_code: `mismatch:${mismatch}`, updated_at: new Date().toISOString() }).eq("id", row.id).neq("status", "PAID");
    return { outcome: "mismatch", field: mismatch };
  }

  const status = String(remote.status ?? "").toUpperCase();
  const nowIso = new Date().toISOString();

  if (status === "CREATED") return { outcome: "waiting" };

  if (status !== "PAID") {
    await admin
      .from(TABLE)
      .update({ status, error_code: remote.errorCode ?? null, updated_at: nowIso })
      .eq("id", row.id)
      .eq("status", "CREATED");
    return { outcome: "notPaid", status };
  }

  const { error: paidError } = await admin
    .from(TABLE)
    .update({ status: "PAID", payment_reference: remote.paymentReference ?? null, paid_at: remote.datePaid ?? nowIso, updated_at: nowIso })
    .eq("id", row.id)
    .neq("status", "PAID");
  // Unikt index: högst en PAID per bokning. Slår det i har gästen betalat två gånger.
  if (paidError) {
    console.error("Swish Handel: kunde inte markera betald, möjlig dubbelbetalning — återbetala för hand", { requestId: row.id, bookingId: row.booking_id, code: paidError.code });
  }

  const { data: listing } = await admin.from("listings").select(SWISH_LISTING_SELECT).eq("id", row.listing_id).maybeSingle();
  if (!listing) {
    console.error("Swish Handel: betald men evenemanget saknas", { requestId: row.id, bookingId: row.booking_id });
    return { outcome: "alreadyHandled", bookingId: row.booking_id };
  }

  // Beloppet i bokningen måste vara det vi bad Swish om. decideSwishBooking
  // jämför inte belopp; det gör vi här, mot raden och mot bokningen.
  const { data: current } = await admin.from("bookings").select("status, amount_paid").eq("id", row.booking_id).maybeSingle();
  if (current?.status === "pending" && Number(current.amount_paid) !== row.amount_ore) {
    console.error("Swish Handel: betalt belopp stämmer inte med bokningen, bekräftas inte", { requestId: row.id, bookingId: row.booking_id });
    return { outcome: "mismatch", field: "bookingAmount" };
  }

  const result = await decideSwishBooking(admin, {
    listing: listing as SwishListing,
    bookingId: row.booking_id,
    action: "confirm",
    decidedBy: "Swish Handel",
    via: `automatiskt (betalning ${remote.paymentReference ?? row.id})`,
  });
  if (result.ok) return { outcome: "confirmed", bookingId: row.booking_id };

  // Inte vilande längre (notPending), eller någon annan hann före mellan
  // läsning och uppdatering (updateFailed). Vanligast: dubbel callback eller
  // polling samtidigt. Men om bokningen hunnit avbokas (entrén avvisade) har
  // gästen betalat för en biljett hen inte har — det måste någon se och betala tillbaka.
  const { data: b } = await admin.from("bookings").select("status").eq("id", row.booking_id).maybeSingle();
  if (b?.status === "confirmed" || b?.status === "completed") return { outcome: "alreadyHandled", bookingId: row.booking_id };
  if (b && b.status !== "pending") {
    console.error("Swish Handel: betald men bokningen är inte vilande, återbetala för hand", { requestId: row.id, bookingId: row.booking_id, status: b.status });
    return { outcome: "alreadyHandled", bookingId: row.booking_id };
  }
  console.error(`Swish Handel: bekräftelsen misslyckades (${result.error})`, { requestId: row.id, bookingId: row.booking_id });
  return { outcome: "mismatch", field: result.error };
}

export type StartResult =
  | { ok: true; instructionId: string; token: string; reused: boolean }
  | { ok: false; error: "notPending" | "noAmount" | "unavailable" | "past" | "alreadyPaid" | "swishFailed"; codes?: string[] };

/** Skapa (eller återanvänd) en betalningsförfrågan för en vilande Swish-bokning. */
export async function startPayment(
  admin: SupabaseClient,
  client: SwishClient,
  cfg: SwishCommerceConfig,
  bookingId: string,
  now: Date = new Date(),
): Promise<StartResult> {
  const { data: booking } = await admin
    .from("bookings")
    .select("id, listing_id, status, payment_method, amount_paid")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking || booking.status !== "pending" || booking.payment_method !== "swish") return { ok: false, error: "notPending" };
  const amountOre = Number(booking.amount_paid ?? 0);
  if (!(amountOre >= 100)) return { ok: false, error: "noAmount" };

  const { data: listing } = await admin
    .from("listings")
    .select("id, user_id, title, event_date, event_time, event_end_time, is_active")
    .eq("id", booking.listing_id)
    .maybeSingle();
  if (!listing || !listing.is_active) return { ok: false, error: "unavailable" };
  if (isPastEvent(listing.event_date, now, listing)) return { ok: false, error: "past" };
  // Pengarna landar på Usha AB:s konto. Samma regel som Swish Företag.
  const { data: owner } = await admin.from("profiles").select("is_usha_owned_seller").eq("id", listing.user_id).maybeSingle();
  if (!owner?.is_usha_owned_seller) return { ok: false, error: "unavailable" };

  const { data: rows } = await admin
    .from(TABLE)
    .select(ROW_FIELDS)
    .eq("booking_id", booking.id)
    .order("created_at", { ascending: false })
    .limit(5);
  const list = (rows ?? []) as PaymentRow[];
  if (list.some((r) => r.status === "PAID")) return { ok: false, error: "alreadyPaid" };
  const fresh = list.find(
    (r) => r.status === "CREATED" && r.token && r.amount_ore === amountOre && r.env === cfg.env && now.getTime() - Date.parse(r.created_at) < REUSE_MS,
  );
  if (fresh?.token) return { ok: true, instructionId: fresh.id, token: fresh.token, reused: true };

  const instructionId = newInstructionId();
  const callbackIdentifier = newCallbackIdentifier();
  const { error: insertError } = await admin.from(TABLE).insert({
    id: instructionId,
    booking_id: booking.id,
    listing_id: listing.id,
    env: cfg.env,
    payee_alias: cfg.payeeAlias,
    amount_ore: amountOre,
    callback_identifier: callbackIdentifier,
    status: "CREATED",
  });
  if (insertError) {
    console.error("Swish Handel: kunde inte spara förfrågan", insertError.message);
    return { ok: false, error: "swishFailed" };
  }

  try {
    const { token } = await client.create({
      instructionId,
      amountOre,
      message: commerceMessage(listing.title, listing.event_date, booking.id),
      payeePaymentReference: paymentReferenceFor(booking.id),
      callbackIdentifier,
    });
    if (!token) throw new SwishApiError(201, ["NO_TOKEN"]);
    await admin.from(TABLE).update({ token, updated_at: new Date().toISOString() }).eq("id", instructionId);
    return { ok: true, instructionId, token, reused: false };
  } catch (e) {
    const codes = e instanceof SwishApiError ? e.codes : [];
    const status = e instanceof SwishApiError ? e.status : 0;
    console.error(`Swish Handel: PUT misslyckades (${status}${codes.length ? ` ${codes.join(",")}` : ""})`);
    await admin
      .from(TABLE)
      .update({ status: "ERROR", error_code: codes[0] ?? `http:${status}`, updated_at: new Date().toISOString() })
      .eq("id", instructionId);
    return { ok: false, error: "swishFailed", codes };
  }
}

export type CallbackResult = { http: number; body: Record<string, unknown> };

/**
 * Swish anropar callbackUrl. Svarar 200 när vi är klara (annars försöker
 * Swish igen, upp till tio gånger), 401 när callbackIdentifier inte stämmer.
 */
export async function handleCallback(
  admin: SupabaseClient,
  client: SwishClient,
  body: unknown,
  callbackIdentifierHeader: string | null,
): Promise<CallbackResult> {
  const id = String((body as { id?: unknown } | null)?.id ?? "").toUpperCase();
  if (!INSTRUCTION_ID.test(id)) return { http: 400, body: { error: "badRequest" } };

  const { data } = await admin.from(TABLE).select(ROW_FIELDS).eq("id", id).maybeSingle();
  const row = data as PaymentRow | null;
  // Okänd förfrågan: inte vår. 200 så att Swish slutar försöka; inget händer.
  if (!row) return { http: 200, body: { ignored: true } };
  if (!callbackIdentifierHeader || !safeEqual(callbackIdentifierHeader, row.callback_identifier)) {
    console.error("Swish Handel: callback med fel callbackIdentifier", { requestId: id });
    return { http: 401, body: { error: "unauthorized" } };
  }

  let remote: SwishPaymentRequest | null;
  try {
    remote = await client.get(id);
  } catch (e) {
    console.error("Swish Handel: GET efter callback misslyckades", e instanceof Error ? e.message : e);
    return { http: 503, body: { error: "retry" } }; // Swish försöker igen
  }
  if (!remote) return { http: 503, body: { error: "retry" } };

  const r = await applyRemote(admin, row, remote);
  await admin.from(TABLE).update({ last_checked_at: new Date().toISOString() }).eq("id", id);
  return { http: 200, body: { ok: true, outcome: r.outcome } };
}

export type PollState = "confirmed" | "canceled" | "waiting" | "declined" | "error" | "none";

/**
 * Biljettsidan frågar. Är bokningen redan bekräftad: klart. Annars, om den
 * senaste förfrågan fortfarande står som skapad, fråga Swish själv (högst
 * var fjärde sekund) — reserven om callbacken uteblir.
 */
export async function pollBooking(
  admin: SupabaseClient,
  client: SwishClient | null,
  bookingId: string,
  now: Date = new Date(),
): Promise<{ state: PollState; status?: string; errorCode?: string | null }> {
  const readBooking = async () => {
    const { data } = await admin.from("bookings").select("id, status, payment_method").eq("id", bookingId).maybeSingle();
    return data as { id: string; status: string; payment_method: string | null } | null;
  };
  const b = await readBooking();
  if (!b || b.payment_method !== "swish") return { state: "none" };
  if (b.status === "confirmed" || b.status === "completed") return { state: "confirmed" };
  if (b.status === "canceled" || b.status === "cancelled") return { state: "canceled" };

  const { data } = await admin
    .from(TABLE)
    .select(ROW_FIELDS)
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as PaymentRow | null;
  if (!row) return { state: "none" };

  if (row.status === "CREATED" && client) {
    const last = row.last_checked_at ? Date.parse(row.last_checked_at) : 0;
    const age = now.getTime() - Date.parse(row.created_at);
    if (age > 3_000 && now.getTime() - last > POLL_EVERY_MS) {
      await admin.from(TABLE).update({ last_checked_at: now.toISOString() }).eq("id", row.id);
      try {
        const remote = await client.get(row.id);
        if (remote) {
          const r = await applyRemote(admin, row, remote);
          if (r.outcome === "confirmed" || r.outcome === "alreadyHandled") {
            const again = await readBooking();
            if (again?.status === "confirmed") return { state: "confirmed" };
          }
          if (r.outcome === "notPaid") return mapStatus(r.status, remote.errorCode ?? null);
          if (r.outcome === "mismatch") return { state: "error", status: "MISMATCH" };
        }
      } catch (e) {
        console.error("Swish Handel: GET vid polling misslyckades", e instanceof Error ? e.message : e);
      }
    }
    return { state: "waiting" };
  }
  if (row.status === "PAID") {
    // Betald men bokningen inte bekräftad än: bekräftelsen kör i callbacken just nu.
    return { state: "waiting", status: "PAID" };
  }
  return mapStatus(row.status, row.error_code);
}

function mapStatus(status: string, errorCode: string | null): { state: PollState; status: string; errorCode: string | null } {
  // BANKIDCL = gästen avbröt i BankID. Swish rapporterar det som ERROR, men för gästen är det ett nej.
  if (status === "DECLINED" || status === "CANCELLED" || errorCode === "BANKIDCL") return { state: "declined", status, errorCode };
  return { state: "error", status, errorCode };
}

/** Token för QR-bilden, bara för en färsk förfrågan som fortfarande väntar. */
export async function tokenForQr(admin: SupabaseClient, instructionId: string, now: Date = new Date()): Promise<string | null> {
  if (!INSTRUCTION_ID.test(instructionId)) return null;
  const { data } = await admin.from(TABLE).select("token, status, created_at").eq("id", instructionId).maybeSingle();
  const row = data as { token: string | null; status: string; created_at: string } | null;
  if (!row?.token || row.status !== "CREATED") return null;
  if (now.getTime() - Date.parse(row.created_at) > 6 * 60_000) return null;
  return row.token;
}
