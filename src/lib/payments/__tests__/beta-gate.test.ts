import { describe, it, expect, afterEach, vi } from "vitest";
import {
  canReceivePayments,
  payeeBlockCode,
  isFTaxValid,
  isForeignOrgNumber,
  COMPANY_FORMS,
  F_TAX_MAX_AGE_DAYS,
  type PayeeEligibility,
} from "../beta-gate";
import { resolvePayeeFlow } from "@/lib/stripe/checkout";

const OWNER_ID = "15d852ed-1f33-446f-9bcb-821c2444c84f"; // pablo.acosta@usha.se (default owner)
const NOW = new Date("2026-11-22T12:00:00Z");
const FRESH = "2026-11-01T00:00:00Z";
const STALE = new Date(NOW.getTime() - (F_TAX_MAX_AGE_DAYS + 1) * 86_400_000).toISOString();
const SE_ORG = "5566778899";

afterEach(() => vi.unstubAllEnvs());

function payee(p: Partial<PayeeEligibility>): PayeeEligibility {
  return { id: "someone-else", company_form: null, org_number: null, f_tax_verified_at: null, ...p };
}

describe("mottagarspärren", () => {
  it("släpper igenom Ushas eget konto utan bolagsuppgifter", () => {
    expect(canReceivePayments({ id: OWNER_ID }, NOW)).toBe(true);
  });

  it("spärrar en saknad mottagare", () => {
    expect(canReceivePayments(null, NOW)).toBe(false);
    expect(canReceivePayments(undefined, NOW)).toBe(false);
    expect(payeeBlockCode(null, NOW)).toBe("missing");
  });

  it("spärrar en privatperson utan bolag", () => {
    expect(payeeBlockCode(payee({}), NOW)).toBe("no_company_form");
  });

  it("spärrar ett VIES-verifierat bolag utan F-skatt (momsen räcker inte)", () => {
    // Förut räckte company_verified_at. Det bevisar moms, inte F-skatt.
    const p = { ...payee({ company_form: "aktiebolag", org_number: SE_ORG }), company_verified_at: FRESH };
    expect(payeeBlockCode(p, NOW)).toBe("f_tax_missing");
  });

  it("spärrar okänd bolagsform", () => {
    expect(payeeBlockCode(payee({ company_form: "handelsbolag", org_number: SE_ORG, f_tax_verified_at: FRESH }), NOW)).toBe("no_company_form");
  });

  it("spärrar bolagsform utan org-nr", () => {
    expect(payeeBlockCode(payee({ company_form: "aktiebolag", f_tax_verified_at: FRESH }), NOW)).toBe("no_org_number");
  });

  it("spärrar utländska bolag även med F-skatt registrerad", () => {
    expect(payeeBlockCode(payee({ company_form: "aktiebolag", org_number: "EL123456789", f_tax_verified_at: FRESH }), NOW)).toBe("foreign");
  });

  it("spärrar när F-skattekontrollen är för gammal", () => {
    expect(payeeBlockCode(payee({ company_form: "aktiebolag", org_number: SE_ORG, f_tax_verified_at: STALE }), NOW)).toBe("f_tax_stale");
  });

  it("öppnas INTE av NEXT_PUBLIC_PAYMENTS_OPEN längre", () => {
    vi.stubEnv("NEXT_PUBLIC_PAYMENTS_OPEN", "true");
    expect(canReceivePayments(payee({}), NOW)).toBe(false);
  });

  describe("varje mottagartyp × F-skatt", () => {
    for (const form of COMPANY_FORMS) {
      it(`${form} med kontrollerad F-skatt får betalt`, () => {
        expect(canReceivePayments(payee({ company_form: form, org_number: SE_ORG, f_tax_verified_at: FRESH }), NOW)).toBe(true);
      });
      it(`${form} utan F-skatt spärras`, () => {
        expect(payeeBlockCode(payee({ company_form: form, org_number: SE_ORG }), NOW)).toBe("f_tax_missing");
      });
      it(`${form} med för gammal F-skattekontroll spärras`, () => {
        expect(payeeBlockCode(payee({ company_form: form, org_number: SE_ORG, f_tax_verified_at: STALE }), NOW)).toBe("f_tax_stale");
      });
    }

    it("enskild firma under momsgränsen (inget momsnummer) får betalt med F-skatt", () => {
      const p = { ...payee({ company_form: "enskild_firma", org_number: SE_ORG, f_tax_verified_at: FRESH }), company_verified_at: null };
      expect(canReceivePayments(p, NOW)).toBe(true);
    });

    it("förening utan moms får betalt med F-skatt", () => {
      const p = { ...payee({ company_form: "forening", org_number: "8020001234", f_tax_verified_at: FRESH }), company_verified_at: null };
      expect(canReceivePayments(p, NOW)).toBe(true);
    });
  });
});

describe("hjälpfunktioner", () => {
  it("känner igen utländska org-nr på landsprefixet", () => {
    expect(isForeignOrgNumber("EL123456789")).toBe(true);
    expect(isForeignOrgNumber("de123")).toBe(true);
    expect(isForeignOrgNumber(SE_ORG)).toBe(false);
    expect(isForeignOrgNumber(null)).toBe(false);
  });

  it("F-skatt gäller i F_TAX_MAX_AGE_DAYS dagar", () => {
    const edge = new Date(NOW.getTime() - F_TAX_MAX_AGE_DAYS * 86_400_000).toISOString();
    expect(isFTaxValid(edge, NOW)).toBe(true);
    expect(isFTaxValid(STALE, NOW)).toBe(false);
    expect(isFTaxValid(null, NOW)).toBe(false);
    expect(isFTaxValid("inte ett datum", NOW)).toBe(false);
  });
});

/**
 * Two independent mechanisms answer "is this Usha's own account?":
 *
 *   canReceivePayments()  — the legal gate. Reads OWNER_PAYEE_IDS only.
 *   resolvePayeeFlow()    — gross vs net. Reads is_usha_owned_seller OR the list.
 *
 * The asymmetry is deliberate: a database flag must not be able to open the
 * payment gate, so that DB access alone can never route money to a new payee.
 *
 * These tests pin the current behaviour and, more importantly, document the
 * trap below in a place a developer actually reads. They cannot detect every
 * future refactor of the gate — a widened PayeeEligibility would still satisfy
 * them — so treat the second test as an executable note, not a guard rail.
 */
describe("owner list vs is_usha_owned_seller", () => {
  const base = {
    stripe_account_id: "acct_test",
    card_payments_enabled: false,
    company_name: null,
    org_number: null,
    full_name: null,
  };

  it("both mechanisms agree for the default owner", () => {
    expect(canReceivePayments({ id: OWNER_ID })).toBe(true);
    expect(resolvePayeeFlow({ ...base, id: OWNER_ID, is_usha_owned_seller: true })).toBe(
      "usha_principal"
    );
  });

  it("is_usha_owned_seller alone routes the flow but does NOT open the gate", () => {
    // The silent trap: flagging a second Usha profile in the database gives it
    // the gross flow, yet the gate still blocks it. Selling would fail with no
    // obvious cause — the flag looks right. Such a profile needs the owner list
    // or a registered company form with checked F-skatt too.
    const payee = { ...base, id: "second-usha-profile", is_usha_owned_seller: true };

    expect(resolvePayeeFlow(payee)).toBe("usha_principal");
    expect(canReceivePayments({ id: payee.id })).toBe(false);
  });
});
