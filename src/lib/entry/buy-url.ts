/**
 * Länken entrévärden visar som QR-kod.
 *
 * Gästen scannar med sin egen telefon och landar på den vanliga köpsidan med
 * rätt biljett förvald — det är därför ingen kortläsare behövs: gästens telefon
 * är terminalen, och betalningen går genom exakt samma kassa som en
 * onlineförsäljning. Ingen ny betalväg att underhålla, och avräkningen stämmer
 * automatiskt eftersom pengarna landar i Stripe som vanligt.
 */
export interface BuyUrlInput {
  appUrl: string;
  /** Eventets slug. Saknas den finns ingen publik köpsida att peka på. */
  slug: string | null;
  /** Vald biljettyp. null = köpsidan öppnas utan förval. */
  ticketTypeId?: string | null;
}

export function buildEntryBuyUrl({ appUrl, slug, ticketTypeId }: BuyUrlInput): string | null {
  if (!slug) return null;
  const base = `${appUrl.replace(/\/+$/, "")}/event/${encodeURIComponent(slug)}`;
  return ticketTypeId ? `${base}?tt=${encodeURIComponent(ticketTypeId)}` : base;
}
