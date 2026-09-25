import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canScanListing } from "@/lib/scan-access";
import { isAdminById } from "@/lib/admin/check";
import { buildEntryBuyUrl } from "@/lib/entry/buy-url";

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
    .select("id, slug, user_id")
    .eq("id", listingId)
    .maybeSingle();
  if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const allowed =
    listing.user_id === user.id ||
    (await isAdminById(user.id)) ||
    (await canScanListing(admin, user.id, listingId));
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

  const url = buildEntryBuyUrl({
    appUrl: process.env.NEXT_PUBLIC_APP_URL || "https://usha.se",
    slug: listing.slug,
    ticketTypeId,
  });
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
      "Cache-Control": "private, max-age=300",
    },
  });
}
