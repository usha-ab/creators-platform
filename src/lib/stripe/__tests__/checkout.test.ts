import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolvePayeeFlow,
  buildConnectPaymentIntentData,
  buildStatementDescriptorSuffix,
  buildPaymentMetadata,
  buildTermsCustomText,
  receiptSeller,
  type PayeeContext,
} from "../checkout";

const OWNER_ID = "15d852ed-1f33-446f-9bcb-821c2444c84f"; // beta-gate default owner

function payee(overrides: Partial<PayeeContext> = {}): PayeeContext {
  return {
    id: "third-party-1",
    stripe_account_id: "acct_123",
    card_payments_enabled: false,
    is_usha_owned_seller: false,
    company_name: null,
    org_number: null,
    full_name: "Anna Andersson",
    ...overrides,
  };
}

describe("resolvePayeeFlow", () => {
  it("owner id → usha_principal", () => {
    expect(resolvePayeeFlow(payee({ id: OWNER_ID }))).toBe("usha_principal");
  });
  it("is_usha_owned_seller → usha_principal", () => {
    expect(resolvePayeeFlow(payee({ is_usha_owned_seller: true }))).toBe("usha_principal");
  });
  it("ordinary organizer → third_party", () => {
    expect(resolvePayeeFlow(payee())).toBe("third_party");
  });
});

describe("buildConnectPaymentIntentData", () => {
  it("principal flow → no transfer/fee/on_behalf_of, but metadata stamped", () => {
    const pid = buildConnectPaymentIntentData({
      flow: "usha_principal",
      payee: payee(),
      applicationFeeOre: 1000,
      metadata: { model: "principal" },
    });
    expect(pid.transfer_data).toBeUndefined();
    expect(pid.application_fee_amount).toBeUndefined();
    expect(pid.on_behalf_of).toBeUndefined();
    expect(pid.metadata).toEqual({ model: "principal" });
  });

  it("third_party WITH card_payments → on_behalf_of + descriptor + transfer + fee", () => {
    const pid = buildConnectPaymentIntentData({
      flow: "third_party",
      payee: payee({ card_payments_enabled: true, company_name: "Joy Nation AB" }),
      applicationFeeOre: 1500,
    })!;
    expect(pid.transfer_data?.destination).toBe("acct_123");
    expect(pid.on_behalf_of).toBe("acct_123");
    expect(pid.application_fee_amount).toBe(1500);
    expect(pid.statement_descriptor_suffix).toBe("Joy Nation AB");
  });

  it("third_party WITHOUT card_payments → transfer + fee but NO on_behalf_of (fallback)", () => {
    const pid = buildConnectPaymentIntentData({
      flow: "third_party",
      payee: payee({ card_payments_enabled: false }),
      applicationFeeOre: 1500,
    })!;
    expect(pid.transfer_data?.destination).toBe("acct_123");
    expect(pid.application_fee_amount).toBe(1500);
    expect(pid.on_behalf_of).toBeUndefined();
    expect(pid.statement_descriptor_suffix).toBeUndefined();
  });

  it("zero fee (gage) → no application_fee_amount", () => {
    const pid = buildConnectPaymentIntentData({
      flow: "third_party",
      payee: payee({ card_payments_enabled: true }),
      applicationFeeOre: 0,
    })!;
    expect(pid.application_fee_amount).toBeUndefined();
    expect(pid.transfer_data?.destination).toBe("acct_123");
  });

  it("missing stripe account → metadata only, no transfer", () => {
    const pid = buildConnectPaymentIntentData({
      flow: "third_party",
      payee: payee({ stripe_account_id: null }),
      applicationFeeOre: 100,
      metadata: { model: "agent" },
    });
    expect(pid.transfer_data).toBeUndefined();
    expect(pid.metadata).toEqual({ model: "agent" });
  });
});

describe("buildPaymentMetadata", () => {
  const OLD = process.env;
  beforeEach(() => {
    process.env = { ...OLD, USHA_LEGAL_NAME: "Usha AB", USHA_ORG_NUMBER: "5594018326" };
  });
  afterEach(() => {
    process.env = OLD;
  });

  it("third_party company → model=agent + organizer org.nr + event fields", () => {
    const meta = buildPaymentMetadata({
      flow: "third_party",
      payee: { company_name: "Joy Nation AB", org_number: "5560360793", full_name: "Anna" },
      eventId: "evt_1",
      eventDate: "2026-09-01",
      seriesSlug: "brazilian-zouk-tisdag",
    });
    expect(meta).toEqual({
      model: "agent",
      event_date: "2026-09-01",
      organizer_org_nr: "556036-0793",
      event_id: "evt_1",
      series_slug: "brazilian-zouk-tisdag",
      terms_url: "",
    });
  });

  it("series_slug blir tom sträng när kvällen inte tillhör en serie", () => {
    const meta = buildPaymentMetadata({
      flow: "usha_principal",
      payee: { company_name: null, org_number: null, full_name: "Pablo" },
      eventId: "evt_2",
    });
    expect(meta.series_slug).toBe("");
  });

  it("stamps terms_url when provided", () => {
    const meta = buildPaymentMetadata({
      flow: "third_party",
      payee: { company_name: "Joy Nation AB", org_number: "5560360793", full_name: "Anna" },
      eventId: "evt_1",
      termsUrl: "https://joynation.se/villkor",
    });
    expect(meta.terms_url).toBe("https://joynation.se/villkor");
  });

  it("principal → model=principal + Usha org.nr", () => {
    const meta = buildPaymentMetadata({
      flow: "usha_principal",
      payee: { company_name: null, org_number: null, full_name: null },
      eventId: "evt_2",
      eventDate: "2026-07-03",
    });
    expect(meta.model).toBe("principal");
    expect(meta.organizer_org_nr).toBe("5594018326");
    expect(meta.event_id).toBe("evt_2");
    expect(meta.event_date).toBe("2026-07-03");
  });

  it("third_party individual (no org.nr) → empty organizer_org_nr, empty event_date", () => {
    const meta = buildPaymentMetadata({
      flow: "third_party",
      payee: { company_name: null, org_number: null, full_name: "Anna Andersson" },
      eventId: "evt_3",
    });
    expect(meta.organizer_org_nr).toBe("");
    expect(meta.event_date).toBe("");
    expect(meta.model).toBe("agent");
    expect(meta.terms_url).toBe("");
  });
});

describe("buildTermsCustomText", () => {
  it("returns undefined when the organizer has no terms", () => {
    expect(buildTermsCustomText(null)).toBeUndefined();
    expect(buildTermsCustomText("")).toBeUndefined();
  });

  it("builds an after_submit message linking the organizer's terms", () => {
    const ct = buildTermsCustomText("https://joynation.se/villkor")!;
    const message = (ct.after_submit as { message: string }).message;
    expect(message).toContain("https://joynation.se/villkor");
    expect(message).toContain("köpvillkor");
    expect(message.length).toBeLessThanOrEqual(1200);
  });
});

describe("buildStatementDescriptorSuffix", () => {
  it("strips forbidden chars and trims to 22", () => {
    expect(buildStatementDescriptorSuffix("Café <Jazz*> Night Productions AB")).toBe(
      "Cafe Jazz Night Produc"
    );
  });
  it("empty/short → undefined", () => {
    expect(buildStatementDescriptorSuffix("")).toBeUndefined();
    expect(buildStatementDescriptorSuffix("*")).toBeUndefined();
    expect(buildStatementDescriptorSuffix(null)).toBeUndefined();
  });
});

describe("receiptSeller", () => {
  const OLD = process.env;
  beforeEach(() => {
    process.env = { ...OLD, USHA_LEGAL_NAME: "Usha AB", USHA_ORG_NUMBER: "5594018326" };
  });
  afterEach(() => {
    process.env = OLD;
  });

  it("principal → Usha legal name + org.nr", () => {
    expect(receiptSeller("usha_principal", { company_name: null, org_number: null, full_name: null })).toEqual({
      name: "Usha AB",
      orgNumber: "5594018326",
    });
  });
  it("third_party with company + org → formatted org.nr", () => {
    expect(
      receiptSeller("third_party", { company_name: "Joy Nation AB", org_number: "5560360793", full_name: "Anna" })
    ).toEqual({ name: "Joy Nation AB", orgNumber: "556036-0793" });
  });
  it("third_party individual (no org.nr) → legal name only", () => {
    expect(
      receiptSeller("third_party", { company_name: null, org_number: null, full_name: "Anna Andersson" })
    ).toEqual({ name: "Anna Andersson" });
  });
});
