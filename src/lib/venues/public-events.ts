import { isCancelled } from "@/lib/entrance/door-link";

/**
 * Vad en lokals publika sida och /platser visar av kvällarna hos lokalen.
 *
 * En lokal som öppnar sin sida för första gången ska se vad som händer härnäst,
 * inte ett arkiv. Därför bort med:
 *  - passerade kvällar (datum före i dag, Stockholmstid),
 *  - inställda kvällar (titeln börjar med INSTÄLLT, samma regel som dörren),
 *  - testevenemang (titeln börjar med "Test").
 * Klippkort och annat utan datum står kvar, efter de daterade kvällarna.
 */

export interface VenueEventRow {
  id: string;
  title: string;
  event_date: string | null;
  event_time?: string | null;
}

/** Ett testevenemang som lagts upp för att prova flödet. */
export function isTestEvent(title: string): boolean {
  return /^\s*\[?\s*test(event|evenemang)?\b/i.test(title);
}

export function visibleVenueEvents<T extends VenueEventRow>(rows: T[], today: string): T[] {
  const kept = rows.filter((r) => !isCancelled(r.title) && !isTestEvent(r.title));
  const dated = kept
    .filter((r) => r.event_date != null && r.event_date >= today)
    .sort(
      (a, b) =>
        a.event_date!.localeCompare(b.event_date!) ||
        (a.event_time ?? "").localeCompare(b.event_time ?? "")
    );
  const undated = kept.filter((r) => r.event_date == null);
  return [...dated, ...undated];
}

/** Antal kommande kvällar (klippkort räknas inte). */
export function countUpcoming(rows: VenueEventRow[], today: string): number {
  return visibleVenueEvents(rows, today).filter((r) => r.event_date != null).length;
}

function intlLocale(locale: string): string {
  return locale === "sv" ? "sv-SE" : locale === "es" ? "es-ES" : "en-GB";
}

/** "tors 26 nov · 17:00" på svenska. Datumet tolkas mitt på dagen så tidszonen inte flyttar det. */
export function formatEventDate(date: string, time: string | null | undefined, locale: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const label = d.toLocaleDateString(intlLocale(locale), {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/Stockholm",
  });
  return [label, time ? time.slice(0, 5) : null].filter(Boolean).join(" · ");
}
