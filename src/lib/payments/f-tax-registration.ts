import { normalizeOrgNumber } from "@/lib/org-number";
import { F_TAX_MAX_AGE_DAYS, isCompanyForm, isForeignOrgNumber, type CompanyForm } from "./beta-gate";

/**
 * Validering av en manuell F-skattekontroll som admin registrerar
 * (/dashboard/admin/fskatt). Ren funktion, testas utan databas.
 */
export interface FTaxRegistrationInput {
  companyForm: string;
  orgNumber: string;
  /** YYYY-MM-DD, dagen kontrollen gjordes hos Skatteverket. */
  checkedOn: string;
  source: string;
  /** Org-nr som redan står på profilen (t.ex. från VIES), om något. */
  existingOrgNumber: string | null;
  /** Har profilen ett VIES-verifierat org-nr? Då får det inte bytas här. */
  companyVerified: boolean;
}

export type FTaxRegistrationError =
  | "invalid_form"
  | "invalid_org"
  | "foreign_org"
  | "org_mismatch"
  | "invalid_date"
  | "future_date"
  | "too_old"
  | "invalid_source";

export type FTaxRegistration =
  | {
      ok: true;
      companyForm: CompanyForm;
      orgNumber: string;
      checkedAt: string;
      source: "skatteverket_manuell";
    }
  | { ok: false; error: FTaxRegistrationError };

/** Bara manuell kontroll finns i dag; API Beskattningsengagemang kräver avtal. */
export const F_TAX_SOURCES = ["skatteverket_manuell"] as const;

export function validateFTaxRegistration(
  input: FTaxRegistrationInput,
  now: Date = new Date(),
): FTaxRegistration {
  if (!isCompanyForm(input.companyForm)) return { ok: false, error: "invalid_form" };
  if (!(F_TAX_SOURCES as readonly string[]).includes(input.source)) {
    return { ok: false, error: "invalid_source" };
  }

  const rawOrg = (input.orgNumber ?? "").trim();
  if (isForeignOrgNumber(rawOrg)) return { ok: false, error: "foreign_org" };
  const org = normalizeOrgNumber(rawOrg);
  if (!org) return { ok: false, error: "invalid_org" };
  if (input.companyVerified && input.existingOrgNumber && input.existingOrgNumber !== org) {
    return { ok: false, error: "org_mismatch" };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.checkedOn ?? "")) return { ok: false, error: "invalid_date" };
  const checked = new Date(`${input.checkedOn}T00:00:00Z`);
  if (Number.isNaN(checked.getTime()) || checked.toISOString().slice(0, 10) !== input.checkedOn) {
    return { ok: false, error: "invalid_date" };
  }
  const today = now.toISOString().slice(0, 10);
  if (input.checkedOn > today) return { ok: false, error: "future_date" };
  if (now.getTime() - checked.getTime() > F_TAX_MAX_AGE_DAYS * 86_400_000) {
    return { ok: false, error: "too_old" };
  }

  return {
    ok: true,
    companyForm: input.companyForm,
    orgNumber: org,
    checkedAt: checked.toISOString(),
    source: "skatteverket_manuell",
  };
}
