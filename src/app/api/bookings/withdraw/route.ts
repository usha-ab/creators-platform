import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit, getRateLimitKey } from "@/lib/rate-limit";
import { withdrawPurchase } from "@/lib/bookings/withdraw";

/**
 * Ångra köpet (2 kap. 10 a § distansavtalslagen).
 *
 * Åtkomstmodellen är biljettsidans: den som har bokningens id har biljetten.
 * Gäster har ingen inloggning, och ångerfunktionen ska vara lika lätt att nå
 * som köpet. Utöver länken måste köparens e-postadress stämma, och köparen
 * måste uttryckligen bekräfta (confirm: true).
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(getRateLimitKey(req, "withdraw"), 5, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: "rateLimited" }, { status: 429 });

  let body: { bookingId?: unknown; name?: unknown; email?: unknown; confirm?: unknown; locale?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "badRequest" }, { status: 400 });
  }

  const bookingId = typeof body.bookingId === "string" ? body.bookingId : "";
  const name = typeof body.name === "string" ? body.name : "";
  const email = typeof body.email === "string" ? body.email : "";
  if (!/^[0-9a-f-]{36}$/i.test(bookingId) || !email.includes("@") || body.confirm !== true) {
    return NextResponse.json({ error: "badRequest" }, { status: 400 });
  }

  const result = await withdrawPurchase(createAdminClient(), {
    bookingId,
    name,
    email,
    locale: typeof body.locale === "string" ? body.locale : null,
  });

  if (!result.ok) {
    const status = result.error === "notFound" ? 404 : result.error === "failed" ? 500 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json(result);
}
