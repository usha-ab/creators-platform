import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isPassBooking,
  passExpired,
  passRemaining,
  passSeriesIds,
  pickOccurrence,
  seriesOccurrences,
  sliceColumns,
  sliceForNextClip,
  type Occurrence,
} from "@/lib/passes/series-pass";

/**
 * Incheckningen, utbruten ur /api/tickets/checkin.
 *
 * Två vägar in: dörren (skannern, kiosken — någon med skanningsrätt) och
 * gästen själv (/api/tickets/self-checkin, biljettlänken). Reglerna för VAD
 * som får checkas in är desamma; det som skiljer är VEM som får göra det, och
 * det avgör anroparen. Funktionerna här svarar med { status, body } och vet
 * inget om HTTP i övrigt, så att båda rutterna ger exakt samma svar.
 *
 * actorId är den som checkar in. null = gästen själv; då skrivs scanned_by
 * som null (kolumnen är nullable i bookings, ticket_attendees och
 * pass_redemptions — ingen migration behövs).
 */

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface CheckinResult {
  status: number;
  body: Record<string, unknown>;
}

export const CHECKIN_BOOKING_SELECT =
  "id, status, creator_id, customer_id, checked_in_at, listing_id, guest_count, sessions_total, sessions_redeemed, pass_expires_at, amount_paid, platform_fee_amount, credit_applied_ore, payment_method, refunded_at, listings(title, event_date, event_time, event_end_time, pass_series_id, pass_series_ids)";

export interface CheckinBooking {
  id: string;
  status: string;
  creator_id: string;
  customer_id?: string | null;
  checked_in_at: string | null;
  listing_id: string;
  guest_count: number | null;
  sessions_total: number | null;
  sessions_redeemed: number | null;
  pass_expires_at?: string | null;
  amount_paid: number | null;
  platform_fee_amount: number | null;
  credit_applied_ore: number | null;
  payment_method?: string | null;
  refunded_at?: string | null;
  listings?: CheckinListing | CheckinListing[] | null;
}

/** Den inbäddade listing-raden ur CHECKIN_BOOKING_SELECT. */
export interface CheckinListing {
  title?: string | null;
  event_date?: string | null;
  event_time?: string | null;
  event_end_time?: string | null;
}

const ok = (body: Record<string, unknown>, status = 200): CheckinResult => ({ status, body });

function titleOf(booking: CheckinBooking, t: Translate): string {
  const l = Array.isArray(booking.listings) ? booking.listings[0] : booking.listings;
  return l?.title || t("bookingFallback");
}

/**
 * Är bokningen betald, så att den får släppa in någon?
 *
 * confirmed eller completed. pending är aldrig betald — det gäller både en
 * Stripe-betalning som inte gått igenom och en Swish från eventsidan som
 * ingen i entrén bekräftat än (payment_method 'swish', status 'pending').
 * En återbetald bokning släpper inte in någon, oavsett status.
 */
export function isPaidBooking(b: Pick<CheckinBooking, "status" | "refunded_at">): boolean {
  if (b.refunded_at) return false;
  return b.status === "confirmed" || b.status === "completed";
}

/** Felsvaret för en obetald bokning, samma texter som enkelbiljetten alltid haft. */
export function notPaid(booking: CheckinBooking, t: Translate): CheckinResult {
  return ok({
    success: false,
    error:
      booking.status === "pending"
        ? t("notConfirmedYet")
        : booking.status === "canceled"
          ? t("bookingCanceled")
          : t("cannotCheckIn"),
    status: booking.status,
  });
}

/** En biljett, en person. */
export async function checkInBooking(opts: {
  admin: SupabaseClient;
  booking: CheckinBooking;
  actorId: string | null;
  t: Translate;
  now?: Date;
}): Promise<CheckinResult> {
  const { admin, booking, actorId, t } = opts;
  const title = titleOf(booking, t);

  if (booking.checked_in_at) {
    return ok({ success: false, alreadyCheckedIn: true, checkedInAt: booking.checked_in_at, title });
  }
  // Enkelbiljetten kräver confirmed — completed utan checked_in_at är en
  // bokning som avslutats på annat sätt och ska inte släppa in någon nu.
  if (booking.status !== "confirmed" || booking.refunded_at) return notPaid(booking, t);

  const now = (opts.now ?? new Date()).toISOString();
  // Atomärt: bara om ingen hann före (två telefoner i dörren, eller gästen
  // och dörren samtidigt).
  const { data: claimed, error } = await admin
    .from("bookings")
    .update({ checked_in_at: now, status: "completed", scanned_by: actorId })
    .eq("id", booking.id)
    .is("checked_in_at", null)
    .select("id")
    .maybeSingle();
  if (error) return ok({ error: t("couldNotCheckIn") }, 500);
  if (!claimed) return ok({ success: false, alreadyCheckedIn: true, title });
  return ok({ success: true, title, checkedInAt: now });
}

export interface AttendeeOutcome {
  id: string;
  label: string;
  result: "checked_in" | "already" | "not_found";
  checkedInAt: string | null;
}

/**
 * Flerbiljettsorder: checka in en eller flera av deltagarna. Bokningen blir
 * completed först när alla är inne.
 *
 * Med ett id ges samma svar som dörren alltid gett. Med flera (gästen checkar
 * in sällskapet) lyckas anropet om minst en checkades in, och `attendees`
 * säger hur det gick för var och en.
 */
export async function checkInAttendees(opts: {
  admin: SupabaseClient;
  booking: CheckinBooking;
  attendeeIds: string[];
  actorId: string | null;
  t: Translate;
  now?: Date;
}): Promise<CheckinResult> {
  const { admin, booking, actorId, t } = opts;
  const title = titleOf(booking, t);
  const ids = [...new Set(opts.attendeeIds.filter(Boolean))];

  if (ids.length === 0) return ok({ success: false, error: t("scanIndividual") });
  // Felet som lagas här: flerbiljettsvägen kollade bara 'canceled', så en
  // vilande bokning (obetald Stripe eller obekräftad Swish) gick att checka
  // in. Nu samma krav som enkelbiljetten: betald.
  if (!isPaidBooking(booking)) return notPaid(booking, t);

  const { data: rows } = await admin
    .from("ticket_attendees")
    .select("id, idx, name, checked_in_at")
    .eq("booking_id", booking.id)
    .in("id", ids);
  const byId = new Map(((rows ?? []) as { id: string; idx: number; name: string | null; checked_in_at: string | null }[]).map((r) => [r.id, r]));

  if (ids.length === 1 && !byId.has(ids[0])) {
    return ok({ error: t("ticketNotFound") }, 404);
  }

  const now = (opts.now ?? new Date()).toISOString();
  const outcomes: AttendeeOutcome[] = [];
  for (const id of ids) {
    const a = byId.get(id);
    if (!a) {
      outcomes.push({ id, label: "", result: "not_found", checkedInAt: null });
      continue;
    }
    const label = a.name || t("guestLabel", { idx: a.idx, count: booking.guest_count ?? 1 });
    if (a.checked_in_at) {
      outcomes.push({ id, label, result: "already", checkedInAt: a.checked_in_at });
      continue;
    }
    const { data: claimed } = await admin
      .from("ticket_attendees")
      .update({ checked_in_at: now, scanned_by: actorId })
      .eq("id", a.id)
      .is("checked_in_at", null)
      .select("id")
      .maybeSingle();
    outcomes.push({ id, label, result: claimed ? "checked_in" : "already", checkedInAt: claimed ? now : a.checked_in_at });
  }

  const anyIn = outcomes.some((o) => o.result === "checked_in");
  if (anyIn) {
    const { count: remaining } = await admin
      .from("ticket_attendees")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", booking.id)
      .is("checked_in_at", null);
    if ((remaining ?? 0) === 0) {
      await admin.from("bookings").update({ checked_in_at: now, status: "completed" }).eq("id", booking.id);
    }
  }

  const first = outcomes.find((o) => o.result === "checked_in") ?? outcomes.find((o) => o.result === "already") ?? outcomes[0];
  if (anyIn) {
    return ok({ success: true, title, checkedInAt: now, attendeeLabel: first.label, attendees: outcomes });
  }
  return ok({
    success: false,
    alreadyCheckedIn: true,
    ...(first.checkedInAt ? { checkedInAt: first.checkedInAt } : {}),
    title,
    attendeeLabel: first.label,
    attendees: outcomes,
  });
}

/**
 * Klippkort på en serie: klipp kvällens tillfälle.
 *
 * `gate` får kvällens tillfälle och avgör om den som anropar får klippa just
 * det (dörren: skanningsrätt; gästen: incheckningsfönstret). Returnerar den
 * ett svar avbryts klippet med det svaret. Ordningen är densamma som förut:
 * behörighet → status → kväll → kvar → giltighet.
 */
export async function checkInSeriesPass(opts: {
  admin: SupabaseClient;
  booking: CheckinBooking;
  actorId: string | null;
  t: Translate;
  gate?: (today: Occurrence | null) => Promise<CheckinResult | null>;
  now?: Date;
}): Promise<CheckinResult> {
  const { admin, booking, actorId, t } = opts;
  const nowDate = opts.now ?? new Date();
  const { data: pass } = await admin
    .from("listings")
    .select("title, pass_series_id, pass_series_ids")
    .eq("id", booking.listing_id)
    .maybeSingle();
  const occurrences = await seriesOccurrences(admin, passSeriesIds(pass));
  const { today } = pickOccurrence(occurrences, nowDate);

  if (opts.gate) {
    const stop = await opts.gate(today);
    if (stop) return stop;
  }

  const title = today?.title ?? pass?.title ?? t("bookingFallback");
  if (booking.status !== "confirmed" || booking.refunded_at) {
    return ok({
      success: false,
      error: booking.status === "canceled" ? t("bookingCanceled") : t("cannotCheckIn"),
      status: booking.status,
    });
  }
  if (!today) return ok({ success: false, error: t("passNoEventToday") });
  const total = booking.sessions_total ?? 0;
  if (passRemaining(booking) <= 0) return ok({ success: false, error: t("passUsedUp") });
  // Utgånget kort. Kollas före klippet skrivs, annars hade raden i
  // pass_redemptions funnits och räknats med i avräkningen.
  if (passExpired(booking.pass_expires_at)) return ok({ success: false, error: t("passExpired") });

  // Ett SKANNAT klipp per kväll: det partiella unika indexet (booking,
  // tillfälle) where not is_manual är spärren mot dubbelklipp, oavsett om det
  // är dörren eller gästen som trycker. Klippets andel fryses på raden.
  const slice = await sliceForNextClip(admin, booking.id, booking);
  const now = nowDate.toISOString();
  const { error: clipError } = await admin
    .from("pass_redemptions")
    .insert({ booking_id: booking.id, listing_id: today.id, scanned_by: actorId, redeemed_at: now, ...sliceColumns(slice) });
  if (clipError) {
    if (clipError.code === "23505") {
      const { data: prev } = await admin
        .from("pass_redemptions")
        .select("redeemed_at")
        .eq("booking_id", booking.id)
        .eq("listing_id", today.id)
        .eq("is_manual", false)
        .maybeSingle();
      return ok({ success: false, alreadyCheckedIn: true, checkedInAt: prev?.redeemed_at ?? now, title, occurrenceId: today.id });
    }
    return ok({ error: t("couldNotCheckIn") }, 500);
  }

  // Räknaren härleds ur loggen i stället för att räknas upp: då kan två
  // samtidiga klipp aldrig tappa bort varandra.
  const { count } = await admin
    .from("pass_redemptions")
    .select("id", { count: "exact", head: true })
    .eq("booking_id", booking.id);
  const redeemed = count ?? (booking.sessions_redeemed ?? 0) + 1;
  await admin
    .from("bookings")
    .update({ sessions_redeemed: redeemed, ...(redeemed >= total ? { status: "completed" } : {}) })
    .eq("id", booking.id);

  return ok({ success: true, title, checkedInAt: now, passRemaining: Math.max(0, total - redeemed), occurrenceId: today.id });
}

export { isPassBooking };
