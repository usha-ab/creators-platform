import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit, getRateLimitKey } from "@/lib/rate-limit";
import { commerce } from "@/lib/swish/commerce";
import { pollBooking } from "@/lib/swish/commerce/payment";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/swish/commerce/status?booking=<id> — biljettsidan frågar medan
 * gästen godkänner i Swish. Uteblir callbacken frågar servern Swish själv.
 */
export async function GET(req: NextRequest) {
  const c = commerce();
  if (!c) return NextResponse.json({ error: "disabled" }, { status: 404 });

  const rl = rateLimit(getRateLimitKey(req, "swish-commerce-status"), 60, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const bookingId = req.nextUrl.searchParams.get("booking") ?? "";
  if (!UUID.test(bookingId)) return NextResponse.json({ error: "badRequest" }, { status: 400 });

  const r = await pollBooking(createAdminClient(), c.client, bookingId);
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}
