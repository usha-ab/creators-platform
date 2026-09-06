/**
 * Summering av en kvälls bokningar till de tal avräkningen vilar på.
 *
 * Låg i tidigare inline i avräkningssidan. Flyttad hit av två skäl: samma tal
 * ska mata både rapporten och intäktsdelningen, och summeringen innehöll ett
 * fel som bara gick att bevisa med test.
 */

export interface SettlementBookingRow {
  status: string | null;
  amount_paid: number | null;
  platform_fee_amount: number | null;
  refund_amount: number | null;
  guest_count: number | null;
  /**
   * Välkomstavdrag som Usha stod för. Räknas MED i bruttot: partnerns andel
   * ska vila på ordinarie pris, annars finansierar partnern halva avdraget
   * utan att ha sagt ja till det.
   */
  credit_applied_ore?: number | null;
}

export interface EventTotals {
  /** Antal biljetter som fortfarande gäller. Återbetalda räknas inte. */
  ticketsSold: number;
  /** Allt som betalats in för kvällen, INKLUSIVE det som senare återbetalats. */
  grossOre: number;
  /** Ushas provision och ev. serviceavgift på de biljetter som gäller. */
  platformFeeOre: number;
  refundedOre: number;
  refundedCount: number;
}

/**
 * Både återbetalningsvägarna — appen och Stripes egen instrumentpanel — sätter
 * status till "canceled" samtidigt som refund_amount fylls i. En återbetald
 * bokning är alltså aldrig "confirmed".
 *
 * Det är precis där felet satt. Bruttot räknade bara confirmed/completed, så
 * den återbetalda biljettens belopp fanns aldrig med — och sedan drogs
 * återbetalningen av från ett brutto som aldrig innehöll den. Varje
 * återbetalning drog alltså av sig själv två gånger och gjorde nettot för lågt.
 *
 * Här räknas bruttot som allt som faktiskt betalats in, och återbetalningen
 * dras av en gång. Då blir raderna också det de utger sig för att vara:
 * brutto → återbetalt → avgift → netto.
 */
export function aggregateEventBookings(
  rows: readonly SettlementBookingRow[],
  commissionRate: number
): EventTotals {
  const totals: EventTotals = {
    ticketsSold: 0,
    grossOre: 0,
    platformFeeOre: 0,
    refundedOre: 0,
    refundedCount: 0,
  };

  for (const b of rows) {
    const qty = b.guest_count ?? 1;
    const paid = (b.amount_paid ?? 0) + (b.credit_applied_ore ?? 0);
    const isActive = b.status === "confirmed" || b.status === "completed";
    const isRefunded = b.status === "canceled" && !!b.refund_amount;

    if (isActive) {
      totals.ticketsSold += qty;
      totals.grossOre += paid;
      // Föredra den sparade avgiften; falla tillbaka på en uppskattning för
      // bokningar som skapades innan kolumnen fanns.
      totals.platformFeeOre += b.platform_fee_amount ?? Math.round(paid * commissionRate);
    } else if (isRefunded) {
      // Pengarna kom in och gick ut igen. Båda leden ska synas i rapporten,
      // annars går den inte att stämma av mot kontoutdraget.
      totals.grossOre += paid;
      totals.refundedOre += b.refund_amount ?? 0;
      totals.refundedCount += 1;
    }
    // Avbokat utan återbetalning och obetalt räknas inte alls: inga pengar rörde sig.
  }

  return totals;
}
