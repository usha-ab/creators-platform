import type { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { adoptGuestBookings } from "@/lib/bookings/adopt-guest";
import { locales, LOCALE_COOKIE_NAME } from "@/i18n/config";

/**
 * Skapar en session för kontot med den här adressen, helt på servern:
 * engångstoken (magiclink) genereras och löses in i samma anrop, så den hamnar
 * aldrig i en URL eller ett mejl. Sessionscookien skrivs av SSR-klienten.
 * Får bara anropas när identiteten redan är bevisad (BankID, mejlkod).
 */
export async function signInServerSide(admin: SupabaseClient, email: string): Promise<void> {
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) throw new Error(`generateLink: ${linkErr?.message ?? "no token"}`);

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (error) throw new Error(`verifyOtp: ${error.message}`);
}

/** Samma efterarbete som /callback och /confirm: gamla gästköp och kontots språk. */
export async function finishSignIn(
  admin: SupabaseClient,
  response: NextResponse,
  user: { id: string; email: string }
): Promise<void> {
  await adoptGuestBookings(admin, user.id, user.email);
  const { data: prefs } = await admin.from("profiles").select("locale").eq("id", user.id).maybeSingle();
  if (prefs?.locale && (locales as readonly string[]).includes(prefs.locale)) {
    response.cookies.set(LOCALE_COOKIE_NAME, prefs.locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  }
}
