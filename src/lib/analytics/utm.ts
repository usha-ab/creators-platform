/**
 * Kampanjspårning (UTM).
 *
 * Problemet: besökaren klickar på en länk i ett Instagram-inlägg, hamnar på
 * eventsidan, går till Stripe och kommer tillbaka. Vid det laget har
 * webbläsarens referrer försvunnit och GA4:s egen attribution är bruten av
 * omdirigeringen. Vi vet att en biljett såldes, men inte att inlägget sålde den.
 *
 * Lösningen: adressens utm-parametrar läggs i en cookie när besökaren landar,
 * kassan läser cookien och lägger värdena i Stripe-metadata, och webhooken
 * skriver dem på bokningen. Kanalen blir därmed en kolumn i databasen, inte en
 * gissning i ett rapportverktyg.
 */
export const UTM_COOKIE = "usha_utm";
/** Samma fönster som partnerlänken: en kampanj kan verka länge. */
export const UTM_COOKIE_MAX_AGE = 90 * 24 * 60 * 60;

export interface UtmParams {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
}

const KEYS = ["source", "medium", "campaign", "content"] as const;
const MAX_LEN = 64;

/** Städar ett enskilt värde: kort, gemener, inga konstigheter. */
function clean(value: string | null | undefined): string | undefined {
  const v = (value ?? "").trim().toLowerCase().slice(0, MAX_LEN);
  return /^[a-z0-9._\-+ ]{1,64}$/.test(v) ? v : undefined;
}

/** Plockar ut utm-parametrarna ur en adress. Tom = inget att spara. */
export function readUtmFromParams(params: URLSearchParams): UtmParams {
  const out: UtmParams = {};
  for (const k of KEYS) {
    const v = clean(params.get(`utm_${k}`));
    if (v) out[k] = v;
  }
  return out;
}

export function hasUtm(utm: UtmParams): boolean {
  return KEYS.some((k) => !!utm[k]);
}

/** Cookie-värdet. Kompakt, så det får plats bredvid allt annat. */
export function serializeUtm(utm: UtmParams): string {
  return KEYS.filter((k) => utm[k]).map((k) => `${k}:${utm[k]}`).join("|");
}

export function parseUtm(value: string | null | undefined): UtmParams {
  const out: UtmParams = {};
  for (const part of (value ?? "").split("|")) {
    const i = part.indexOf(":");
    if (i < 1) continue;
    const key = part.slice(0, i) as (typeof KEYS)[number];
    const v = clean(part.slice(i + 1));
    if (v && (KEYS as readonly string[]).includes(key)) out[key] = v;
  }
  return out;
}

/** Stripe-metadata: platt, med prefix, och bara det som finns. */
export function utmMetadata(utm: UtmParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of KEYS) if (utm[k]) out[`utm_${k}`] = utm[k]!;
  return out;
}

/** Kolumnerna på bokningen. Samma nycklar som i databasen. */
export function utmBookingFields(meta: Record<string, string | undefined> | null | undefined) {
  const utm = {
    source: clean(meta?.utm_source),
    medium: clean(meta?.utm_medium),
    campaign: clean(meta?.utm_campaign),
    content: clean(meta?.utm_content),
  };
  return hasUtm(utm)
    ? {
        utm_source: utm.source ?? null,
        utm_medium: utm.medium ?? null,
        utm_campaign: utm.campaign ?? null,
        utm_content: utm.content ?? null,
      }
    : {};
}
