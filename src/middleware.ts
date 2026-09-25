import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { expiredSetCookieHeader } from "@/lib/supabase/auth-cookies";
import { locales, LOCALE_COOKIE_NAME, detectLocaleFromAcceptLanguage, isLikelyBot } from "@/i18n/config";
import { asLocale } from "@/lib/seo/metadata";
import { REF_COOKIE, REF_COOKIE_MAX_AGE, normalizeRefCode } from "@/lib/affiliate/attribution";
import { createAdminClient } from "@/lib/supabase/admin";
import { UTM_COOKIE, UTM_COOKIE_MAX_AGE, readUtmFromParams, hasUtm, serializeUtm } from "@/lib/analytics/utm";

export async function middleware(request: NextRequest) {
  // 1. Ensure locale cookie exists. A cookieless visitor gets their device
  //    language (sv/en/es); when nothing matches, real visitors fall back to
  //    English and crawlers to Swedish (the .se site's canonical language).
  //    Same resolution as i18n/request.ts, so persisting it here doesn't lock
  //    the page to the wrong language on the second load.
  // ?lang=sv|en|es i adressen är språkvalet hreflang pekar på. Det vinner över
  // cookien, och skrivs till cookien så resten av besöket följer med.
  const urlLocale = asLocale(request.nextUrl.searchParams.get("lang"));
  const localeCookie = urlLocale ?? request.cookies.get(LOCALE_COOKIE_NAME)?.value;
  const fallback = isLikelyBot(request.headers.get("user-agent")) ? "sv" : "en";
  const locale = locales.includes(localeCookie as (typeof locales)[number])
    ? localeCookie!
    : detectLocaleFromAcceptLanguage(request.headers.get("accept-language"), fallback);

  // Språket måste nå i18n/request.ts, som bara ser headers — inte URL:en.
  const requestHeaders = new Headers(request.headers);
  if (urlLocale) requestHeaders.set("x-usha-lang", urlLocale);

  let response: NextResponse;
  let clearHostOnly: string[] = [];
  try {
    ({ response, clearHostOnly } = await updateSession(request, requestHeaders));
  } catch {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Set locale cookie if missing or invalid
  if (!localeCookie || localeCookie !== locale) {
    response.cookies.set(LOCALE_COOKIE_NAME, locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  }

  // Partnerlänk: ?ref=KOD på vilken sida som helst sätter en 90-dagarscookie
  // som registreringen och kassan läser. Klicket räknas per kod och dag.
  const refCode = normalizeRefCode(request.nextUrl.searchParams.get("ref"));
  if (refCode) {
    response.cookies.set(REF_COOKIE, refCode, {
      path: "/",
      maxAge: REF_COOKIE_MAX_AGE,
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });
    try {
      await createAdminClient().rpc("count_referral_click", { p_code: refCode });
    } catch {
      // ett tappat klick är inte värt en trasig sida
    }
  }

  // Kampanjparametrar. Samma resa som partnerkoden: in i en cookie vid
  // landningen, ut i Stripe-metadata i kassan, ned i bokningen i webhooken.
  // Utan det steget vet vi att en biljett såldes men inte vad som sålde den —
  // omdirigeringen till Stripe och tillbaka raderar all referrer.
  const utm = readUtmFromParams(request.nextUrl.searchParams);
  if (hasUtm(utm)) {
    response.cookies.set(UTM_COOKIE, serializeUtm(utm), {
      path: "/",
      maxAge: UTM_COOKIE_MAX_AGE,
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });
  }

  // Sist, efter alla cookies.set: host-only-varianten av döda auth-cookies.
  // Måste gå som rå header — Nexts cookie-jar håller en post per namn och
  // skulle annars slå ihop den med .usha.se-varianten ovan. Utan den här raden
  // överlever en gammal host-only-cookie från före domänbytet och skuggar
  // varje ny inloggning (refresh-stormen 2026-09-07).
  for (const name of clearHostOnly) {
    response.headers.append("Set-Cookie", expiredSetCookieHeader(name));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
