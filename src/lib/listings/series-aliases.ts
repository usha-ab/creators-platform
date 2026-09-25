/**
 * Gamla serienycklar som fortfarande måste leda rätt.
 *
 * series_slug är både teknisk nyckel (avräkning, Stripe-metadata, fribiljetter)
 * och publik adress: usha.se/series/<series_slug>. Måndagsserien hette
 * "the-lab-tarraxo-urban-kizomba" — utan veckodag, medan torsdagen hade en.
 * Det gick inte att läsa vilken kassa som var vilken.
 *
 * Nyckeln är omdöpt, men adressen finns på utskrivna QR-koder och i delade
 * länkar. Därför lever den gamla kvar som alias i stället för att dö.
 */
export const SERIES_ALIASES: Record<string, string> = {
  "the-lab-tarraxo-urban-kizomba": "the-lab-mandag",
  "the-lab-torsdag-tarraxo-urban-kizomba": "the-lab-torsdag",
};

/** Den nyckel som gäller i dag för en given (möjligen gammal) serienyckel. */
export function canonicalSeriesSlug(slug: string): string {
  return SERIES_ALIASES[slug] ?? slug;
}
