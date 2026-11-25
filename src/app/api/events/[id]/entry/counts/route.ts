import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { canOperateEntrance } from "@/lib/scan-access";
import { rateLimit, getRateLimitKey } from "@/lib/rate-limit";
import { entryCounts, type CountAttendee, type CountBooking } from "@/lib/tickets/entry-counts";
import { checkinColor } from "@/lib/tickets/checkin-color";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/events/[id]/entry/counts — sålda, incheckade och inte komna.
 *
 * Hämtas var 10:e sekund av kiosken (/sjalvinslapp/[id]) och dörrskärmen
 * (/dorr/[serie]) så att den som står i dörren ser hur många som är kvar att
 * vänta på. Med följer kvällens färg (lib/tickets/checkin-color.ts) — samma
 * som på gästernas levande biljetter.
 *
 * Samma grind som entréförsäljningen: ägaren, en admin eller crew med
 * can_scan. Siffrorna och färgen är inget för vem som helst.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // 10 s-polling från ett par plattor bakom samma nät ryms med marginal.
  const rl = rateLimit(getRateLimitKey(req, "entry-counts"), 60, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const { id: listingId } = await params;
  if (!UUID.test(listingId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: listing } = await admin.from("listings").select("id, user_id, event_date").eq("id", listingId).maybeSingle();
  if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canOperateEntrance(admin, user.id, listing))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: bookings } = await admin
    .from("bookings")
    .select("id, status, guest_count, checked_in_at")
    .eq("listing_id", listingId)
    .eq("booking_type", "ticket")
    .in("status", ["confirmed", "completed"]);
  const rows = (bookings ?? []) as CountBooking[];
  const multi = rows.filter((b) => (b.guest_count ?? 1) > 1).map((b) => b.id);

  const [{ data: attendees }, { count: clips }] = await Promise.all([
    multi.length
      ? admin.from("ticket_attendees").select("booking_id, checked_in_at").in("booking_id", multi)
      : Promise.resolve({ data: [] as CountAttendee[] }),
    admin.from("pass_redemptions").select("id", { count: "exact", head: true }).eq("listing_id", listingId),
  ]);

  const counts = entryCounts(rows, (attendees ?? []) as CountAttendee[], clips ?? 0);
  const color = checkinColor(listing.id, listing.event_date);

  return NextResponse.json(
    { ...counts, color: color ? { bg: color.bg, fg: color.fg, key: color.key } : null, at: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
