import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canOperateEntrance } from "@/lib/scan-access";
import { createLateCheckoutSession } from "@/lib/tickets/late-checkout";
import { getStripeLocale } from "@/lib/i18n/stripe-locale";

/**
 * Betallänken för ett efterköp, att skicka till någon som inte står bredvid.
 *
 * QR-koden i dörren löser fallet där gästen är framför dig. Den här rutten
 * löser det andra: någon hör av sig dagen efter och säger att hen glömde
 * betala. Då behövs en länk att klistra in i ett meddelande, inte en bild på
 * en skärm.
 *
 * Samma grindar som QR-koden — bara den som sköter entrén, bara inom
 * efterköpsfönstret, bara för kvällens egna biljettyper. Skillnaden är
 * livslängden: en timme i stället för en halvtimme, eftersom mottagaren ska
 * hinna öppna meddelandet.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: listingId } = await params;

  // Länken är en betalning i Ushas namn. Att kunna be om godtyckligt många
  // per minut vore ett sätt att fylla Stripe med skräpsessioner.
  const { rateLimit, getRateLimitKey } = await import("@/lib/rate-limit");
  const rl = rateLimit(getRateLimitKey(req, "efterkop-lank"), 20, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: listing } = await admin
    .from("listings")
    .select(
      "id, slug, user_id, title, price, event_date, event_time, event_end_time, series_slug, service_fee_mode, vat_rate"
    )
    .eq("id", listingId)
    .maybeSingle();
  if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!(await canOperateEntrance(admin, user.id, listing))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Biljettypen måste tillhöra det här eventet. Annars kunde en giltig
  // entrévärd få fram en länk som säljer någon annans biljett.
  const requested = req.nextUrl.searchParams.get("tt");
  let ticketType: { id: string; name: string; price: number } | null = null;
  if (requested) {
    const { data } = await admin
      .from("ticket_types")
      .select("id, name, price")
      .eq("id", requested)
      .eq("listing_id", listingId)
      .maybeSingle();
    if (!data) return NextResponse.json({ error: "Unknown ticket type" }, { status: 400 });
    ticketType = data as { id: string; name: string; price: number };
  }

  const { data: creator } = await admin
    .from("profiles")
    .select(
      "stripe_account_id, stripe_card_payments_enabled, is_usha_owned_seller, " +
        "company_name, org_number, full_name, company_verified_at, tier, creator_subcategory, terms_url"
    )
    .eq("id", listing.user_id)
    .maybeSingle();
  if (!creator) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await createLateCheckoutSession({
    listing: listing as unknown as Parameters<typeof createLateCheckoutSession>[0]["listing"],
    creator: creator as unknown as Parameters<typeof createLateCheckoutSession>[0]["creator"],
    ticketType,
    appUrl: process.env.NEXT_PUBLIC_APP_URL || "https://usha.se",
    locale: await getStripeLocale(),
    expiresInMinutes: 60,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(
    { url: result.url, expiresAt: result.expiresAt, amountOre: result.amountOre },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
