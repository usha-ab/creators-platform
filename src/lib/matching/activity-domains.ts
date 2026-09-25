// Domäner för träningsvänner.
//
// Poolen var från början dans-bara. När den öppnas för löpning, tennis, yoga
// och annat räcker det inte att lägga till värden: en löpare ska inte matchas
// mot en dansare bara för att båda finns i Stockholm.
//
// Domänen HÄRLEDS ur aktiviteterna och lagras inte. Kolumnen heter fortfarande
// dance_styles och rymmer numera vilken aktivitet som helst — ett namnbyte till
// activities är en migration som får komma separat, inte mitt i det här.
//
// Den som gör flera saker tillhör flera domäner och ser dem en i taget, via
// växlaren i gränssnittet. Samma mönster som rollväxlaren Publik/Kreatör/Venue.

export const DOMAINS = ["dans", "traning", "racket", "kropp"] as const;
export type ActivityDomain = (typeof DOMAINS)[number];

/** Domänen en okänd aktivitet hamnar i. Träning är den bredaste hinken. */
export const DEFAULT_DOMAIN: ActivityDomain = "traning";

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Aktivitet → domän. Nycklarna är normaliserade.
 *
 * Listan är medvetet kurerad och inte uttömmande: det som inte står här
 * hamnar i DEFAULT_DOMAIN, vilket är bättre än att stänga ute någon som skrev
 * "crossfit" innan vi hann lägga till det.
 */
const ACTIVITY_DOMAIN: Record<string, ActivityDomain> = {
  // Dans — partnerdanser och sociala danser
  kizomba: "dans",
  tarraxo: "dans",
  "urban kiz": "dans",
  "urban kizomba": "dans",
  semba: "dans",
  zouk: "dans",
  "brazilian zouk": "dans",
  bachata: "dans",
  salsa: "dans",
  tango: "dans",
  lindy: "dans",
  "lindy hop": "dans",
  swing: "dans",
  dans: "dans",

  // Träning — uthållighet och styrka
  löpning: "traning",
  lopning: "traning",
  gym: "traning",
  styrketräning: "traning",
  "styrketraning": "traning",
  crossfit: "traning",
  simning: "traning",
  cykling: "traning",
  vandring: "traning",
  klättring: "traning",
  "klattring": "traning",

  // Racket- och bollsport — kräver en motståndare, inte en partner
  tennis: "racket",
  padel: "racket",
  badminton: "racket",
  squash: "racket",
  "bordtennis": "racket",
  pingis: "racket",

  // Kropp och sinne — rörlighet och återhämtning
  yoga: "kropp",
  stretch: "kropp",
  "stretching": "kropp",
  pilates: "kropp",
  meditation: "kropp",
  mobility: "kropp",
  "rörlighet": "kropp",
};

/** Vilken domän hör aktiviteten till? Okända hamnar i DEFAULT_DOMAIN. */
export function domainForActivity(activity: string): ActivityDomain {
  if (!activity) return DEFAULT_DOMAIN;
  return ACTIVITY_DOMAIN[norm(activity)] ?? DEFAULT_DOMAIN;
}

/**
 * Domänerna en person tillhör, i stabil ordning enligt DOMAINS.
 *
 * Tom lista in ger tom lista ut — och det är viktigt: den som inte fyllt i
 * någon aktivitet ska INTE tyst hamna i träningsdomänen och börja matchas
 * mot främlingar. Anroparen får avgöra vad som händer då.
 */
export function domainsForActivities(activities: readonly string[] | null | undefined): ActivityDomain[] {
  if (!activities || activities.length === 0) return [];
  const found = new Set<ActivityDomain>();
  for (const a of activities) {
    if (a && a.trim()) found.add(domainForActivity(a));
  }
  return DOMAINS.filter((d) => found.has(d));
}

/** Delar de två minst en domän? Grunden för "dansare hittar dansare". */
export function sharesDomain(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined
): boolean {
  const da = domainsForActivities(a);
  if (da.length === 0) return false;
  const db = new Set(domainsForActivities(b));
  return da.some((d) => db.has(d));
}

/** Tillhör personen domänen? */
export function isInDomain(
  activities: readonly string[] | null | undefined,
  domain: ActivityDomain
): boolean {
  return domainsForActivities(activities).includes(domain);
}

/** Är strängen en giltig domän? För att validera en frågeparameter. */
export function isDomain(value: unknown): value is ActivityDomain {
  return typeof value === "string" && (DOMAINS as readonly string[]).includes(value);
}
