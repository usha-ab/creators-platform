import { PLATFORM_COMMISSION, platformCommissionOre } from "./commission";
import { MIN_PAID_TICKET_PRICE_SEK } from "./min-price";

/**
 * Räkneexemplet på säljsidorna: "säljer du 20 biljetter à 150 kr får du X kr".
 *
 * Räknas exakt som kassan gör (ticket-checkout och guest-checkout): provisionen
 * tas per biljett med platformCommissionOre(pris, 1) och multipliceras sedan
 * med antalet. Det är inte samma sak som platformCommissionOre(pris, antal),
 * som avrundar på totalen — på udda priser skiljer det några öre, och
 * exemplet ska visa det arrangören faktiskt får.
 *
 * Bara provisionen dras. Kassan tar Stripes kortavgift ur Ushas del
 * (destination charge med application_fee_amount), inte ur arrangörens, så
 * den finns inte med här. Serviceavgiften för köparen ("buyer"-läget) läggs
 * ovanpå priset och påverkar inte arrangörens del, så den finns inte heller med.
 */
export interface TicketPayoutExample {
  /** Biljettintäkter i öre: det köparna betalar för biljetterna. */
  grossOre: number;
  /** Ushas provision i öre. */
  commissionOre: number;
  /** Det arrangören får i öre. */
  netOre: number;
}

/**
 * Gränser för räknaren. Övre gränsen hindrar att ett felskrivet tal ger
 * orimliga siffror; den nedre är plattformens lägsta biljettpris (min-price.ts),
 * så räknaren aldrig visar ett exempel på ett pris som inte går att sätta.
 */
export const PAYOUT_EXAMPLE_LIMITS = {
  minPriceKr: MIN_PAID_TICKET_PRICE_SEK,
  maxPriceKr: 100_000,
  maxQty: 10_000,
} as const;

/** Ett betalt pris under lägsta priset: räknaren visar en förklaring i stället för siffror. */
export function isBelowMinimumPrice(priceKr: number): boolean {
  return Number.isFinite(priceKr) && priceKr > 0 && priceKr < PAYOUT_EXAMPLE_LIMITS.minPriceKr;
}

/** Standardexemplet på säljsidorna. */
export const PAYOUT_EXAMPLE_DEFAULT = { priceKr: 150, qty: 20 } as const;

function clampInt(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), max);
}

export function ticketPayoutExample(priceKr: number, qty: number): TicketPayoutExample {
  const n = clampInt(qty, PAYOUT_EXAMPLE_LIMITS.maxQty);
  const price =
    Number.isFinite(priceKr) && priceKr >= PAYOUT_EXAMPLE_LIMITS.minPriceKr
      ? Math.min(priceKr, PAYOUT_EXAMPLE_LIMITS.maxPriceKr)
      : 0;
  const unitOre = Math.round(price * 100);
  if (n === 0 || unitOre === 0) return { grossOre: 0, commissionOre: 0, netOre: 0 };
  const grossOre = unitOre * n;
  const commissionOre = platformCommissionOre(unitOre, 1) * n;
  return { grossOre, commissionOre, netOre: grossOre - commissionOre };
}

/** Provisionens delar för text: sats som andel (0.035) och fast del i kronor (3.5). */
export function commissionParts(): { rate: number; fixedKr: number } {
  return { rate: PLATFORM_COMMISSION.rate, fixedKr: PLATFORM_COMMISSION.fixedOre / 100 };
}

/** Kronor på besökarens språk: "2 825 kr", "SEK 2,825", "2825 SEK". Öre bara när de finns. */
export function formatKrFromOre(ore: number, locale: string): string {
  const whole = ore % 100 === 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "SEK",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(ore / 100);
}

/** "3,5 %" och "3,50 kr" ur PLATFORM_COMMISSION, aldrig ur en översättning. */
export function commissionTextParts(locale: string): { rate: string; fixed: string } {
  const { rate, fixedKr } = commissionParts();
  return {
    rate: new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(rate),
    fixed: new Intl.NumberFormat(locale, { style: "currency", currency: "SEK", minimumFractionDigits: 2 }).format(fixedKr),
  };
}
