import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit, getRateLimitKey } from "@/lib/rate-limit";
import { commerce } from "@/lib/swish/commerce";
import { tokenForQr } from "@/lib/swish/commerce/payment";

export const dynamic = "force-dynamic";

/**
 * GET /api/swish/commerce/qr?id=<instructionUUID> — QR-koden för datorn,
 * från Swishs eget QR-API. Bara för en förfrågan vi själva skapat och som
 * fortfarande väntar; vi skickar aldrig vidare en token som någon annan valt.
 */
export async function GET(req: NextRequest) {
  const c = commerce();
  if (!c) return NextResponse.json({ error: "disabled" }, { status: 404 });

  const rl = rateLimit(getRateLimitKey(req, "swish-commerce-qr"), 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const token = await tokenForQr(createAdminClient(), (req.nextUrl.searchParams.get("id") ?? "").toUpperCase());
  if (!token) return NextResponse.json({ error: "notFound" }, { status: 404 });
  try {
    const png = await c.client.qr(token);
    return new NextResponse(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "qrFailed" }, { status: 502 });
  }
}
