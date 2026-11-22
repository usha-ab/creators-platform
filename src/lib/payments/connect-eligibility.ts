import { isSeller } from "@/lib/roles";
import { isCompanyForm, isForeignOrgNumber, isFTaxValid, isOwnerPayee } from "./beta-gate";

/**
 * Vem får skapa eller återuppta ett anslutet Stripe-konto (/api/stripe/connect)?
 *
 * Ren funktion så att varje spärr kan testas utan Stripe och databas.
 *
 * - Alla: BankID-verifierad (eller grandfathered) säljare, som /api/connect/onboard.
 * - Nytt konto: verifierad bolagsform (profiles.company_form, satt av admin efter
 *   kontroll), svenskt org-nr, och för enskild firma kontrollerad F-skatt.
 *   business_type följer bolagsformen: company för aktiebolag och förening,
 *   individual bara för enskild firma med F-skatt. En privatperson utan bolag
 *   får aldrig ett anslutet konto — den vägen är lönevägen.
 * - Utländska konton (land ≠ SE) spärras tills frågan om skatteavdrag och
 *   A-SINK är löst.
 * - Ushas eget konto går förbi bolagskraven.
 */
export interface ConnectProfile {
  id: string;
  role: string | null;
  bankid_verified_at: string | null;
  bankid_grandfathered_at: string | null;
  stripe_account_id: string | null;
  company_form: string | null;
  org_number: string | null;
  f_tax_verified_at: string | null;
}

export type ConnectBlockCode =
  | "not_cleared"
  | "no_company_form"
  | "no_org_number"
  | "foreign"
  | "f_tax_required";

export type ConnectDecision =
  | { ok: true; existing: true }
  | { ok: true; existing: false; country: "SE"; businessType: "company" | "individual" }
  | { ok: false; code: ConnectBlockCode };

export function decideConnectAccount(
  profile: ConnectProfile | null | undefined,
  now: Date = new Date(),
): ConnectDecision {
  if (!profile) return { ok: false, code: "not_cleared" };
  const owner = isOwnerPayee(profile.id);

  const cleared =
    isSeller(profile.role) &&
    (profile.bankid_verified_at != null || profile.bankid_grandfathered_at != null);
  if (!owner && !cleared) return { ok: false, code: "not_cleared" };

  if (profile.stripe_account_id) return { ok: true, existing: true };

  if (owner) return { ok: true, existing: false, country: "SE", businessType: "company" };

  // Utlandet först: ett utländskt bolag ska få det tydliga beskedet, inte
  // "saknar bolagsform".
  if (isForeignOrgNumber(profile.org_number)) return { ok: false, code: "foreign" };
  if (!isCompanyForm(profile.company_form)) return { ok: false, code: "no_company_form" };
  if (!profile.org_number) return { ok: false, code: "no_org_number" };

  if (profile.company_form === "enskild_firma") {
    if (!isFTaxValid(profile.f_tax_verified_at, now)) return { ok: false, code: "f_tax_required" };
    return { ok: true, existing: false, country: "SE", businessType: "individual" };
  }
  return { ok: true, existing: false, country: "SE", businessType: "company" };
}
