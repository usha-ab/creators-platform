/**
 * Rensa Supabase-sessionens cookies i ALLA varianter.
 *
 * Bakgrund: cookie-domänen byttes 2026-07-10 från host-only (usha.se) till
 * ".usha.se" (#82). En telefon som loggade in före bytet bär fortfarande den
 * gamla host-only-cookien. Webbläsaren skickar båda med samma namn, och
 * `cookie.parse` behåller den FÖRSTA — den gamla. Varje läsning ger alltså en
 * död refresh-token, /token svarar 400, klienten loggar ut (och raderar bara
 * .usha.se-varianten, för det är den domän den känner till), läser om, hittar
 * den gamla igen — hundratals gånger i minuten tills 429 spärrar även en färsk
 * lösenordsinloggning. Kontot ser "utloggat" ut oavsett metod.
 *
 * En cookie kan bara raderas av en skrivning med SAMMA domän-attribut, och JS
 * kan inte läsa vilket attribut en cookie har. Enda sättet att träffa bägge är
 * att skriva en utgången cookie två gånger: en utan domän, en med.
 */

/** Namn på Supabase-auth-cookies: sb-<ref>-auth-token, chunkar .0/.1/…, och
 *  PKCE-verifieraren. Matchar aldrig andra sb-cookies. */
export function isSupabaseAuthCookie(name: string): boolean {
  return /^sb-[a-z0-9-]+-auth-token(\.\d+)?$/.test(name) || /^sb-[a-z0-9-]+-auth-token-code-verifier$/.test(name);
}

export interface ExpiredCookie {
  name: string;
  domain?: string;
}

/** De skrivningar som krävs för att en cookie ska vara borta oavsett vilken
 *  domän den sattes med. Utan konfigurerad domän finns bara host-only. */
export function expiredCookieVariants(name: string, domain: string | undefined): ExpiredCookie[] {
  return domain ? [{ name }, { name, domain }] : [{ name }];
}

/**
 * Rå Set-Cookie-rad som raderar en cookie. Behövs eftersom Nexts
 * `response.cookies` håller EN post per namn och skriver om hela headern vid
 * varje `set` — två varianter av samma namn kan bara samexistera som råa
 * header-rader, tillagda efter den sista `cookies.set`.
 */
export function expiredSetCookieHeader(name: string, domain?: string): string {
  return `${name}=; Path=/; Max-Age=0; SameSite=Lax` + (domain ? `; Domain=${domain}` : "");
}

/** Namn ur en cookie-header/document.cookie-sträng, dubbletter ihopslagna. */
export function authCookieNamesFrom(cookieString: string): string[] {
  const names = new Set<string>();
  for (const part of cookieString.split(";")) {
    const eq = part.indexOf("=");
    const name = (eq === -1 ? part : part.slice(0, eq)).trim();
    if (name && isSupabaseAuthCookie(name)) names.add(name);
  }
  return [...names];
}

/**
 * Webbläsare: skriv ut varje auth-cookie i båda varianterna. Ingen nätverks-
 * trafik, så den kan köras även när /token är rate-limitat — vilket är exakt
 * läget den är till för.
 */
export function purgeAuthCookies(): void {
  if (typeof document === "undefined") return;
  const domain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN || undefined;
  for (const name of authCookieNamesFrom(document.cookie)) {
    for (const v of expiredCookieVariants(name, domain)) {
      document.cookie =
        `${name}=; Max-Age=0; Path=/; SameSite=Lax` + (v.domain ? `; Domain=${v.domain}` : "");
    }
  }
}
