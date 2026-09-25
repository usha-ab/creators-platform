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

/** Kolumnerna en bokning får när kassan sålde ett klippkort. */
export function passBookingFields(sessionsTotal: string | number | null | undefined) {
  const n = Number(sessionsTotal);
  return Number.isFinite(n) && n > 0 ? { sessions_total: n, sessions_redeemed: 0 } : {};
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
    .select("id, title, event_date, event_time, event_location")
    .in("series_id", ids as string[])
    .eq("is_active", true)
    .not("event_date", "is", null)
    .order("event_date", { ascending: true });
  return (data as Occurrence[] | null) ?? [];
}

/**
 * Avräkningsrader för ett tillfälle: varje inlöst klipp räknas som en biljett
 * värd 1/N av kortet. Återbetalda kort räknas inte alls — pengarna gick
 * tillbaka, och en delad återbetalning över flera kvällar är inte byggd.
 */
export async function passRedemptionRows(
  admin: SupabaseClient,
  occurrenceId: string
): Promise<SettlementBookingRow[]> {
  const { data } = await admin
    .from("pass_redemptions")
    .select("booking:bookings!booking_id(status, amount_paid, platform_fee_amount, credit_applied_ore, sessions_total)")
    .eq("listing_id", occurrenceId);

  const rows: SettlementBookingRow[] = [];
  for (const r of (data ?? []) as unknown as { booking: (PassMoney & { status: string | null }) | (PassMoney & { status: string | null })[] | null }[]) {
    const b = Array.isArray(r.booking) ? r.booking[0] : r.booking;
    if (!b || b.status === "canceled") continue;
    rows.push({ status: "completed", guest_count: 1, refund_amount: null, ...redemptionSlice(b) });
  }
  return rows;
}
