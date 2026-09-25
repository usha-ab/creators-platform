import type { Metadata } from "next";
import { locales, type Locale } from "@/i18n/config";

/**
 * Delade metadata-byggare för de publika sidorna.
 *
 * Två problem de löser:
 *
 * 1. **Canonical.** Samma innehåll nås ofta på flera adresser — en kväll bor på
 *    /event/<slug> men delas som /listing/<id>, en profil nås både som
 *    /creators/<id> och via kreatörens korta /<slug>. Utan en utpekad canonical
 *    väljer sökmotorn själv, och väljer ibland fel.
 *
 * 2. **Språk.** Sajten finns på svenska, engelska och spanska, men språket
 *    avgjordes bara av en cookie. En sökmotor har ingen cookie: den ser en enda
 *    språkversion och de andra två blir osynliga. `?lang=` ger varje språk en
 *    egen adress att peka ut med hreflang, utan att den vanliga besökarens
 *    upplevelse ändras.
 */
export const SITE_URL = "https://usha.se";

/** Språkvarianterna av en sida, plus x-default för den som saknar träff. */
export function languageAlternates(path: string): Record<string, string> {
  const base = absoluteUrl(path);
  const sep = base.includes("?") ? "&" : "?";
  const out: Record<string, string> = {};
  for (const l of locales) out[l] = `${base}${sep}lang=${l}`;
  out["x-default"] = base;
  return out;
}

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Canonical + hreflang för en indexerbar sida.
 *
 * `canonicalPath` ska vara adressen vi vill ha indexerad — inte nödvändigtvis
 * den besökaren råkade komma in på.
 */
export function indexable(canonicalPath: string): Pick<Metadata, "alternates"> {
  return {
    alternates: {
      canonical: absoluteUrl(canonicalPath),
      languages: languageAlternates(canonicalPath),
    },
  };
}

/**
 * Sidor som inte hör hemma i ett sökresultat: kvitton, bekräftelselänkar,
 * inloggning, avregistrering. `follow` behålls så länkar därifrån ändå följs.
 */
export function notIndexable(): Pick<Metadata, "robots"> {
  return { robots: { index: false, follow: true } };
}

/** Sidor som varken ska indexeras eller följas (engångstokens, radering). */
export function privatePage(): Pick<Metadata, "robots"> {
  return { robots: { index: false, follow: false } };
}

/** Är värdet ett språk vi stöder? Används av ?lang-hanteringen. */
export function asLocale(value: string | null | undefined): Locale | null {
  return locales.includes(value as Locale) ? (value as Locale) : null;
}
