import { createAdminClient } from "@/lib/supabase/admin";
import { stockholmDay } from "@/lib/tickets/event-day";
import { countUpcoming, type VenueEventRow } from "./public-events";

/**
 * Lokalerna på /platser.
 *
 * Sidan läste förut bara platsregistret (tabellen venues) — adresser som
 * evenemang råkat taggas med — och visade dem med noll upplevelser, medan
 * lokalerna som faktiskt har konto och program hos oss inte syntes alls.
 *
 * Nu: lokalkonton (rollen venue) med publik profil och minst en kommande
 * kväll, egen eller bekräftad hos dem. Läses med service-role eftersom
 * rollkolumnen inte är läsbar för anon; det som lämnar funktionen är bara
 * det som redan står på lokalens publika sida.
 */

export interface VenueAccount {
  id: string;
  name: string;
  href: string;
  avatarUrl: string | null;
  city: string | null;
  upcoming: number;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  company_name: string | null;
  slug: string | null;
  avatar_url: string | null;
  location: string | null;
}

interface ListingRow extends VenueEventRow {
  user_id: string;
  venue_profile_id: string | null;
  venue_confirmed_at: string | null;
}

/** Ren del: koppla kvällar till lokaler och släng lokaler utan kommande program. */
export function buildVenueDirectory(profiles: ProfileRow[], listings: ListingRow[], today: string): VenueAccount[] {
  return profiles
    .map((p) => {
      const rows = listings.filter(
        (l) => l.user_id === p.id || (l.venue_profile_id === p.id && l.venue_confirmed_at != null)
      );
      return {
        id: p.id,
        name: (p.full_name || p.company_name || "").trim(),
        href: `/creators/${p.slug || p.id}`,
        avatarUrl: p.avatar_url,
        city: p.location,
        upcoming: countUpcoming(rows, today),
      };
    })
    .filter((v) => v.name.length > 0 && v.upcoming > 0)
    .sort((a, b) => b.upcoming - a.upcoming || a.name.localeCompare(b.name, "sv"));
}

export async function loadVenueDirectory(): Promise<VenueAccount[]> {
  const admin = createAdminClient();
  const today = stockholmDay(new Date());
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name, company_name, slug, avatar_url, location")
    .eq("role", "venue")
    .eq("is_public", true);
  const list = (profiles ?? []) as ProfileRow[];
  if (list.length === 0) return [];
  const ids = list.map((p) => p.id).join(",");
  const { data: listings } = await admin
    .from("listings")
    .select("id, title, event_date, event_time, user_id, venue_profile_id, venue_confirmed_at")
    .eq("is_active", true)
    .eq("is_public", true)
    .gte("event_date", today)
    .or(`user_id.in.(${ids}),venue_profile_id.in.(${ids})`);
  return buildVenueDirectory(list, (listings ?? []) as ListingRow[], today);
}
