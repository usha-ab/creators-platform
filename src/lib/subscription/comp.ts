/**
 * Fribiljetter till betalda nivåer — "comp grants".
 *
 * Under betan har Guld och Premium delats ut utan betalning: till ägaren, till
 * familj, och till enskilda kreatörer. De raderna bär ett PÅHITTAT
 * stripe_subscription_id ("comp_owner_lifetime", "comp_family_lifetime_osvaldo"
 * …) och stripe_customer_id "comp_owner". Det betyder två saker:
 *
 *   1. Ingen Stripe-webhook kan någonsin röra dem — id:na finns inte hos
 *      Stripe. Den vanliga livscykeln (past_due, canceled, nedgradering) är
 *      alltså helt urkopplad för just dessa.
 *   2. De sattes med current_period_end 2099-12-31, vilket i praktiken är
 *      "för alltid".
 *
 * Tillsammans gör det att en gratis betanivå skulle löpa vidare i evighet efter
 * betan, utan att någon aktivt valt att betala. Den här modulen är gränsen: en
 * comp-rad är per definition tidsbegränsad och ska falla till gratis av sig
 * själv, om inte kontoägaren själv tecknar ett riktigt abonnemang.
 */

/**
 * Permanent gåva — ska ALDRIG falla.
 *
 * Fem konton har Premium på obestämd tid med avsikt: ägarens tre egna konton,
 * Love och Osvaldo. De bär alla "lifetime" i sitt grant-id, vilket var
 * konventionen redan när de skapades. Det ordet är därför markören: en
 * livstidsgåva är ett beslut, inte en betaperiod som råkat bli kvar.
 *
 * Utan den här skillnaden hade beta-nedgraderingen tagit dem med sig, eftersom
 * de i övrigt ser ut precis som en tidsbegränsad comp-rad: påhittat Stripe-id
 * och slutdatum 2099-12-31.
 */
export function isPermanentGrant(sub: { stripe_subscription_id?: string | null }): boolean {
  return (sub.stripe_subscription_id ?? "").includes("lifetime");
}

/** En rad utan äkta Stripe-koppling. */
export function isCompGrant(sub: { stripe_subscription_id?: string | null }): boolean {
  // Ett äkta Stripe-abonnemang har alltid ett id som börjar med "sub_". Allt
  // annat — comp-prefixet, tomt fält, eller något framtida påhitt — räknas som
  // comp. Riktningen är medveten: hellre att en riktig kund råkar prövas mot
  // sitt slutdatum, vilket ändå är sant för en betalande prenumeration, än att
  // en comp-rad slinker förbi som betalande och löper vidare i evighet.
  return !(sub.stripe_subscription_id ?? "").startsWith("sub_");
}

/**
 * Har raden gått ut?
 *
 * Betan har inget bestämt slutdatum ännu, så gränsen läses ur app_config
 * (`beta_ends_at`). Är den osatt löper comp-raderna vidare — men de faller
 * ändå på sitt eget current_period_end, vilket är det som gäller för en
 * tidsbegränsad gåva som Christians månad.
 *
 * Livstidsgåvor undantas helt. Se isPermanentGrant.
 */
export function hasExpired(
  sub: { current_period_end?: string | null; stripe_subscription_id?: string | null },
  now: Date,
  betaEndsAt: Date | null
): boolean {
  // En livstidsgåva överlever både sitt eget slutdatum och betans slut.
  if (isPermanentGrant(sub)) return false;
  if (sub.current_period_end) {
    const slut = new Date(sub.current_period_end);
    if (slut.getTime() <= now.getTime()) return true;
  }
  if (betaEndsAt && betaEndsAt.getTime() <= now.getTime()) return true;
  return false;
}
