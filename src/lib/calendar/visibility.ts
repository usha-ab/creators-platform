import { createAdminClient } from "@/lib/supabase/admin";
import { stockholmDay } from "@/lib/tickets/event-day";
import { getCalendarMinSupply } from "./flag";
import { groupUpcoming, hasEnoughSupply, type CalendarListing } from "./upcoming";

export const CALENDAR_COLUMNS =
  "id, user_id, slug, series_id, series_slug, title, event_date, event_time, event_end_time, event_location, event_city, event_venue, image_url, price";

/** Alla publika, aktiva annonser med datum från i dag och framåt. */
export async function fetchUpcomingListings(): Promise<CalendarListing[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("listings")
    .select(CALENDAR_COLUMNS)
    .eq("is_active", true)
    .eq("is_public", true)
    .gte("event_date", stockholmDay(new Date()))
    .order("event_date", { ascending: true });
  return (data as CalendarListing[] | null) ?? [];
}

const TTL_MS = 5 * 60_000;
let cached: { value: boolean; at: number } | null = null;

/**
 * Ska kalenderlänken synas i toppmenyn? Sidan /kalender nås alltid på sin
 * adress; det här styr bara om vi pekar dit. Cachat i processen så
 * startsidan inte betalar en fråga per besök.
 */
export async function calendarIsVisible(): Promise<boolean> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.value;

  let value = false;
  try {
    const [listings, min] = await Promise.all([fetchUpcomingListings(), getCalendarMinSupply()]);
    value = hasEnoughSupply(groupUpcoming(listings, stockholmDay(new Date())).length, min);
  } catch {
    // vid fel: visa inte länken, sidan finns ändå
  }

  cached = { value, at: now };
  return value;
}

export function clearCalendarVisibilityCache() {
  cached = null;
}
