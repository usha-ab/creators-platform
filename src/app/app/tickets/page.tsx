import { createClient } from "@/lib/supabase/server";
import { isEmailProven } from "@/lib/auth/email-proven";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail } from "@/lib/email/normalize";
import { appleWalletConfigured, googleWalletConfigured } from "@/lib/tickets/wallet";
import { TicketsContent } from "./tickets-content";
import { checkinButtonMode } from "@/lib/tickets/evening";
import { isPaidBooking } from "@/lib/tickets/checkin";

/**
 * Självincheckningens läge per biljett, avgjort på servern:
 * "open" = fönstret är öppet och det finns något kvar att checka in,
 * "live" = incheckad och kvällen pågår (visa den levande biljetten).
 * Klippkort hanteras på biljettsidan — kortets egen post har inget datum.
 */
function selfCheckinState(b: any, now: Date): "open" | "live" | null {
  const listing = Array.isArray(b.listings) ? b.listings[0] : b.listings;
  if (!listing?.event_date || b.booking_type !== "ticket") return null;
  const mode = checkinButtonMode(now, listing);
  if (b.checked_in_at) return mode === "checkin" ? "live" : null;
  return mode === "checkin" && isPaidBooking(b) ? "open" : null;
}

const BOOKING_SELECT =
  "id, listing_id, scheduled_at, status, notes, amount_paid, stripe_payment_id, is_free, booking_type, creator_id, ticket_type_name, checked_in_at, guest_count, refunded_at, listings(title, category, price, listing_type, image_url, event_date, event_time, event_end_time, event_location)";

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
      // Lokaler räknas som betalande här: deras nivåer är avvecklade och går
      // inte att köpa (se lib/scan-host-paid.ts).
      let paid = prof?.tier === "guld" || prof?.tier === "premium" || prof?.role === "venue";
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
      const isHost = prof?.role === "creator" || prof?.role === "venue";
      if (paid && isHost) {
        canScan = true;
      } else {
        // Crew och dörrteam: skanna-rätten följer VÄRDENS nivå. Har en
        // betalande värd delegerat skanning behövs ingen egen prenumeration;
        // med egen betald nivå räcker det att någon delegerat.
        const { delegatedScanAccess } = await import("@/lib/scan-host-paid");
        const { delegated, hostPaid } = await delegatedScanAccess(createAdminClient(), user.id);
        canScan = delegated && (paid || hostPaid);
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
      // Bara om kontot bevisat att det äger adressen — annars kunde vem som
      // helst registrera en annans adress och se (och använda) dennes biljetter.
      const ownEmail = isEmailProven(user) ? normalizeEmail(user.email) : null;
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
      const now = new Date();
      bookings = merged.map((b: any) => ({
        ...b,
        self_checkin: selfCheckinState(b, now),
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
