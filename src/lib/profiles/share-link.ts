// Delningslänk för dold profil.
//
// En opublik profil är 404 för alla utom ägaren och admin. Med en token i
// länken får den som fått den se sidan ändå — utan att profilen dyker upp i
// sök, på marknadsplatsen eller i någon lista.
//
// Reglerna ligger som rena funktioner så jämförelsen kan testas, och så att
// den ser likadan ut överallt den används.

/** Frågeparametern som bär token. Kort, för att länken ska gå att dela. */
export const SHARE_TOKEN_PARAM = "k";

/**
 * Stämmer den medskickade token med profilens?
 *
 * Tom eller saknad token ger alltid falskt — annars skulle en profil utan
 * aktiv delning öppnas av en länk utan parameter. Jämförelsen är
 * skiftlägesokänslig eftersom uuid kan skrivas i båda formerna.
 */
export function shareTokenMatches(
  profileToken: string | null | undefined,
  suppliedToken: string | null | undefined
): boolean {
  if (!profileToken || !suppliedToken) return false;

  const a = profileToken.trim().toLowerCase();
  const b = suppliedToken.trim().toLowerCase();
  if (!a || !b) return false;

  return a === b;
}

/** Plockar ut token ur Next:s searchParams, som kan ge en array. */
export function readShareToken(
  searchParams: Record<string, string | string[] | undefined> | undefined
): string | null {
  const raw = searchParams?.[SHARE_TOKEN_PARAM];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw ?? null;
}

/** Hela länken att dela. */
export function buildShareUrl(baseUrl: string, slugOrId: string, token: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/creators/${slugOrId}?${SHARE_TOKEN_PARAM}=${token}`;
}
