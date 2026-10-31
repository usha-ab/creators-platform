import { NextRequest, NextResponse } from "next/server";
import { birthDateOrNull } from "@/lib/bankid/birth-date";
import { getBankIdSessionResult } from "@/lib/signicat/client";
import { signCookieValue, verifyCookieValue, hashPersonalNumber } from "@/lib/signicat/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { computeAge } from "@/lib/age";
import type { BankIdVerifiedData } from "@/types/bankid";
import { findBankIdLoginTarget } from "@/lib/bankid/login";
import { signInServerSide, finishSignIn } from "@/lib/bankid/session";

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const status = searchParams.get("status");
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || origin;

  const sessionCookie = req.cookies.get("bankid_session")?.value;
  if (!sessionCookie) {
    return NextResponse.redirect(`${baseUrl}/signup?bankid=error`);
  }

  // Verify the signed cookie — it carries server-trusted role/mode/next.
  const sessionData = verifyCookieValue<{
    sessionId: string;
    role: string;
    subcategory?: string;
    mode?: "signup" | "add" | "login";
    next?: string | null;
  }>(sessionCookie);
  if (!sessionData) {
    return NextResponse.redirect(`${baseUrl}/signup?bankid=error`);
  }

  const isAddMode = sessionData.mode === "add";
  const isLoginMode = sessionData.mode === "login";
  const safeNext = typeof sessionData.next === "string" && sessionData.next.startsWith("/") && !sessionData.next.startsWith("//") ? sessionData.next : null;
  const addSuccessBase = safeNext ? `${baseUrl}${safeNext}` : `${baseUrl}/dashboard/profile`;
  const errorBase = isAddMode
    ? `${baseUrl}/dashboard/profile`
    : isLoginMode
      ? `${baseUrl}/login`
      : `${baseUrl}/signup`;

  if (status !== "success") {
    const response = NextResponse.redirect(
      `${errorBase}?bankid=${status === "abort" ? "aborted" : "failed"}`
    );
    response.cookies.set("bankid_session", "", { path: "/", maxAge: 0 });
    return response;
  }

  try {
    const result = await getBankIdSessionResult(sessionData.sessionId);

    if (result.status !== "SUCCESS" || !result.subject) {
      const response = NextResponse.redirect(`${errorBase}?bankid=failed`);
      response.cookies.set("bankid_session", "", { path: "/", maxAge: 0 });
      return response;
    }

    const { firstName, lastName, name, dateOfBirth, nin } = result.subject;

    if (sessionData.subcategory === "taxi_dancer") {
      const age = computeAge(dateOfBirth);
      if (age < 18) {
        const response = NextResponse.redirect(
          `${errorBase}?bankid=age_restricted`
        );
        response.cookies.set("bankid_session", "", { path: "/", maxAge: 0 });
        return response;
      }
    }

    const hashedNin = hashPersonalNumber(nin.value);

    const admin = createAdminClient();

    // Fortsätt med BankID: finns ett konto kopplat loggas det in direkt, med en
    // session som skapas på servern. Annars går man vidare till att skapa ett
    // konto (/signup/bankid) med den verifierade identiteten i den signerade
    // bankid_verified-cookien, precis som vid vanlig BankID-registrering.
    if (isLoginMode) {
      const target = await findBankIdLoginTarget(admin, hashedNin);
      if (!target.ok && target.reason === "no_account") {
        const verified: BankIdVerifiedData = {
          name,
          firstName,
          lastName,
          dateOfBirth,
          hashedNin,
          verifiedAt: new Date().toISOString(),
          role:
            sessionData.role === "creator" || sessionData.role === "venue" ? sessionData.role : "customer",
          subcategory: sessionData.subcategory === "taxi_dancer" ? "taxi_dancer" : "general",
        };
        const createUrl = `${baseUrl}/signup/bankid${safeNext ? `?next=${encodeURIComponent(safeNext)}` : ""}`;
        const response = NextResponse.redirect(createUrl);
        response.cookies.set("bankid_verified", signCookieValue(verified), {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 600,
        });
        response.cookies.set("bankid_session", "", { path: "/", maxAge: 0 });
        return response;
      }
      if (!target.ok) {
        const response = NextResponse.redirect(`${errorBase}?bankid=${target.reason}`);
        response.cookies.set("bankid_session", "", { path: "/", maxAge: 0 });
        return response;
      }

      await signInServerSide(admin, target.email);
      const response = NextResponse.redirect(`${baseUrl}${safeNext ?? "/app"}`);
      response.cookies.set("bankid_session", "", { path: "/", maxAge: 0 });
      await finishSignIn(admin, response, { id: target.userId, email: target.email });
      return response;
    }

    let currentUserId: string | null = null;
    if (isAddMode) {
      const userClient = await createClient();
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) {
        const response = NextResponse.redirect(`${baseUrl}/login?bankid=unauthenticated`);
        response.cookies.set("bankid_session", "", { path: "/", maxAge: 0 });
        return response;
      }
      currentUserId = user.id;
    }

    const dupQuery = admin
      .from("profiles")
      .select("id")
      .eq("bankid_personal_number", hashedNin);
    if (currentUserId) dupQuery.neq("id", currentUserId);
    const { data: existing } = await dupQuery.maybeSingle();

    if (existing) {
      const response = NextResponse.redirect(`${errorBase}?bankid=duplicate`);
      response.cookies.set("bankid_session", "", { path: "/", maxAge: 0 });
      return response;
    }

    if (isAddMode && currentUserId) {
      const { error: updateErr } = await admin
        .from("profiles")
        .update({
          bankid_personal_number: hashedNin,
          bankid_verified_at: new Date().toISOString(),
          bankid_name: name,
          bankid_birth_date: birthDateOrNull(dateOfBirth),
        })
        .eq("id", currentUserId);

      if (updateErr) {
        console.error("BankID add-mode update failed:", updateErr.message);
        const response = NextResponse.redirect(`${errorBase}?bankid=error`);
        response.cookies.set("bankid_session", "", { path: "/", maxAge: 0 });
        return response;
      }

      const successUrl = safeNext
        ? `${baseUrl}${safeNext}${safeNext.includes("?") ? "&" : "?"}bankid=success`
        : `${baseUrl}/dashboard/profile?bankid=success`;
      const response = NextResponse.redirect(successUrl);
      response.cookies.set("bankid_session", "", { path: "/", maxAge: 0 });
      return response;
    }

    const verifiedData: BankIdVerifiedData = {
      name,
      firstName,
      lastName,
      dateOfBirth,
      hashedNin,
      verifiedAt: new Date().toISOString(),
      role: sessionData.role as "creator" | "venue",
      subcategory:
        sessionData.subcategory === "taxi_dancer" ? "taxi_dancer" : "general",
    };

    const signedValue = signCookieValue(verifiedData);

    const response = NextResponse.redirect(`${baseUrl}/signup?bankid=success`);
    response.cookies.set("bankid_verified", signedValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    response.cookies.set("bankid_session", "", { path: "/", maxAge: 0 });
    return response;
  } catch (err) {
    console.error("BankID callback error:", err);
    const response = NextResponse.redirect(`${errorBase}?bankid=error`);
    response.cookies.set("bankid_session", "", { path: "/", maxAge: 0 });
    return response;
  }
}
