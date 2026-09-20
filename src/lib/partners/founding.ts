// Grundarpartner — vem som har statusen, och vad den innebär.
//
// Statusen ges till tidiga kreatörer i regioner där Usha inte finns ännu.
// De får verktygen till självkostnad: ingen månadsavgift, ingen provision,
// inget tak på antal utbud. Usha tar bara det Stripe tar.
//
// Reglerna ligger som rena funktioner så de går att testa utan databas, och
// så att samma svar ges på servern som i gränssnittet. Grinden i sig sitter
// i databasen (kolumnerna är låsta till service_role) — det här är
// tolkningen av den, inte skyddet.

/** Det vi behöver veta om en profil för att avgöra statusen. */
export interface FoundingPartnerFields {
  founding_partner_since: string | null;
  founding_partner_until: string | null;
}

/**
 * Är profilen grundarpartner just nu?
 *
 * `since` måste vara satt och ha inträffat. `until` är valfritt — saknas det
 * gäller statusen tills vidare, annars till och med den tidpunkten.
 */
export function isFoundingPartner(
  profile: FoundingPartnerFields | null | undefined,
  now: Date = new Date()
): boolean {
  if (!profile?.founding_partner_since) return false;

  const since = Date.parse(profile.founding_partner_since);
  if (Number.isNaN(since) || since > now.getTime()) return false;

  if (!profile.founding_partner_until) return true;

  const until = Date.parse(profile.founding_partner_until);
  // Ett oläsbart slutdatum ska inte tyst förlänga statusen.
  if (Number.isNaN(until)) return false;

  return until > now.getTime();
}

/**
 * Dagar kvar av statusen, eller null om den löper tills vidare (eller inte
 * gäller). Används för att påminna i god tid innan den går ut — en partner
 * ska aldrig upptäcka det genom att plötsligt debiteras.
 */
export function foundingPartnerDaysLeft(
  profile: FoundingPartnerFields | null | undefined,
  now: Date = new Date()
): number | null {
  if (!isFoundingPartner(profile, now)) return null;
  if (!profile?.founding_partner_until) return null;

  const until = Date.parse(profile.founding_partner_until);
  return Math.ceil((until - now.getTime()) / 86_400_000);
}

/** Provisionen för en grundarpartner: ingen. Usha tar bara Stripes avgift. */
export const FOUNDING_PARTNER_COMMISSION_PERCENT = 0;
