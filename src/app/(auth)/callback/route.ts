import { NextRequest, NextResponse } from "next/server";
import { REF_COOKIE, claimReferral } from "@/lib/affiliate/attribution";
import { locales, LOCALE_COOKIE_NAME } from "@/i18n/config";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCookieValue } from "@/lib/signicat/crypto";
import type { BankIdVerifiedData } from "@/types/bankid";
import { normalizeRole } from "@/lib/roles";

/**
 * Skapades kontot av det OAuth-flöde vi just kom tillbaka från?
 *
 * Fönstret matchar pending_role-cookiens max-age (600s) med marginal för
 * långsamma OAuth-rundturer. Saknas eller är created_at oläsbar svarar vi nej
 * — hellre en utebliven rollsättning vid signup än en rollhöjning.
 */
const SIGNUP_WINDOW_MS = 15 * 60 * 1000;

function isFreshSignup(createdAt: string | undefined): boolean {
  if (!createdAt) return false;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return false;
  const age = Date.now() - created;
  return age >= 0 && age <= SIGNUP_WINDOW_MS;
}

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const admin = createAdminClient();

        // 1. Apply pending role from OAuth signup (if present).
        //    Uses admin client because the privileged-columns trigger blocks
        //    role/tier/is_admin/bankid_* changes from user-context updates.
        //
        //    Cookien sätts från webbläsaren (signup/page.tsx) och går alltså
        //    inte att lita på — vem som helst kan sätta pending_role=venue och
        //    logga in med Google. Att signera den hjälper inte: en angripare
        //    kan be servern signera vilken roll som helst. Kontrollen som
        //    faktiskt håller är att bara tillämpa den när OAuth-flödet nyss
        //    SKAPADE kontot. Ett befintligt konto kan då inte höja sin roll;
        //    den vägen går via BankID-cookien nedan, som är signerad.
        // Rollistan bor i lib/roles. Samma lista fanns tidigare på tre
        //    ställen (här, i webhooken och i triggern) och gled isär — triggern
        //    saknade venue i tre månader utan att någon märkte det.
        const pendingRole = normalizeRole(req.cookies.get("pending_role")?.value);
        if (pendingRole && isFreshSignup(user.created_at)) {
          await admin
            .from("profiles")
            .update({ role: pendingRole })
            .eq("id", user.id);
        }

        // 1b. Samtycke till marknadsföring, valt på registreringssidan innan
        //     rundturen till Google/Facebook. Triggern har redan skapat
        //     user_settings-raden med false, så här behöver bara ett ja skrivas.
        //
        //     isFreshSignup av samma skäl som rollen ovan: cookien sätts av
        //     webbläsaren. Utan den kontrollen hade en kvarliggande cookie
        //     kunnat slå på marknadsföring vid en senare inloggning, för någon
        //     som stängt av den under tiden — och samtycke som användaren inte
        //     gett vid just det tillfället är inget samtycke.
        if (
          req.cookies.get("pending_marketing_consent")?.value === "true" &&
          isFreshSignup(user.created_at)
        ) {
          await admin
            .from("user_settings")
            .upsert({ user_id: user.id, notif_marketing: true }, { onConflict: "user_id" });
        }

        // 1c. Partnerlänk (usha_ref-cookien från middleware). Samma
        //     isFreshSignup-skydd: bara ett nyskapat konto kan knytas.
        await claimReferral(admin, {
          userId: user.id,
          code: req.cookies.get(REF_COOKIE)?.value,
          createdAt: user.created_at,
        });

        // 2. Apply BankID verification cookie if present — independent of
        //    pending_role so it works for existing-user merge logins too.
        const bankidCookie = req.cookies.get("bankid_verified")?.value;
        if (bankidCookie) {
          const bankidData = verifyCookieValue<BankIdVerifiedData>(bankidCookie);
          if (bankidData) {
            // Defense-in-depth dup check: another profile already claims this pno.
            const { data: dup } = await admin
              .from("profiles")
              .select("id")
              .eq("bankid_personal_number", bankidData.hashedNin)
              .neq("id", user.id)
              .maybeSingle();

            if (!dup) {
              const update: Record<string, unknown> = {
                bankid_verified_at: bankidData.verifiedAt,
                bankid_personal_number: bankidData.hashedNin,
                bankid_name: bankidData.name,
                role: bankidData.role,
              };
              if (bankidData.subcategory) {
                update.creator_subcategory = bankidData.subcategory;
              }
              await admin.from("profiles").update(update).eq("id", user.id);
            }
          }
        }

        const destination = "/app";
        const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
        const redirectUrl = safeNext || destination;
        const response = NextResponse.redirect(`${origin}${redirectUrl}`);
        response.cookies.set("pending_role", "", { path: "/", maxAge: 0 });
        response.cookies.set("pending_marketing_consent", "", { path: "/", maxAge: 0 });
        response.cookies.set("bankid_verified", "", { path: "/", maxAge: 0 });

        // Carry the account's chosen language onto this browser.
        //
        // The locale cookie is set per browser from Accept-Language and then
        // kept for a year, so each device decided on its own and could disagree
        // with every other one — with no way to tell which had guessed wrong.
        // A language chosen anywhere is a statement about the account, so a new
        // session starts from it rather than from another guess.
        const { data: prefs } = await admin
          .from("profiles")
          .select("locale")
          .eq("id", user.id)
          .maybeSingle();
        const preferred = prefs?.locale;
        if (preferred && (locales as readonly string[]).includes(preferred)) {
          response.cookies.set(LOCALE_COOKIE_NAME, preferred, {
            path: "/",
            maxAge: 60 * 60 * 24 * 365,
            sameSite: "lax",
          });
        }

        return response;
      }

      return NextResponse.redirect(`${origin}/app`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
