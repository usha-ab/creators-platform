import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getRateLimitKey } from "@/lib/rate-limit";
import { verifyCookieValue } from "@/lib/signicat/crypto";
import { createEmailCode, normalizeEmail, EMAIL_CODE_COOKIE, EMAIL_CODE_TTL_MS } from "@/lib/bankid/email-code";
import { sendSignupCodeEmail } from "@/lib/email/send-signup-code";
import type { BankIdVerifiedData } from "@/types/bankid";

/**
 * Konto med BankID, steg 1: skicka en kod till e-postadressen. Kräver en
 * färsk BankID-identifiering (bankid_verified-cookien), så ingen kan använda
 * routen för att skicka mejl till godtyckliga adresser utan att först ha
 * legitimerat sig.
 */
export async function POST(req: NextRequest) {
  const verified = req.cookies.get("bankid_verified")?.value;
  if (!verified || !verifyCookieValue<BankIdVerifiedData>(verified)) {
    return NextResponse.json({ error: "bankid_expired" }, { status: 401 });
  }

  let body: { email?: unknown; locale?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const email = normalizeEmail(body.email);
  if (!email) return NextResponse.json({ error: "invalid_email" }, { status: 400 });

  const byIp = rateLimit(getRateLimitKey(req, "bankid-code"), 5, 10 * 60_000);
  const byEmail = rateLimit(`bankid-code:${email}`, 3, 60 * 60_000);
  if (!byIp.allowed || !byEmail.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { code, cookie } = createEmailCode(email);
  try {
    await sendSignupCodeEmail({
      to: email,
      code,
      locale: typeof body.locale === "string" ? body.locale : null,
    });
  } catch {
    return NextResponse.json({ error: "send_failed" }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(EMAIL_CODE_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: EMAIL_CODE_TTL_MS / 1000,
  });
  return response;
}
