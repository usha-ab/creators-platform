import { describe, it, expect } from "vitest";
import { decideConnectAccount, type ConnectProfile } from "../connect-eligibility";
import { F_TAX_MAX_AGE_DAYS } from "../beta-gate";

const NOW = new Date("2026-11-22T12:00:00Z");
const FRESH = "2026-11-01T00:00:00Z";
const STALE = new Date(NOW.getTime() - (F_TAX_MAX_AGE_DAYS + 1) * 86_400_000).toISOString();
const OWNER_ID = "15d852ed-1f33-446f-9bcb-821c2444c84f";

function profile(p: Partial<ConnectProfile> = {}): ConnectProfile {
  return {
    id: "u1",
    role: "creator",
    bankid_verified_at: "2026-10-01T00:00:00Z",
    bankid_grandfathered_at: null,
    stripe_account_id: null,
    company_form: null,
    org_number: null,
    f_tax_verified_at: null,
    ...p,
  };
}

describe("/api/stripe/connect: BankID- och säljarspärr", () => {
  it("spärrar saknad profil", () => {
    expect(decideConnectAccount(null, NOW)).toEqual({ ok: false, code: "not_cleared" });
  });

  it("spärrar säljare utan BankID", () => {
    expect(decideConnectAccount(profile({ bankid_verified_at: null }), NOW)).toEqual({ ok: false, code: "not_cleared" });
  });

  it("släpper igenom grandfathered BankID", () => {
    const d = decideConnectAccount(profile({ bankid_verified_at: null, bankid_grandfathered_at: "2026-01-01", company_form: "aktiebolag", org_number: "5566778899" }), NOW);
    expect(d.ok).toBe(true);
  });

  it("spärrar publik/kund-konton även med BankID", () => {
    expect(decideConnectAccount(profile({ role: "customer", company_form: "aktiebolag", org_number: "5566778899" }), NOW)).toEqual({ ok: false, code: "not_cleared" });
  });

  it("spärrar även återupptagning av befintligt konto utan BankID", () => {
    expect(decideConnectAccount(profile({ bankid_verified_at: null, stripe_account_id: "acct_x" }), NOW)).toEqual({ ok: false, code: "not_cleared" });
  });

  it("befintligt konto hos BankID-säljare återupptas", () => {
    expect(decideConnectAccount(profile({ stripe_account_id: "acct_x" }), NOW)).toEqual({ ok: true, existing: true });
  });
});

describe("/api/stripe/connect: nytt konto per mottagartyp", () => {
  it("privatperson utan bolag får inget anslutet konto", () => {
    expect(decideConnectAccount(profile(), NOW)).toEqual({ ok: false, code: "no_company_form" });
  });

  it("bolagsform utan org-nr spärras", () => {
    expect(decideConnectAccount(profile({ company_form: "aktiebolag" }), NOW)).toEqual({ ok: false, code: "no_org_number" });
  });

  it("aktiebolag → company (F-skatt kontrolleras vid utbetalning)", () => {
    for (const f of [null, FRESH]) {
      expect(decideConnectAccount(profile({ company_form: "aktiebolag", org_number: "5566778899", f_tax_verified_at: f }), NOW))
        .toEqual({ ok: true, existing: false, country: "SE", businessType: "company" });
    }
  });

  it("förening → company", () => {
    expect(decideConnectAccount(profile({ role: "venue", company_form: "forening", org_number: "8020001234" }), NOW))
      .toEqual({ ok: true, existing: false, country: "SE", businessType: "company" });
  });

  it("enskild firma med F-skatt → individual", () => {
    expect(decideConnectAccount(profile({ company_form: "enskild_firma", org_number: "8001011234", f_tax_verified_at: FRESH }), NOW))
      .toEqual({ ok: true, existing: false, country: "SE", businessType: "individual" });
  });

  it("enskild firma utan F-skatt spärras", () => {
    expect(decideConnectAccount(profile({ company_form: "enskild_firma", org_number: "8001011234" }), NOW))
      .toEqual({ ok: false, code: "f_tax_required" });
  });

  it("enskild firma med för gammal F-skattekontroll spärras", () => {
    expect(decideConnectAccount(profile({ company_form: "enskild_firma", org_number: "8001011234", f_tax_verified_at: STALE }), NOW))
      .toEqual({ ok: false, code: "f_tax_required" });
  });

  it("utländskt bolag (land ≠ SE) spärras med eget besked", () => {
    expect(decideConnectAccount(profile({ org_number: "EL123456789" }), NOW)).toEqual({ ok: false, code: "foreign" });
    expect(decideConnectAccount(profile({ company_form: "aktiebolag", org_number: "DE123456789", f_tax_verified_at: FRESH }), NOW))
      .toEqual({ ok: false, code: "foreign" });
  });

  it("Ushas eget konto får ett company-konto utan bolagsfält", () => {
    expect(decideConnectAccount(profile({ id: OWNER_ID, role: "creator" }), NOW))
      .toEqual({ ok: true, existing: false, country: "SE", businessType: "company" });
  });
});
