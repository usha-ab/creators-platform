import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail } from "@/lib/email/normalize";
import { appleWalletConfigured, googleWalletConfigured } from "@/lib/tickets/wallet";
import { TicketsContent } from "./tickets-content";

const BOOKING_SELECT =
  "id, listing_id, scheduled_at, status, notes, amount_paid, stripe_payment_id, is_free, booking_type, creator_id, ticket_type_name, checked_in_at, guest_count, listings(title, category, price, listing_type, image_url, event_date, event_time, event_location)";

export default async function TicketsPage() {
  let bookings: any[] = [];
  let canScan = false;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      // Scanning is a paid feature (Gold/Premium) for EVERYONE — creators,
      // venues AND delegated crew (volunteers/team). Free accounts don't get
      // the option. (Scanning moved off the bottom nav into the Tickets page.)
      const { data: prof } = await supabase.from("profiles").select("role, tier").eq("id", user.id).maybeSingle();
      // "Paid" = Gold/Premium tier, an active/trialing subscription, or — during
      // the free beta — everyone (mirrors hasActiveSubscription on the scan page).
      let paid = prof?.tier === "guld" || prof?.tier === "premium";
      if (!paid) {
        const { BETA_MODE } = await import("@/lib/beta");
        if (BETA_MODE) {
          paid = true;
        } else {
          const { data: sub } = await supabase
            .from("subscriptions")
            .select("status")
            .eq("user_id", user.id)
            .in("status", ["active", "trialing"])
            .maybeSingle();
          paid = !!sub;
        }
      }
      if (paid) {
        const isHost = prof?.role === "creator" || prof?.role === "venue";
        canScan = isHost;
        if (!canScan) {
          const { data: deleg } = await supabase
            .from("listing_collaborators")
            .select("id")
            .eq("user_id", user.id)
            .eq("status", "accepted")
            .eq("can_scan", true)
            .limit(1)
            .maybeSingle();
          canScan = !!deleg;
        }
      }

      // Own bookings (RLS-scoped to this user).
      const { data: own } = await supabase
        .from("bookings")
        .select(BOOKING_SELECT)
        .eq("customer_id", user.id)
        .order("scheduled_at", { ascending: false });

      // Guest bookings made with this user's email BEFORE they had an account.
      // These have customer_id = null, so RLS hides them from the user client —
      // fetch them narrowly by exact email via the admin client and merge.
      let guest: any[] = [];
      const ownEmail = normalizeEmail(user.email);
      if (ownEmail) {
        const { data } = await createAdminClient()
          .from("bookings")
          .select(BOOKING_SELECT)
          .is("customer_id", null)
          // Skiftlägesokänsligt: gamla gästrader kan vara sparade som de
          // skrevs. ilike utan jokertecken är en ren jämförelse.
          .ilike("guest_email", ownEmail)
          .order("scheduled_at", { ascending: false });
        guest = data || [];
      }

      // Merge + dedupe by id (a person may have both a guest and an account row).
      const byId = new Map<string, any>();
      for (const b of [...(own || []), ...guest]) byId.set(b.id, b);
      const merged = Array.from(byId.values());

      // Fetch creator info for each unique creator
      const creatorIds = Array.from(new Set(merged.map((b: any) => b.creator_id).filter(Boolean)));
      const { data: creators } = creatorIds.length
        ? await supabase
            .from("profiles")
            .select("id, full_name, avatar_url")
            .in("id", creatorIds)
        : { data: [] };

      const creatorMap = new Map((creators || []).map((c: any) => [c.id, c]));

      // Enrich bookings with creator info
      bookings = merged.map((b: any) => ({
        ...b,
        creator: creatorMap.get(b.creator_id) || null,
      }));
    }
  } catch {
    // Continue with empty data
  }

  return (
    <TicketsContent
      bookings={bookings}
      canScan={canScan}
      appleWallet={appleWalletConfigured()}
      googleWallet={googleWalletConfigured()}
    />
  );
}
