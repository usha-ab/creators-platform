import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { HomeContent } from "./home-content";
import { getFeedPosts } from "./feed/queries";
import { pendingTodos, type TodoItem } from "@/lib/todo/pending";
import { sortEventsForOwner, todayInStockholm } from "@/lib/events/sort";
import type { OwnListing } from "./own-listing-row";
import { venuesUserHasCapability } from "@/lib/venues/members";

/** Kolumnerna startsidan behöver av en egen listing. */
const OWN_LISTING_COLUMNS =
  "id, user_id, title, category, price, duration_minutes, is_active, created_at, event_date, event_time, image_url, slug, listing_type";

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  website: string | null;
  category: string | null;
  location: string | null;
  hourly_rate: number | null;
  is_public: boolean;
  tier: string | null;
  stripe_account_id: string | null;
  created_at: string;
  updated_at: string;
}

interface Listing {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  category: string;
  price: number | null;
  duration_minutes: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  event_date?: string | null;
  event_time?: string | null;
}

type TopCreator = Pick<Profile, "id" | "full_name" | "category" | "avatar_url">;

export default async function AppHomePage() {
  let profile: Profile | null = null;
  let listings: Listing[] = [];
  let ownServices: OwnListing[] = [];
  let ownServicesCount = 0;
  let topCreators: TopCreator[] = [];
  let bookingsCount = 0;
  let monthlyRevenue = 0;
  let averageRating: number | null = null;
  let feedPosts: any[] = [];
  let upcomingBookings: { id: string; title: string; scheduledAt: string; location: string | null }[] = [];
  let hasPreferences = false;
  let hostedEventsCount = 0;
  let todos: TodoItem[] = [];

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const today = todayInStockholm();
      const [profileRes, listingsRes, bookingsRes, kommandeRes, ovrigaRes, ownCountRes] = await Promise.all([
        // Egen rad via service-role: känsliga kolumner (bl.a. stripe_account_id)
        // är kolumn-låsta för authenticated, så select("*") skulle nekas.
        createAdminClient().from("profiles").select("*").eq("id", user.id).single(),
        supabase
          .from("listings")
          .select("*, profiles(full_name, avatar_url), ticket_types(id)")
          .eq("is_active", true)
          .eq("is_public", true)
          .order("created_at", { ascending: false })
          .limit(6),
        supabase
          .from("bookings")
          .select("*", { count: "exact", head: true })
          .eq("creator_id", user.id)
          .in("status", ["pending", "confirmed"]),
        // Egna evenemang, i två frågor. "De tio senast skapade" gav fel svar
        // på två sätt: en serie skapas i en klump så ordningen blev godtycklig
        // (19 okt, 5 okt, 28 sep på startsidan), och den som har mer än tio
        // rader kunde få nästa kväll utanför urvalet helt. Hämta det kommande
        // för sig, i datumordning, så kan det inte hända.
        supabase
          .from("listings")
          .select(OWN_LISTING_COLUMNS)
          .eq("user_id", user.id)
          .gte("event_date", today)
          .order("event_date", { ascending: true })
          .limit(10),
        supabase
          .from("listings")
          .select(OWN_LISTING_COLUMNS)
          .eq("user_id", user.id)
          .or(`event_date.lt.${today},event_date.is.null`)
          .order("created_at", { ascending: false })
          .limit(10),
        // Siffran i KPI-raden. Den läste tidigare listans längd, men listan är
        // kapad till tio — så 17 tjänster visades som "10". En kapad lista är
        // inget att räkna på.
        supabase
          .from("listings")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id),
      ]);
      profile = profileRes.data as Profile | null;
      listings = (listingsRes.data || []) as Listing[];
      // Kommande först i datumordning, sedan passerade och odaterade. Samma
      // ordning som arrangörens egen evenemangslista använder.
      ownServices = sortEventsForOwner([
        ...((kommandeRes.data || []) as OwnListing[]),
        ...((ovrigaRes.data || []) as OwnListing[]),
      ], today);
      ownServicesCount = ownCountRes.count ?? ownServices.length;
      bookingsCount = bookingsRes.count ?? 0;

      // Customer onboarding: have they set matching preferences?
      const { data: prefRow } = await supabase
        .from("profile_preferences")
        .select("onboarding_completed_at")
        .eq("profile_id", user.id)
        .maybeSingle();
      hasPreferences = !!prefRow?.onboarding_completed_at;

      // Arrangemang som ANDRA håller hos lokalen. En lokal som upplåter sina
      // lokaler skapar aldrig egna evenemang, och skulle annars få "skapa ditt
      // första evenemang" liggande kvar i checklistan för alltid.
      const { count: hosted } = await supabase
        .from("listings")
        .select("id", { count: "exact", head: true })
        .eq("venue_profile_id", user.id)
        .not("venue_confirmed_at", "is", null)
        .eq("is_active", true);
      hostedEventsCount = hosted ?? 0;

      // Sådant som väntar på ett svar. Marias åtta förfrågningar låg obesvarade
      // i två dygn utan att något sa till — startsidan får säga det nu.
      // Samma lokaler som förfrågningssidan visar: egna plus dem man sköter
      // sidan åt, annars ser en teammedlem en siffra hen inte kan agera på.
      const lokaler = [user.id, ...(await venuesUserHasCapability(user.id, "page"))];
      const [inkomna, utgaende] = await Promise.all([
        supabase
          .from("listings")
          .select("id", { count: "exact", head: true })
          .in("venue_profile_id", lokaler)
          .neq("user_id", user.id)
          .is("venue_confirmed_at", null)
          .eq("is_active", true),
        supabase
          .from("listings")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .not("venue_profile_id", "is", null)
          .neq("venue_profile_id", user.id)
          .is("venue_confirmed_at", null)
          .eq("is_active", true),
      ]);
      todos = pendingTodos({
        venueRequestsPending: inkomna.count,
        listingsAwaitingVenue: utgaende.count,
      });

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const [creatorsRes, revenueRes, reviewsRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, avatar_url, category, hourly_rate")
          .eq("is_public", true)
          // "Top creators" should actually be creators/venues, and deterministic
          // (was an arbitrary set of any public profile with no ordering).
          .in("role", ["creator", "venue"])
          .order("created_at", { ascending: false })
          .limit(8),
        supabase
          .from("payments")
          .select("amount")
          .eq("user_id", user.id)
          .eq("status", "succeeded")
          .gte("created_at", startOfMonth.toISOString()),
        supabase
          .from("reviews")
          .select("rating")
          .eq("creator_id", user.id),
      ]);

      topCreators = (creatorsRes.data || []) as TopCreator[];

      // Sum payments (amount is in öre, convert to SEK)
      monthlyRevenue = (revenueRes.data || []).reduce(
        (sum, p) => sum + (p.amount || 0),
        0
      ) / 100;

      // Calculate average rating
      const ratings = (reviewsRes.data || []).map((r) => r.rating);
      if (ratings.length > 0) {
        averageRating = Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10;
      }

      // Fetch feed posts
      try {
        feedPosts = await getFeedPosts(user.id);
      } catch {
        feedPosts = [];
      }

      // The user's next upcoming confirmed bookings (for the home "Kommande bokningar" card).
      const { data: upcomingRes } = await supabase
        .from("bookings")
        .select("id, scheduled_at, listings(title, event_location)")
        .eq("customer_id", user.id)
        .eq("status", "confirmed")
        .gte("scheduled_at", new Date().toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(3);
      upcomingBookings = (upcomingRes || []).map((b: any) => ({
        id: b.id,
        title: b.listings?.title || "Bokning",
        scheduledAt: b.scheduled_at,
        location: b.listings?.event_location ?? null,
      }));
    }
  } catch {
    // Continue with mock data
  }

  return (
    <HomeContent
      profile={profile}
      listings={listings}
      ownServices={ownServices}
      ownServicesCount={ownServicesCount}
      topCreators={topCreators}
      bookingsCount={bookingsCount}
      monthlyRevenue={monthlyRevenue}
      averageRating={averageRating}
      feedPosts={feedPosts}
      upcomingBookings={upcomingBookings}
      hasPreferences={hasPreferences}
      hostedEventsCount={hostedEventsCount}
      todos={todos}
    />
  );
}
