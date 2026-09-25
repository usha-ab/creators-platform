import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canScanListing } from "@/lib/scan-access";
import { isAdminById } from "@/lib/admin/check";

/**
 * Underlaget för entréförsäljningen: vilka biljetter som går att sälja, och
 * vilka som betalats sedan sist.
 *
 * Behörigheten är scannerns, inte ägarens. Den som står i dörren är ofta en
 * crew-medlem med can_scan och äger inte eventet — kräver vi ägarskap kan
 * personen checka in gäster men inte sälja till dem, vilket är precis fel
 * person att låsa ute.
 *
 * Ingen capability-grind heller: att ta betalt i dörren är inte en
 * analysfunktion, och en låst entré betyder utebliven försäljning.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: listingId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: listing } = await admin
    .from("listings")
    .select("id, title, slug, user_id, event_date, is_active")
    .eq("id", listingId)
    .maybeSingle();
  if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const allowed =
    listing.user_id === user.id ||
    (await isAdminById(user.id)) ||
    (await canScanListing(admin, user.id, listingId));
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: ticketTypes } = await admin
    .from("ticket_types")
    .select("id, name, price, capacity, tickets_sold")
    .eq("listing_id", listingId)
    .order("price", { ascending: true });

  // Färska betalningar driver bekräftelsen på entréskärmen. Utan den står
  // värden och väntar på att gästen ska hitta sitt mejl innan hen släpps in.
  //
  // `since` kommer från klienten och är därför inte att lita på som filter i
  // sig — men den kan bara begränsa en lista som redan är låst till det här
  // eventet, så det värsta en trasig tidsstämpel gör är att visa för mycket
  // eller för lite på skärmen.
  const sinceParam = req.nextUrl.searchParams.get("since");
  const since = sinceParam && !Number.isNaN(Date.parse(sinceParam)) ? sinceParam : null;

  let salesQuery = admin
    .from("bookings")
    .select("id, guest_name, guest_email, amount_paid, guest_count, ticket_type_name, created_at")
    .eq("listing_id", listingId)
    .eq("booking_type", "ticket")
    .in("status", ["confirmed", "completed"])
    .order("created_at", { ascending: false })
    .limit(10);
  if (since) salesQuery = salesQuery.gt("created_at", since);

  const { data: sales } = await salesQuery;

  return NextResponse.json({
    listing: { id: listing.id, title: listing.title, slug: listing.slug, isActive: listing.is_active },
    ticketTypes: ticketTypes ?? [],
    sales: sales ?? [],
    now: new Date().toISOString(),
  });
}
