import { describe, it, expect } from "vitest";
import { validateFTaxRegistration, type FTaxRegistrationInput } from "../f-tax-registration";
import { F_TAX_MAX_AGE_DAYS } from "../beta-gate";

const NOW = new Date("2026-11-22T12:00:00Z");
const base: FTaxRegistrationInput = {
  companyForm: "aktiebolag",
  orgNumber: "556677-8899",
  checkedOn: "2026-11-22",
  source: "skatteverket_manuell",
  existingOrgNumber: null,
  companyVerified: false,
};

describe("registrering av kontrollerad F-skatt", () => {
  it("godtar en korrekt kontroll och normaliserar org-nr", () => {
    const r = validateFTaxRegistration(base, NOW);
    expect(r).toEqual({ ok: true, companyForm: "aktiebolag", orgNumber: "5566778899", checkedAt: "2026-11-22T00:00:00.000Z", source: "skatteverket_manuell" });
  });

  it("godtar alla tre mottagartyperna", () => {
    for (const companyForm of ["aktiebolag", "enskild_firma", "forening"]) {
      expect(validateFTaxRegistration({ ...base, companyForm }, NOW).ok).toBe(true);
    }
  });

  it("avvisar okänd bolagsform", () => {
    expect(validateFTaxRegistration({ ...base, companyForm: "privatperson" }, NOW)).toEqual({ ok: false, error: "invalid_form" });
  });

  it("avvisar ogiltigt org-nr", () => {
    expect(validateFTaxRegistration({ ...base, orgNumber: "556677-8890" }, NOW)).toEqual({ ok: false, error: "invalid_org" });
  });

  it("avvisar utländskt momsnummer", () => {
    expect(validateFTaxRegistration({ ...base, orgNumber: "EL123456789" }, NOW)).toEqual({ ok: false, error: "foreign_org" });
  });

  it("byter inte ett VIES-verifierat org-nr", () => {
    expect(validateFTaxRegistration({ ...base, existingOrgNumber: "1234567897", companyVerified: true }, NOW)).toEqual({ ok: false, error: "org_mismatch" });
    expect(validateFTaxRegistration({ ...base, existingOrgNumber: "5566778899", companyVerified: true }, NOW).ok).toBe(true);
  });

  it("avvisar framtida, trasiga och för gamla datum", () => {
    expect(validateFTaxRegistration({ ...base, checkedOn: "2026-11-23" }, NOW)).toEqual({ ok: false, error: "future_date" });
    expect(validateFTaxRegistration({ ...base, checkedOn: "2026-02-30" }, NOW)).toEqual({ ok: false, error: "invalid_date" });
    expect(validateFTaxRegistration({ ...base, checkedOn: "22/11" }, NOW)).toEqual({ ok: false, error: "invalid_date" });
    const old = new Date(NOW.getTime() - (F_TAX_MAX_AGE_DAYS + 2) * 86_400_000).toISOString().slice(0, 10);
    expect(validateFTaxRegistration({ ...base, checkedOn: old }, NOW)).toEqual({ ok: false, error: "too_old" });
  });

  it("godtar bara manuell kontroll som källa i dag", () => {
    expect(validateFTaxRegistration({ ...base, source: "skatteverket_api" }, NOW)).toEqual({ ok: false, error: "invalid_source" });
  });
});
