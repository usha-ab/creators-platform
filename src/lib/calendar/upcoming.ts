/**
 * Publik kalender: kommande händelser som en besökare kan bläddra i.
 *
 * En serie (samma series_id) är EN händelse i kalendern, inte sju rader med
 * samma titel. Raden visar nästa tillfälle och hur många som är bokade framåt.
 * Ren logik utan databas så den går att testa rakt av.
 */
export type CalendarListing = {
  id: string;
  user_id: string | null;
  slug: string | null;
  series_id: string | null;
  series_slug: string | null;
  title: string;
  event_date: string | null; // YYYY-MM-DD
  event_time: string | null; // HH:MM:SS
  event_end_time: string | null;
  event_location: string | null;
  event_city: string | null;
  event_venue: string | null;
  image_url: string | null;
  price: number | null;
};

export type CalendarEntry = {
  key: string;
  title: string;
  href: string;
  /** Arrangörens profil-id, för följ-knappen i listan. */
  organizerId: string | null;
  date: string; // nästa tillfälle
  time: string | null;
  endTime: string | null;
  location: string | null;
  imageUrl: string | null;
  price: number | null;
  /** Antal kommande tillfällen (1 för en fristående händelse). */
  occurrences: number;
  /** 0–6 (sön–lör) när alla tillfällen faller på samma veckodag, annars null. */
  recurringWeekday: number | null;
};

export type CalendarBucket = "today" | "thisWeek" | "nextWeek" | "later";

const DAY_MS = 86_400_000;

function dayIndex(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** Veckodag 0–6 (sön–lör) för ett ISO-datum, oberoende av serverns tidszon. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Måndag som veckans första dag. */
function weekStart(date: string): number {
  return dayIndex(date) - ((weekdayOf(date) + 6) % 7);
}

export function bucketFor(date: string, today: string): CalendarBucket {
  if (date === today) return "today";
  const ws = weekStart(date);
  const tws = weekStart(today);
  if (ws === tws) return "thisWeek";
  if (ws === tws + 7) return "nextWeek";
  return "later";
}

function locationOf(l: CalendarListing): string | null {
  return l.event_venue || l.event_location || l.event_city || null;
}

/**
 * Grupperar kommande annonser till kalenderposter, sorterade på nästa datum.
 * Annonser utan datum eller före `today` ignoreras.
 */
export function groupUpcoming(listings: CalendarListing[], today: string): CalendarEntry[] {
  const upcoming = listings
    .filter((l): l is CalendarListing & { event_date: string } => !!l.event_date && l.event_date >= today)
    .sort((a, b) => a.event_date.localeCompare(b.event_date) || (a.event_time ?? "").localeCompare(b.event_time ?? ""));

  const series = new Map<string, (CalendarListing & { event_date: string })[]>();
  const entries: CalendarEntry[] = [];

  for (const l of upcoming) {
    if (l.series_id) {
      const g = series.get(l.series_id);
      if (g) {
        g.push(l);
        continue;
      }
      series.set(l.series_id, [l]);
    }
    // Första tillfället i en serie (eller en fristående händelse) blir raden;
    // resten av serien räknas in i efterhand nedan.
    entries.push({
      key: l.series_id ?? l.id,
      title: l.title,
      organizerId: l.user_id,
      href: l.series_id && l.series_slug ? `/event/${l.series_slug}` : `/event/${l.slug ?? l.id}`,
      date: l.event_date,
      time: l.event_time,
      endTime: l.event_end_time,
      location: locationOf(l),
      imageUrl: l.image_url,
      price: l.price,
      occurrences: 1,
      recurringWeekday: null,
    });
  }

  for (const e of entries) {
    const g = series.get(e.key);
    if (!g || g.length < 2) continue;
    e.occurrences = g.length;
    const wd = weekdayOf(g[0].event_date);
    e.recurringWeekday = g.every((o) => weekdayOf(o.event_date) === wd) ? wd : null;
  }

  return entries;
}

/**
 * Grinden för menylänken. Trafik säger inget om vad besökaren möter när hen
 * klickar; utbudet gör det. En kalender med en enda rad gör varumärket
 * mindre, inte större.
 */
export function hasEnoughSupply(entryCount: number, minSupply: number): boolean {
  return entryCount >= Math.max(1, minSupply);
}
