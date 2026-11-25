import { stockholmToday } from "@/lib/time";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canOperateEntrance } from "@/lib/scan-access";
import { kioskAccessForOwner } from "@/lib/tickets/kiosk-access";
import { efterkopLage } from "@/lib/tickets/late-purchase";
import { formatSwishNumber, getSwishNumber } from "@/lib/swish/config";

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
    .select("id, title, slug, user_id, event_date, event_time, event_end_time, is_active")
    .eq("id", listingId)
    .maybeSingle();
  if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!(await canOperateEntrance(admin, user.id, listing))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
    .select("id, guest_name, guest_email, amount_paid, guest_count, ticket_type_name, created_at, payment_method")
    .eq("listing_id", listingId)
    .eq("booking_type", "ticket")
    .in("status", ["confirmed", "completed"])
    .order("created_at", { ascending: false })
    .limit(10);
  if (since) salesQuery = salesQuery.gt("created_at", since);

  const { data: sales } = await salesQuery;

  // Vilande Swish-köp från eventsidan: gästen har tryckt "Jag har swishat",
  // ingen har ännu jämfört mot Swish-appen. Hela listan varje gång (inte
  // sedan `since`) — en rad försvinner när den avgjorts, och det måste synas.
  const { data: pendingSwish } = await admin
    .from("bookings")
    .select("id, guest_name, guest_email, amount_paid, guest_count, ticket_type_name, created_at")
    .eq("listing_id", listingId)
    .eq("booking_type", "ticket")
    .eq("payment_method", "swish")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(20);

  // Kioskläget är Premium — grindat på värdens nivå, se kiosk-access.ts.
  const kiosk = await kioskAccessForOwner(admin, listing.user_id);

  // Swish i dörren: bara när Usha själv är säljare (pengarna landar på
  // bolagets konto) och numret är satt i app_config.
  const [{ data: owner }, swishNumber] = await Promise.all([
    admin.from("profiles").select("is_usha_owned_seller").eq("id", listing.user_id).maybeSingle(),
    getSwishNumber(admin),
  ]);
  const swish = owner?.is_usha_owned_seller && swishNumber ? { enabled: true, number: swishNumber, formatted: formatSwishNumber(swishNumber) } : { enabled: false };

  // Efterköpsläget avgörs på SERVERN, inte av entréenhetens klocka. En telefon
  // som går några minuter fel skulle annars antingen stänga fönstret för
  // tidigt eller visa det när det faktiskt gått ut.
  const lage = efterkopLage(listing.event_date, new Date(), listing);

  return NextResponse.json({
    // Datumet och om det är i dag avgörs här, inte av telefonens klocka. 17 nov
    // registrerades ett Swish-köp i dörren på nästa veckas kväll — sidorna för
    // en serie har samma titel och gick inte att skilja åt.
    listing: {
      id: listing.id,
      title: listing.title,
      slug: listing.slug,
      isActive: listing.is_active,
      eventDate: listing.event_date ?? null,
      isToday: !listing.event_date || listing.event_date === stockholmToday(),
    },
    efterkop: {
      oppet: lage.kind === "oppet",
      stangerVid: lage.kind === "oppet" ? lage.stangerVid.toISOString() : null,
      stangt: lage.kind === "stangt",
    },
    ticketTypes: ticketTypes ?? [],
    sales: sales ?? [],
    pendingSwish: pendingSwish ?? [],
    kiosk,
    swish,
    now: new Date().toISOString(),
  });
}
