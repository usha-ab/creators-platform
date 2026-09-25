/**
 * Välkomstavdrag: 50 kr till den som skapar konto, att använda på ett köp.
 *
 * Två beslut styr reglerna, och båda är affärsbeslut snarare än tekniska.
 *
 * USHA BÄR HELA AVDRAGET. Avräkningen mot en samarbetspartner räknas på vad
 * köparen betalat, så ett avdrag skulle annars tyst halvera partnerns andel —
 * de skulle finansiera halva marknadsföringen utan att ha sagt ja. Därför
 * lagras avdraget separat på bokningen och läggs tillbaka i underlaget innan
 * delningen. Partnern får sin andel av ordinarie pris.
 *
 * MINSTA KÖP 150 KR. Utan gräns blir en practica-biljett för 50 kr gratis, och
 * ett köparkonto kräver bara en mejladress. Gränsen gör avdraget till en knuff
 * mot workshop, social eller hela kvällen i stället för till gratis inträde.
 */

/** Avdragets storlek i öre. */
export const SIGNUP_CREDIT_ORE = 5000;

/** Lägsta ordersumma i öre för att avdraget ska gälla. */
export const SIGNUP_CREDIT_MIN_SPEND_ORE = 15000;

export interface CreditInput {
  /** Kvarvarande avdrag i öre. 0 eller saknat = inget att använda. */
  creditOre: number | null | undefined;
  /** Ordersumman före avdrag, i öre. Serviceavgift räknas inte in. */
  subtotalOre: number;
  /** Har avdraget gått ut? */
  expired?: boolean;
  /** Är det redan använt? */
  used?: boolean;
  minSpendOre?: number;
}

/**
 * Hur mycket av avdraget som får användas på det här köpet.
 *
 * Aldrig mer än ordersumman: ett köp får bli noll kronor men aldrig negativt,
 * och Stripe vägrar ändå en rad med negativt belopp.
 */
export function applicableCredit(input: CreditInput): number {
  const min = input.minSpendOre ?? SIGNUP_CREDIT_MIN_SPEND_ORE;
  const credit = input.creditOre ?? 0;

  if (input.used || input.expired) return 0;
  if (credit <= 0) return 0;
  if (!Number.isFinite(input.subtotalOre) || input.subtotalOre <= 0) return 0;
  if (input.subtotalOre < min) return 0;

  return Math.min(credit, input.subtotalOre);
}

/**
 * Underlaget som partnerns andel ska räknas på.
 *
 * Betalt belopp plus det avdrag Usha stod för. Utan detta skulle en kväll där
 * halva publiken använt sitt välkomstavdrag ge partnern en oförklarligt låg
 * utbetalning — och den förklaringen vill ingen behöva ge i efterhand.
 */
export function settlementBasisOre(row: {
  amount_paid?: number | null;
  credit_applied_ore?: number | null;
}): number {
  return (row.amount_paid ?? 0) + (row.credit_applied_ore ?? 0);
}
