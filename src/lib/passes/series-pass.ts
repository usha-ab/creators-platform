import type { SupabaseClient } from "@supabase/supabase-js";
import { isEventDay, stockholmDay } from "@/lib/tickets/event-day";
import type { SettlementBookingRow } from "@/lib/settlements/aggregate";

/**
 * Klippkort på en eller flera serier.
 *
 * En bokning är ett klippkort när sessions_total > 0. Är kortets annons
 * (listing) kopplad till minst en serie fungerar QR-koden som biljett på
 * seriernas kvällar: ett klipp per kväll, loggat i pass_redemptions.
 */
export interface PassBookingLike {
  sessions_total: number | null;
  sessions_redeemed: number | null;
}

export function isPassBooking(b: PassBookingLike): boolean {
  return (b.sessions_total ?? 0) > 0;
}

export function passRemaining(b: PassBookingLike): number {
  return Math.max(0, (b.sessions_total ?? 0) - (b.sessions_redeemed ?? 0));
}

/**
 * Giltighetstiden på ett klippkort: lika många månader som klipp.
 *
 * Ett tiokort räcker i tio månader, ett femkort i fem. Takten blir alltså en
 * kväll i månaden — rejält mycket långsammare än The Labs veckotakt, så den
 * som köper kortet för att gå regelbundet märker aldrig gränsen. Den finns för
 * kortet som köps i entusiasm och sedan glöms bort.
 *
 * Tidigare saknades giltighetstid med flit. Det ändrades 2026-09-30, och skälet
 * är inte att pressa någon: ett förskottsbetalt kort som aldrig kan förfalla är
 * en skuld utan slutdatum i bokföringen, och lokalens andel av ett oanvänt
 * klipp blir aldrig utbetald. Med ett datum går båda att redovisa.
 *
 * Månader, inte dagar: ett kort köpt den 31 januari går ut den sista februari,
 * inte den 3 mars. setMonth klarar det själv genom att klampa till månadens
 * sista dag.
 */
export function passExpiryFrom(purchasedAt: Date, sessionsTotal: number): Date {
  const d = new Date(purchasedAt);
  const dagIManaden = d.getDate();
  d.setMonth(d.getMonth() + sessionsTotal);
  // Klampa: 31 jan + 1 månad blir 3 mars i JS. Har dagen bytts har vi passerat
  // månadsskiftet och backar till sista dagen i rätt månad.
  if (d.getDate() !== dagIManaden) d.setDate(0);
  return d;
}

/** Har kortet gått ut? Ett kort utan datum gäller tills vidare (gamla köp). */
export function passExpired(
  expiresAt: string | Date | null | undefined,
  now: Date = new Date()
): boolean {
  if (!expiresAt) return false;
  const d = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  return d.getTime() < now.getTime();
}

/** Kolumnerna en bokning får när kassan sålde ett klippkort. */
export function passBookingFields(
  sessionsTotal: string | number | null | undefined,
  purchasedAt: Date = new Date()
) {
  const n = Number(sessionsTotal);
  if (!Number.isFinite(n) || n <= 0) return {};
  return {
    sessions_total: n,
    sessions_redeemed: 0,
    pass_expires_at: passExpiryFrom(purchasedAt, n).toISOString(),
  };
}

export interface PassMoney {
  amount_paid: number | null;
  platform_fee_amount: number | null;
  credit_applied_ore?: number | null;
  sessions_total: number | null;
}

/**
 * Den del av kortets pris som hör till ETT tillfälle. Kvällens avräkning ska
 * se ett klipp som en biljett värd 1/N av kortet — inte hela kortet den kväll
 * det köptes, och inte noll de kvällar det används.
 */
export function redemptionSlice(b: PassMoney) {
  const n = Math.max(1, b.sessions_total ?? 1);
  return {
    amount_paid: Math.round((b.amount_paid ?? 0) / n),
    platform_fee_amount: b.platform_fee_amount == null ? null : Math.round(b.platform_fee_amount / n),
    credit_applied_ore: Math.round((b.credit_applied_ore ?? 0) / n),
  };
}

export interface PassSlice {
  amount_paid: number;
  platform_fee_amount: number | null;
  credit_applied_ore: number;
}

/**
 * Nästa klipps andel av kortet: det som är kvar av pengarna delat på de klipp
 * som är kvar. Så länge antalet klipp är oförändrat blir det samma 1/N som
 * förr, men ändras antalet — som när torsdagarna gick från 200 till 100 kr och
 * korten fick dubbelt så många klipp — följer värdet med utan att redan
 * avräknade kvällar räknas om. Sista klippet tar avrundningsresten, så klippen
 * summerar exakt till kortets pris.
 */
export function nextRedemptionSlice(b: PassMoney, prior: readonly PassSlice[]): PassSlice {
  const left = Math.max(1, (b.sessions_total ?? 1) - prior.length);
  const rest = (total: number | null | undefined, taken: number) =>
    Math.max(0, Math.round(((total ?? 0) - taken) / left));
  const sum = (pick: (s: PassSlice) => number | null) => prior.reduce((acc, s) => acc + (pick(s) ?? 0), 0);
  return {
    amount_paid: rest(b.amount_paid, sum((s) => s.amount_paid)),
    platform_fee_amount: b.platform_fee_amount == null ? null : rest(b.platform_fee_amount, sum((s) => s.platform_fee_amount)),
    credit_applied_ore: rest(b.credit_applied_ore, sum((s) => s.credit_applied_ore)),
  };
}

interface StoredSlice {
  amount_paid_ore: number | null;
  platform_fee_ore: number | null;
  credit_ore: number | null;
}

/** Ett klipps andel: den frysta om raden har en, annars 1/N som förr. */
export function storedOrLegacySlice(r: StoredSlice, b: PassMoney): PassSlice {
  if (r.amount_paid_ore == null) return redemptionSlice(b);
  return { amount_paid: r.amount_paid_ore, platform_fee_amount: r.platform_fee_ore, credit_applied_ore: r.credit_ore ?? 0 };
}

/** Kolumnerna en ny rad i pass_redemptions får för sin frysta andel. */
export function sliceColumns(s: PassSlice) {
  return { amount_paid_ore: s.amount_paid, platform_fee_ore: s.platform_fee_amount, credit_ore: s.credit_applied_ore };
}

/** Andelen för kortets nästa klipp, räknad mot de klipp som redan tagits. */
export async function sliceForNextClip(admin: SupabaseClient, bookingId: string, b: PassMoney): Promise<PassSlice> {
  const { data } = await admin
    .from("pass_redemptions")
    .select("amount_paid_ore, platform_fee_ore, credit_ore")
    .eq("booking_id", bookingId);
  const prior = ((data ?? []) as StoredSlice[]).map((r) => storedOrLegacySlice(r, b));
  return nextRedemptionSlice(b, prior);
}

/**
 * Vad kortet sparar mot att betala kväll för kväll. Jämförelsen görs mot
 * kvällens ordinarie biljett för det kortet täcker, så procenten är sann och
 * inte ett påstående: 1 400 kr för tio kvällar à 200 kr är 30 procent.
 */
export function passSavings(
  pass: { price: number; sessionCount: number },
  referencePrice: number | null | undefined
): { perSession: number; percent: number } | null {
  const n = Math.max(1, pass.sessionCount);
  const perSession = Math.round(pass.price / n);
  const ref = referencePrice ?? 0;
  if (ref <= 0 || perSession >= ref) return null;
  return { perSession, percent: Math.round((1 - perSession / ref) * 100) };
}

export interface Occurrence {
  id: string;
  title: string;
  event_date: string;
  event_time: string | null;
  /** Sluttid, för kvällens slut (lib/tickets/evening.ts). */
  event_end_time?: string | null;
  event_location: string | null;
}

/** Kvällens tillfälle (Stockholmstid, med nattmarginal) och nästa kommande. */
export function pickOccurrence(
  occurrences: readonly Occurrence[],
  now: Date = new Date()
): { today: Occurrence | null; next: Occurrence | null } {
  const sorted = [...occurrences].sort((a, b) => a.event_date.localeCompare(b.event_date));
  const today = sorted.find((o) => isEventDay(o.event_date, now)) ?? null;
  const day = stockholmDay(now);
  const next = sorted.find((o) => o.event_date > day && o.id !== today?.id) ?? null;
  return { today, next };
}

/** Rad som bär kopplingen till serier — arrayen är sanningen. */
export interface PassSeriesLike {
  pass_series_ids?: string[] | null;
  pass_series_id?: string | null;
}

/**
 * Serierna ett kort gäller på. pass_series_id läses som reserv så kort som
 * skrevs av en äldre utrullning fortfarande fungerar i dörren.
 */
export function passSeriesIds(row: PassSeriesLike | null | undefined): string[] {
  const many = row?.pass_series_ids?.filter(Boolean) ?? [];
  if (many.length > 0) return [...new Set(many)];
  return row?.pass_series_id ? [row.pass_series_id] : [];
}

export async function seriesOccurrences(
  admin: SupabaseClient,
  series: string | readonly string[]
): Promise<Occurrence[]> {
  const ids = (typeof series === "string" ? [series] : series).filter(Boolean);
  if (ids.length === 0) return [];
  const { data } = await admin
    .from("listings")
    .select("id, title, event_date, event_time, event_end_time, event_location")
    .in("series_id", ids as string[])
    .eq("is_active", true)
    .not("event_date", "is", null)
    .order("event_date", { ascending: true });
  return (data as Occurrence[] | null) ?? [];
}

/**
 * Avräkningsrader för ett tillfälle: varje inlöst klipp räknas som en biljett
 * värd klippets frysta andel av kortet (1/N för äldre rader). Återbetalda kort
 * räknas inte alls — pengarna gick tillbaka, och en delad återbetalning över
 * flera kvällar är inte byggd.
 */
export async function passRedemptionRows(
  admin: SupabaseClient,
  occurrenceId: string
): Promise<SettlementBookingRow[]> {
  const { data } = await admin
    .from("pass_redemptions")
    .select("amount_paid_ore, platform_fee_ore, credit_ore, booking:bookings!booking_id(status, amount_paid, platform_fee_amount, credit_applied_ore, sessions_total)")
    .eq("listing_id", occurrenceId);

  type Row = StoredSlice & { booking: (PassMoney & { status: string | null }) | (PassMoney & { status: string | null })[] | null };
  const rows: SettlementBookingRow[] = [];
  for (const r of (data ?? []) as unknown as Row[]) {
    const b = Array.isArray(r.booking) ? r.booking[0] : r.booking;
    if (!b || b.status === "canceled") continue;
    rows.push({ status: "completed", guest_count: 1, refund_amount: null, ...storedOrLegacySlice(r, b) });
  }
  return rows;
}
