import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit, getRateLimitKey } from "@/lib/rate-limit";
import { commerce, swishAppUrl } from "@/lib/swish/commerce";
import { startPayment } from "@/lib/swish/commerce/payment";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/swish/commerce/start — { bookingId }
 *
 * Swish Handel: skapar en betalningsförfrågan för en vilande Swish-bokning
 * och returnerar token-länken (mobil) och QR-adressen (dator). Bokningens
 * UUID är nyckeln, som för biljettsidan. Beloppet tas alltid ur bokningen,
 * aldrig ur anropet.
 *
 * 404 när Swish Handel är av: då gäller Swish Företag som förut.
 */
export async function POST(req: NextRequest) {
  const c = commerce();
  if (!c) return NextResponse.json({ error: "disabled" }, { status: 404 });

  const rl = rateLimit(getRateLimitKey(req, "swish-commerce-start"), 10, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let payload: { bookingId?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "badRequest" }, { status: 400 });
  }
  const bookingId = String(payload.bookingId ?? "");
  if (!UUID.test(bookingId)) return NextResponse.json({ error: "badRequest" }, { status: 400 });

  const r = await startPayment(createAdminClient(), c.client, c.cfg, bookingId);
  if (!r.ok) {
    const status = r.error === "swishFailed" ? 502 : r.error === "notPending" || r.error === "alreadyPaid" ? 409 : 400;
    return NextResponse.json({ error: r.error, codes: r.codes }, { status });
  }

  const site = process.env.NEXT_PUBLIC_APP_URL || "https://usha.se";
  return NextResponse.json({
    instructionId: r.instructionId,
    reused: r.reused,
    appUrl: swishAppUrl(r.token, `${site}/biljett/${bookingId}`),
    qrUrl: `/api/swish/commerce/qr?id=${r.instructionId}`,
  });
}
