import { NextRequest, NextResponse } from "next/server";
import { applyBankIdVerification } from "@/lib/bankid/apply-verification";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCookieValue } from "@/lib/signicat/crypto";
import type { BankIdVerifiedData } from "@/types/bankid";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Inte autentiserad" }, { status: 401 });
  }

  const cookie = req.cookies.get("bankid_verified")?.value;
  if (!cookie) {
    return NextResponse.json({ error: "Ingen BankID-verifiering hittad" }, { status: 400 });
  }

  const data = verifyCookieValue<BankIdVerifiedData>(cookie);
  if (!data) {
    return NextResponse.json({ error: "Ogiltig verifieringsdata" }, { status: 400 });
  }

  const result = await applyBankIdVerification(createAdminClient(), user.id, data);
  if (!result.ok) {
    if (result.reason === "update_failed") {
      return NextResponse.json({ error: "Kunde inte spara verifiering" }, { status: 500 });
    }
    const response = NextResponse.json(
      result.reason === "age_restricted"
        ? { error: "Du måste vara minst 18 år för att registrera dig som taxidansare" }
        : { error: "Personnummer redan registrerat" },
      { status: result.reason === "age_restricted" ? 403 : 409 }
    );
    response.cookies.set("bankid_verified", "", { path: "/", maxAge: 0 });
    return response;
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("bankid_verified", "", { path: "/", maxAge: 0 });
  return response;
}
