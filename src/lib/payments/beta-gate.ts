/**
 * Mottagarspärren: vem får ta emot pengar via Usha?
 *
 * Gäller ALLA vägar där pengar går till någon annan än Usha: destination
 * charges i kassorna (biljett, bokning, produkt, minuter, rabattkod, efterköp),
 * gage, avräkning till partner (payoutBlockedReason i lib/settlements/payout.ts)
 * och kontant utbetalning i partnerprogrammet.
 *
 * Kravet (juristens flödesförslag, godkänt av Pablo 2026-11-22):
 *   1. Mottagartyp: aktiebolag, enskild firma eller ideell förening
 *      (profiles.company_form). Privatperson utan bolag får aldrig pengar här —
 *      den vägen är lönevägen (SAMekonomi).
 *   2. Svenskt organisationsnummer. Utländska bolag är spärrade tills frågan om
 *      30 % skatteavdrag/A-SINK är löst (advokat först).
 *   3. Kontrollerad F-skatt (profiles.f_tax_verified_at), inte äldre än
 *      F_TAX_MAX_AGE_DAYS. Utan F-skatt blir Usha skyldig att göra skatteavdrag
 *      (SFL 10 kap. 2 och 11 §§) och för fysisk person betala
 *      arbetsgivaravgifter (SAL 2 kap. 5 §).
 *
 * Momsregistrering är INTE ett krav. company_verified_at betyder bara att
 * momsnumret är giltigt i VIES; en enskild firma under omsättningsgränsen och en
 * förening utan moms ska kunna godkännas.
 *
 * Ushas eget konto (OWNER_PAYEE_IDS) går förbi kravet, som förut.
 */

const OWNER_PAYEE_IDS = (
  process.env.PAYMENT_OWNER_IDS ?? "15d852ed-1f33-446f-9bcb-821c2444c84f" // pablo.acosta@usha.se
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Flaggan finns kvar för bakåtkompatibilitet men öppnar INTE längre spärren.
 * Juristen: den fick aldrig sättas innan F-skattekravet fanns, eftersom den
 * öppnade destination charges till alla Connect-konton, även privatpersoner.
 * Nu är mottagarkravet ett rättsligt krav och inte en betaspärr.
 */
export function paymentsOpenToAll(): boolean {
  return process.env.NEXT_PUBLIC_PAYMENTS_OPEN === "true";
}

/** True if this payee id is a platform-owner (Usha) account. */
export function isOwnerPayee(id: string | null | undefined): boolean {
  return !!id && OWNER_PAYEE_IDS.includes(id);
}

/** Mottagartyper som får ta emot pengar. Speglar CHECK-villkoret i migrationen. */
export const COMPANY_FORMS = ["aktiebolag", "enskild_firma", "forening"] as const;
export type CompanyForm = (typeof COMPANY_FORMS)[number];

export function isCompanyForm(v: unknown): v is CompanyForm {
  return typeof v === "string" && (COMPANY_FORMS as readonly string[]).includes(v);
}

/**
 * Hur gammal F-skattekontrollen får vara vid utbetalning. Skatteverket kan
 * återkalla F-skatt; en kontroll gäller därför bara en tid. 90 dagar är ett
 * förslag som Pablo/Ludvig kan ändra (manuell kontroll mot Skatteverket nu).
 */
export const F_TAX_MAX_AGE_DAYS = 90;

/** Kolumnerna mottagarspärren läser. Läses alltid med service-role. */
export const PAYEE_ELIGIBILITY_COLUMNS = "id, company_form, org_number, f_tax_verified_at";

export interface PayeeEligibility {
  id: string;
  company_form?: string | null;
  org_number?: string | null;
  f_tax_verified_at?: string | null;
}

export type PayeeBlockCode =
  | "missing"
  | "no_company_form"
  | "no_org_number"
  | "foreign"
  | "f_tax_missing"
  | "f_tax_stale";

/** Svenskt org-nr sparas som tio siffror; utländska som momsnummer med landsprefix. */
export function isForeignOrgNumber(org: string | null | undefined): boolean {
  return !!org && /^[A-Za-z]{2}/.test(org.trim());
}

export function isFTaxValid(verifiedAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!verifiedAt) return false;
  const t = new Date(verifiedAt).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t <= F_TAX_MAX_AGE_DAYS * 86_400_000;
}

/**
 * Skälet att INTE betala, eller null om mottagaren uppfyller kravet. Ägaren
 * (Usha) returnerar alltid null.
 */
export function payeeBlockCode(
  payee: PayeeEligibility | null | undefined,
  now: Date = new Date(),
): PayeeBlockCode | null {
  if (!payee) return "missing";
  if (isOwnerPayee(payee.id)) return null;
  if (!isCompanyForm(payee.company_form)) return "no_company_form";
  if (!payee.org_number) return "no_org_number";
  if (isForeignOrgNumber(payee.org_number)) return "foreign";
  if (!payee.f_tax_verified_at) return "f_tax_missing";
  if (!isFTaxValid(payee.f_tax_verified_at, now)) return "f_tax_stale";
  return null;
}

/** Klartext för loggar och felkolumner (sv, inte användargränssnitt). */
export const PAYEE_BLOCK_REASON: Record<PayeeBlockCode, string> = {
  missing: "mottagare saknas",
  no_company_form: "mottagaren har ingen godkänd bolagsform (aktiebolag, enskild firma eller förening)",
  no_org_number: "mottagaren saknar organisationsnummer",
  foreign: "utländska mottagare är spärrade tills vidare",
  f_tax_missing: "mottagarens F-skatt är inte kontrollerad",
  f_tax_stale: `mottagarens F-skattekontroll är äldre än ${F_TAX_MAX_AGE_DAYS} dagar`,
};

/** True if this payee may receive real payments right now. */
export function canReceivePayments(
  payee: PayeeEligibility | null | undefined,
  now: Date = new Date(),
): boolean {
  return payeeBlockCode(payee, now) === null;
}

export const PAYMENTS_BETA_BLOCKED_MESSAGE =
  "Onlinebetalning är inte aktiverad för den här arrangören. Bokningen fungerar ändå – betalning sker direkt med arrangören.";
