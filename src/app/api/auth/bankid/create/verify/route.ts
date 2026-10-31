import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getRateLimitKey } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCookieValue } from "@/lib/signicat/crypto";
import { checkEmailCode, EMAIL_CODE_COOKIE } from "@/lib/bankid/email-code";
import { applyBankIdVerification } from "@/lib/bankid/apply-verification";
import { markEmailProven } from "@/lib/auth/email-proven";
import { signInServerSide, finishSignIn } from "@/lib/bankid/session";
import { REF_COOKIE, claimReferral } from "@/lib/affiliate/attribution";
import { locales } from "@/i18n/config";
import type { BankIdVerifiedData } from "@/types/bankid";

/**
 * Konto med BankID, steg 2: rätt kod → kontot skapas (eller, om adressen redan
 * har ett konto, loggas det in) och BankID kopplas. Inget lösenord.
 *
 * Ett befintligt konto behåller sin roll; BankID kopplas bara om kontot inte
 * redan bär någon annans BankID.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(getRateLimitKey(req, "bankid-verify"), 10, 10 * 60_000);
  if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const verifiedCookie = req.cookies.get("bankid_verified")?.value;
  const bankid = verifiedCookie ? verifyCookieValue<BankIdVerifiedData>(verifiedCookie) : null;
  if (!bankid) return NextResponse.json({ error: "bankid_expired" }, { status: 401 });

  let body: { code?: unknown; marketingConsent?: unknown; locale?: unknown; ref?: unknown; next?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const check = checkEmailCode(req.cookies.get(EMAIL_CODE_COOKIE)?.value, body.code);
  if (!check.ok) return NextResponse.json({ error: `code_${check.reason}` }, { status: 400 });
  const email = check.email;

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("profiles")
    .select("id, bankid_personal_number")
    .eq("email", email)
    .is("deleted_at", null)
    .maybeSingle();

  let userId: string;
  let createdAt: string | undefined;
  if (existing) {
    if (existing.bankid_personal_number && existing.bankid_personal_number !== bankid.hashedNin) {
      return NextResponse.json({ error: "other_bankid" }, { status: 409 });
    }
    userId = existing.id;
    await markEmailProven(admin, userId, email);
  } else {
    const locale =
      typeof body.locale === "string" && (locales as readonly string[]).includes(body.locale) ? body.locale : "sv";
    const ref = typeof body.ref === "string" ? body.ref.toUpperCase() : undefined;
    // Samma metadata som registreringsformuläret skickar; handle_new_user
    // allow-listar rollen och skapar profil + user_settings.
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      // Koden till adressen bevisar att personen äger den.
      app_metadata: { email_proven: email },
      user_metadata: {
        full_name: bankid.name,
        role: bankid.role,
        ...(bankid.role === "creator" && bankid.subcategory ? { creator_subcategory: bankid.subcategory } : {}),
        marketing_consent: body.marketingConsent === true ? "true" : "false",
        locale,
        ...(ref ? { referred_by_code: ref } : {}),
      },
    });
    if (error || !created?.user) {
      console.error("BankID create user failed:", error?.message);
      return NextResponse.json({ error: "create_failed" }, { status: 500 });
    }
    userId = created.user.id;
    createdAt = created.user.created_at;
  }

  const applied = await applyBankIdVerification(admin, userId, bankid, {
    subcategory: existing ? undefined : bankid.subcategory,
  });
  if (!applied.ok && applied.reason !== "age_restricted") {
    return NextResponse.json({ error: applied.reason }, { status: applied.reason === "duplicate" ? 409 : 500 });
  }

  if (!existing) {
    await claimReferral(admin, {
      userId,
      code: req.cookies.get(REF_COOKIE)?.value ?? (typeof body.ref === "string" ? body.ref : undefined),
      createdAt,
    });
  }

  try {
    await signInServerSide(admin, email);
  } catch (err) {
    console.error("BankID create sign-in failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "signin_failed" }, { status: 500 });
  }

  const next =
    typeof body.next === "string" && body.next.startsWith("/") && !body.next.startsWith("//") ? body.next : "/app";
  const response = NextResponse.json({ ok: true, next, created: !existing });
  response.cookies.set("bankid_verified", "", { path: "/", maxAge: 0 });
  response.cookies.set(EMAIL_CODE_COOKIE, "", { path: "/", maxAge: 0 });
  await finishSignIn(admin, response, { id: userId, email, emailProven: true });
  return response;
}
