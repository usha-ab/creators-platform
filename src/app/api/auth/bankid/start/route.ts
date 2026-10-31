import { NextRequest, NextResponse } from "next/server";
import { createBankIdSession } from "@/lib/signicat/client";
import { signCookieValue } from "@/lib/signicat/crypto";

export async function POST(req: NextRequest) {
  try {
    const { role, subcategory, mode, next } = await req.json();

    const resolvedMode: "signup" | "add" | "login" =
      mode === "add" ? "add" : mode === "login" ? "login" : "signup";

    // Varje start skapar en session hos Signicat; begränsa per IP.
    const { rateLimit, getRateLimitKey } = await import("@/lib/rate-limit");
    const rl = rateLimit(getRateLimitKey(req, "bankid-start"), 10, 60_000);
    if (!rl.allowed) {
      return NextResponse.json({ error: "För många försök. Försök igen om en stund." }, { status: 429 });
    }

    // Vid registrering avgör rollen vilket konto som skapas. När ett befintligt
    // konto verifierar sig ("add") används rollen inte alls — callbacken skriver
    // bara BankID-fälten — så där får även Publik-konton verifiera sig, t.ex.
    // taxidansare som måste ha Mobilt BankID.
    const allowedRoles = resolvedMode === "add" ? ["creator", "venue", "customer"] : ["creator", "venue"];
    // Vid inloggning finns ingen roll att välja; kontot har redan en.
    if (resolvedMode !== "login" && (!role || !allowedRoles.includes(role))) {
      return NextResponse.json(
        { error: "Ogiltig roll" },
        { status: 400 }
      );
    }

    const resolvedSubcategory =
      role === "creator" && subcategory === "taxi_dancer"
        ? "taxi_dancer"
        : "general";

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
    const session = await createBankIdSession(baseUrl);

    const response = NextResponse.json({
      authenticationUrl: session.authenticationUrl,
    });

    const safeNext = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : null;

    // Sign the cookie — it carries server-trusted role/mode/next that the
    // callback acts on, so it must not be attacker-forgeable plaintext.
    response.cookies.set("bankid_session", signCookieValue({
      sessionId: session.id,
      role: resolvedMode === "login" ? null : role,
      subcategory: resolvedSubcategory,
      mode: resolvedMode,
      next: safeNext,
    }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });

    return response;
  } catch (err) {
    console.error("BankID start error:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Kunde inte starta BankID-verifiering. Försök igen." },
      { status: 500 }
    );
  }
}
