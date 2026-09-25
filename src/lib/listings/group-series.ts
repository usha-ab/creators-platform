/**
 * Serier som ETT kort.
 *
 * The Lab går två kvällar i veckan och fyller därför listan med fjorton nästan
 * identiska kort — samma titel, samma foto, olika datum. En besökare som
 * bläddrar ser då ut att mötas av en enda sak upprepad, och kurserna och
 * coachingen trängs undan trots att de är egna erbjudanden.
 *
 * Här grupperas en serie till en post: närmaste kvällen representerar den, och
 * resten av datumen följer med så att kortet kan vecklas ut. Ordningen bevaras
 * — posten hamnar där dess tidigaste kväll skulle ha hamnat.
 */

export interface GrupperbarListning {
  id: string;
  series_id?: string | null;
  event_date?: string | null;
}

export interface SerieGrupp<T extends GrupperbarListning> {
  /** Kvällen som representerar posten — den närmaste i tiden. */
  forsta: T;
  /** Alla kvällar i serien, inklusive den första, i datumordning. */
  alla: T[];
  /** Antal ytterligare tillfällen utöver det som visas. */
  fler: number;
}

export function groupBySeries<T extends GrupperbarListning>(listings: T[]): SerieGrupp<T>[] {
  const grupper = new Map<string, T[]>();
  const ordning: string[] = [];

  for (const l of listings) {
    // En listning utan serie är sin egen grupp. Nyckeln måste då vara id:t,
    // annars hade alla lösa listningar klumpats ihop under samma tomma nyckel.
    const nyckel = l.series_id || `ensam:${l.id}`;
    const g = grupper.get(nyckel);
    if (g) {
      g.push(l);
    } else {
      grupper.set(nyckel, [l]);
      ordning.push(nyckel);
    }
  }

  return ordning.map((nyckel) => {
    const alla = [...grupper.get(nyckel)!].sort((a, b) =>
      (a.event_date ?? "").localeCompare(b.event_date ?? "")
    );
    return { forsta: alla[0], alla, fler: alla.length - 1 };
  });
}
