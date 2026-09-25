/**
 * Tvåspråkiga beskrivningar.
 *
 * Arrangörer skriver ofta hela texten två gånger i samma fält, med en rad som
 * "— English —" emellan. På sidan blir det dubbelt så lång text där hälften är
 * obegriplig för läsaren, och den som vill ha den andra halvan får scrolla
 * förbi en text hen redan läst.
 *
 * Vi delar på separatorraden och låter andra halvan ligga i en utfällning.
 * Ingenting tas bort — allt finns kvar, ett klick bort.
 */

const SEPARATOR =
  /^[\s\-–—_*=]*(english|engelska|svenska|swedish|español|espanol|spanska|spanish)[\s\-–—_*=:]*$/i;

/** Rubrik på utfällningen, på det språk den innehåller. */
const LABELS: Record<string, string> = {
  english: "English below",
  engelska: "English below",
  svenska: "Svenska nedan",
  swedish: "Svenska nedan",
  español: "Español abajo",
  espanol: "Español abajo",
  spanska: "Español abajo",
  spanish: "Español abajo",
};

export type SplitDescription = {
  /** Texten före separatorn — alltid synlig. */
  primary: string;
  /** Texten efter separatorn, eller null när ingen separator finns. */
  secondary: string | null;
  /** Rubrik för utfällningen, t.ex. "English below". */
  secondaryLabel: string | null;
};

export function splitBilingualDescription(text: string | null): SplitDescription {
  if (!text) return { primary: "", secondary: null, secondaryLabel: null };

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const träff = lines[i].trim().match(SEPARATOR);
    if (!träff) continue;

    const primary = lines.slice(0, i).join("\n").trim();
    const secondary = lines.slice(i + 1).join("\n").trim();
    // En separator utan text på någon sida är bara en rubrik, inte en
    // språkdelning — då rör vi ingenting.
    if (!primary || !secondary) break;

    return {
      primary,
      secondary,
      secondaryLabel: LABELS[träff[1].toLowerCase()] ?? träff[1],
    };
  }

  return { primary: text, secondary: null, secondaryLabel: null };
}

/**
 * Hur mycket av en rad som är bokstäver och siffror. Dekorativa rader som
 * "∏H∑ L∆B ≈ t∆rr∆x◊ & UK" eller "•••" ligger nära noll.
 */
function läsbarAndel(rad: string): number {
  const tecken = rad.replace(/\s/g, "");
  if (!tecken) return 0;
  // \p{L}/\p{N} täcker å ä ö och accenter, till skillnad från A-Z0-9.
  const läsbara = tecken.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  return läsbara / tecken.length;
}

/**
 * Tar bort inledande rader som knappt innehåller bokstäver.
 *
 * En stiliserad rubrik är snygg på sidan men blir det första — ibland enda —
 * någon ser i en länkförhandsvisning i WhatsApp eller Facebook, där den
 * dessutom ofta renderas som fyrkanter. Bara inledningen rensas; resten av
 * texten lämnas orörd.
 */
export function stripDecorativeLead(text: string): string {
  const rader = text.split("\n");
  let i = 0;
  while (i < rader.length) {
    const rad = rader[i].trim();
    if (rad && läsbarAndel(rad) >= 0.6) break;
    i++;
  }
  // Är hela texten dekorativ är den ändå det bästa vi har.
  return i >= rader.length ? text.trim() : rader.slice(i).join("\n").trim();
}

/**
 * Texten som visas i en länkförhandsvisning.
 *
 * Faktaraden först: en förhandsvisning klipps efter ett par rader, och när
 * kvällen är och var den hålls är mer värt där än en brödtextsinledning.
 * Därefter beskrivningens första läsbara stycke, på ett språk (den engelska
 * halvan av en tvåspråkig text hör inte hemma i förhandsvisningen).
 */
export function buildPreviewDescription(
  facts: (string | null | undefined)[],
  description: string | null,
  maxLength = 200
): string {
  const faktarad = facts.filter((f): f is string => !!f && !!f.trim()).join(" · ");
  const brödtext = description
    ? stripDecorativeLead(splitBilingualDescription(description).primary)
        .split(/\n\s*\n/)[0]
        .replace(/\s+/g, " ")
        .trim()
    : "";

  const hel = [faktarad, brödtext].filter(Boolean).join(" — ");
  if (hel.length <= maxLength) return hel;
  // Klipp vid ordgräns, inte mitt i ett ord.
  return hel.slice(0, maxLength).replace(/\s+\S*$/, "") + "…";
}
