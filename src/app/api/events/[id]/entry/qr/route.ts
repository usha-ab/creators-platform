import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canOperateEntrance } from "@/lib/scan-access";
import { buildEntryBuyUrl } from "@/lib/entry/buy-url";
import { createLateCheckoutSession } from "@/lib/tickets/late-checkout";
import { getStripeLocale } from "@/lib/i18n/stripe-locale";

/**
 * QR-koden gästen scannar i dörren.
 *
 * Servern bygger länken själv ur eventets slug och biljettens id — den tar
 * aldrig emot en färdig URL att koda. En öppen QR-generator hade blivit ett
 * bekvämt sätt att få usha.se att trycka en kod som pekar var som helst.
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
  // entrévärd få fram en kod som säljer någon annans biljett.
  const requestedType = req.nextUrl.searchParams.get("tt");
  let ticketTypeId: string | null = null;
  if (requestedType) {
    const { data: tt } = await admin
      .from("ticket_types")
      .select("id")
      .eq("id", requestedType)
      .eq("listing_id", listingId)
      .maybeSingle();
    if (!tt) return NextResponse.json({ error: "Unknown ticket type" }, { status: 400 });
    ticketTypeId = tt.id;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://usha.se";

  // EFTERKÖP: kvällen har varit, och gästen ska betala för den ändå.
  //
  // Den publika sidan nekar ett passerat event, och det ska den göra. Därför
  // pekar koden här rakt in i Stripe i stället: betalningen skapas på
  // serversidan av någon som stod i dörren, och gästen möter aldrig grinden.
  // Fönstret kontrolleras i createLateCheckoutSession, inte här.
  let url: string | null;
  if (req.nextUrl.searchParams.get("efterkop") === "1") {
    const { data: creator } = await admin
      .from("profiles")
      .select(
        "stripe_account_id, stripe_card_payments_enabled, is_usha_owned_seller, " +
          "company_name, org_number, full_name, company_verified_at, tier, creator_subcategory, terms_url"
      )
      .eq("id", listing.user_id)
      .maybeSingle();
    if (!creator) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    let tt: { id: string; name: string; price: number } | null = null;
    if (ticketTypeId) {
      const { data } = await admin
        .from("ticket_types")
        .select("id, name, price")
        .eq("id", ticketTypeId)
        .maybeSingle();
      tt = (data as { id: string; name: string; price: number } | null) ?? null;
    }

    const result = await createLateCheckoutSession({
      listing: listing as unknown as Parameters<typeof createLateCheckoutSession>[0]["listing"],
      creator: creator as unknown as Parameters<typeof createLateCheckoutSession>[0]["creator"],
      ticketType: tt,
      appUrl,
      locale: await getStripeLocale(),
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    url = result.url;
  } else {
    url = buildEntryBuyUrl({ appUrl, slug: listing.slug, ticketTypeId });
  }
  if (!url) return NextResponse.json({ error: "Event saknar publik sida" }, { status: 400 });

  // Stor och feltolerant: koden läses på en telefonskärm i dörrljus, ofta i
  // vinkel och genom fingeravtryck.
  const png = await QRCode.toBuffer(url, {
    width: 720,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      // Ett efterköp är en FÄRSK betalningslänk varje gång. Cachas den kan
      // nästa gäst få upp föregående gästs session.
      "Cache-Control":
        req.nextUrl.searchParams.get("efterkop") === "1"
          ? "private, no-store"
          : "private, max-age=300",
    },
  });
}
