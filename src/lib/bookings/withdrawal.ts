import { stockholmDay } from "@/lib/tickets/event-day";
import { stockholmLocalToUtcISO } from "@/lib/time";

/**
 * Ångerrätten (lagen 2005:59 om distansavtal, 2 kap.). Underlaget är juristens
 * slutliga text 2026-11-25 (villkor-slutlig.md, del 2 och Kodspår 1).
 *
 * - Ett klippkort eller ett paket utan bestämt datum har 14 dagars ångerrätt
 *   från köpdagen (12 §). Köparen väljer själv när klippen används, så
 *   undantaget för bestämda datum passar inte.
 * - En biljett eller bokning till en bestämd dag har ingen ångerrätt
 *   (11 § p. 12). Köparen ska ändå få veta det, och kan avboka enligt
 *   säljarens regler.
 * - Ångrar köparen sig ska allt tillbaka, serviceavgiften också (14 och 16 §§).
 *   Avdrag för använda klipp får bara göras om köparen uttryckligen begärt att
 *   få börja använda kortet inom fristen (15 § p. 3). Kassan frågar inte det
 *   än, så här dras ingenting av.
 *
 * Juristens försiktiga tolkning: ångerrätt ges även för kort som bara gäller
 * vissa kvällar i en serie, och oavsett om säljaren uppgett sig som
 * näringsidkare (Plattformen vet inte det än).
 */
export const WITHDRAWAL_DAYS = 14;

/** Pengarna ska vara tillbaka senast så här många dagar efter meddelandet. */
export const REFUND_DAYS = 14;

export interface WithdrawalBookingLike {
  status: string | null;
  created_at: string | null;
  amount_paid: number | null;
  sessions_total: number | null;
  minutes_total?: number | null;
  is_free?: boolean | null;
}

export interface WithdrawalListingLike {
  event_date?: string | null;
}

/** Är köpet ett kort eller paket utan bestämt datum? */
export function isUndatedPurchase(b: WithdrawalBookingLike): boolean {
  return (b.sessions_total ?? 0) > 0 || (b.minutes_total ?? 0) > 0;
}

/**
 * Sista dagen att ångra sig: köpdagen + 14 dagar, i Stockholmstid. Fristen
 * räknas i hela dagar, så den löper ut vid midnatt efter den dagen.
 */
export function withdrawalLastDay(purchasedAt: Date): string {
  const day = stockholmDay(purchasedAt);
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + WITHDRAWAL_DAYS);
  return d.toISOString().slice(0, 10);
}

/** Ögonblicket då fristen löpt ut (midnatt efter sista dagen, svensk tid). */
export function withdrawalClosesAt(purchasedAt: Date): Date {
  const last = withdrawalLastDay(purchasedAt);
  const next = new Date(`${last}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const iso = stockholmLocalToUtcISO(`${next.toISOString().slice(0, 10)}T00:00`);
  return new Date(iso ?? `${next.toISOString().slice(0, 10)}T00:00:00Z`);
}

/** Senast när pengarna ska vara tillbaka, räknat från ångermeddelandet. */
export function refundDueAt(receivedAt: Date): Date {
  return new Date(receivedAt.getTime() + REFUND_DAYS * 24 * 3600_000);
}

export type WithdrawalState =
  /** Kan ångras nu. */
  | { kind: "open"; lastDay: string }
  /** Kort utan datum, men fristen har gått ut. */
  | { kind: "expired"; lastDay: string }
  /** Bestämt datum: ingen ångerrätt, men köparen ska få veta det. */
  | { kind: "fixedDate" }
  /** Inget att ångra: obetalt, gratis, väntar på Swish eller redan avbokat. */
  | { kind: "none" };

export function withdrawalState(
  b: WithdrawalBookingLike,
  now: Date = new Date()
): WithdrawalState {
  const paid = (b.amount_paid ?? 0) > 0 && !b.is_free;
  if (!paid) return { kind: "none" };
  if (b.status !== "confirmed" && b.status !== "completed") return { kind: "none" };
  if (!isUndatedPurchase(b)) return { kind: "fixedDate" };
  if (!b.created_at) return { kind: "none" };
  const purchasedAt = new Date(b.created_at);
  const lastDay = withdrawalLastDay(purchasedAt);
  return now.getTime() < withdrawalClosesAt(purchasedAt).getTime()
    ? { kind: "open", lastDay }
    : { kind: "expired", lastDay };
}

/**
 * Hur mycket som betalas tillbaka. Utan köparens uttryckliga begäran om att få
 * börja direkt dras ingenting av, inte ens för använda klipp (15 § p. 3).
 * Hela beloppet inkluderar serviceavgiften: amount_paid är det köparen betalade.
 */
export function withdrawalRefundOre(b: Pick<WithdrawalBookingLike, "amount_paid">): number {
  return Math.max(0, b.amount_paid ?? 0);
}

/** Jämför e-postadresser utan hänsyn till versaler och mellanslag. */
export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Hur köparen får pengarna tillbaka: kortköp via Stripe direkt, allt annat
 * (Swish och Epassi landar inte hos Stripe) för hand av Usha.
 */
export function refundMethodFor(b: { stripe_payment_id: string | null }): "stripe" | "manual" {
  return b.stripe_payment_id ? "stripe" : "manual";
}
