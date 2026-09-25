/**
 * Är biljettens eventdatum samma dag som "nu", räknat i Stockholm?
 *
 * Skannern godkände en biljett för den 21:a på kvällen den 7:e — grön ruta,
 * "Giltig biljett". Bokningen var bekräftad och oanvänd, så statusen stämde;
 * det var datumet ingen tittade på. Jämförelsen görs i Stockholmstid, inte
 * UTC: kl. 00:30 svensk tid är det fortfarande "igår" i UTC, och en biljett
 * för en kväll som pågår efter midnatt ska inte plötsligt bli ogiltig.
 */
const STOCKHOLM_DAY = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** ISO-datum (YYYY-MM-DD) för ett ögonblick, i Stockholmstid. */
export function stockholmDay(at: Date): string {
  return STOCKHOLM_DAY.format(at); // sv-SE ger redan YYYY-MM-DD
}

/**
 * Kvällar som pågår efter midnatt: en biljett räknas som "i dag" även
 * strax efter tolvslaget, fram till EARLY_HOURS. Ingen dörr är öppen kl. 04.
 */
const EARLY_HOURS = 4;

export function isEventDay(eventDate: string | null | undefined, at: Date = new Date()): boolean {
  if (!eventDate) return true; // inget datum att jämföra mot — släpp igenom som förut
  if (stockholmDay(at) === eventDate) return true;
  const hour = Number(
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", hour12: false }).format(at)
  );
  if (hour < EARLY_HOURS) {
    const yesterday = new Date(at.getTime() - 24 * 60 * 60 * 1000);
    return stockholmDay(yesterday) === eventDate;
  }
  return false;
}
