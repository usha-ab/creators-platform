// Rabattkoder i biljettkassan.
//
// Koden matas in av köparen i Stripe Checkout. Stripe äger själva kupongen,
// räknar ned antalet användningar och nekar en kod som redan är förbrukad —
// därför behöver vi ingen egen tabell och kan inte råka släppa igenom samma
// kod två gånger.
//
// Det vi MÅSTE göra på vår sida är att bokföra rabatten som något Usha bjöd
// på. Bokningens amount_paid är vad köparen faktiskt betalade, och partnerns
// andel räknas inte på den utan på ordinarie pris (se credit_applied_ore i
// webhooken). Utan det här skulle en rabatt på 50 kr tyst kosta lokalen 25.

import type Stripe from "stripe";

/**
 * Rabatten Stripe drog av i sessionen, i öre.
 *
 * `total_details` saknas på äldre eller ofullständigt expanderade sessioner,
 * och ett negativt eller orimligt värde ska aldrig kunna öka utbetalningen —
 * därför klampas resultatet till noll och uppåt.
 */
export function sessionDiscountOre(
  session: Pick<Stripe.Checkout.Session, "total_details"> | null | undefined
): number {
  const raw = session?.total_details?.amount_discount;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.round(raw));
}

/**
 * Vad som ska stå i bokningens credit_applied_ore.
 *
 * Välkomstavdrag och rabattkod är två vägar till samma sak: köparen betalade
 * mindre, Usha stod för mellanskillnaden. Avräkningen bryr sig bara om
 * summan, så de läggs ihop.
 */
export function totalCreditOre(metadataCreditOre: unknown, session: Parameters<typeof sessionDiscountOre>[0]): number {
  const fromMetadata = Number(metadataCreditOre);
  const credit = Number.isFinite(fromMetadata) && fromMetadata > 0 ? Math.round(fromMetadata) : 0;
  return credit + sessionDiscountOre(session);
}
