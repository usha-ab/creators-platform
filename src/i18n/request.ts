import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { locales, LOCALE_COOKIE_NAME, detectLocaleFromAcceptLanguage, isLikelyBot, type Locale } from './config';
import { getMessageFallback, onIntlError } from './fallback';

export default getRequestConfig(async ({ requestLocale }) => {
  // An explicitly requested locale (e.g. getTranslations({ locale }) for a
  // per-event language override) wins; then the visitor's saved cookie; then we
  // detect the device language (English fallback), never Swedish-by-default.
  const requested = await requestLocale;
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const h = await headers();
  // ?lang= i adressen vinner över cookien. Utan den har varje sida bara EN
  // adress oavsett språk, och då kan hreflang inte peka ut de andra två — en
  // sökmotor ser aldrig den engelska eller spanska versionen. Middleware
  // speglar valet till cookien så nästa sida följer med.
  const urlLocale = h.get('x-usha-lang');
  // Crawlers with no supported language get Swedish (the .se site's canonical
  // language, for indexing); real visitors get English.
  const fallback: Locale = isLikelyBot(h.get('user-agent')) ? 'sv' : 'en';

  const locale: Locale = locales.includes(requested as Locale)
    ? (requested as Locale)
    : locales.includes(urlLocale as Locale)
      ? (urlLocale as Locale)
      : locales.includes(cookieLocale as Locale)
        ? (cookieLocale as Locale)
        : detectLocaleFromAcceptLanguage(h.get('accept-language'), fallback);

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
    // Utan explicit tidszon formaterar servern datum i sin egen (UTC på Vercel)
    // och webbläsaren i besökarens. Samma tidpunkt renderas då som olika text
    // på de två sidorna, vilket ger hydreringsmismatch — next-intl varnar
    // uttryckligen för det. Verksamheten är svensk och alla event anges i
    // svensk tid, så Europe/Stockholm är rätt svar för både server och klient.
    timeZone: "Europe/Stockholm",
    // Never render a raw "namespace.key" to users; humanize + warn instead.
    getMessageFallback,
    onError: onIntlError,
  };
});
