import { describe, it, expect } from "vitest";
import { quarterLabel, previousQuarterLabel, payoutRouteFor, PAYOUT_MIN_ORE } from "../settle";
import { applicableLedgerCredit } from "@/lib/credits/balance";

describe("kvartal och utbetalningsväg", () => {
  it("namnger kvartal och hittar föregående", () => {
    expect(quarterLabel(new Date("2026-09-11T00:00:00Z"))).toBe("2026-Q3");
    expect(previousQuarterLabel(new Date("2026-09-11T00:00:00Z"))).toBe("2026-Q2");
    expect(previousQuarterLabel(new Date("2027-01-05T00:00:00Z"))).toBe("2026-Q4");
  });
  const bolag = { company_verified_at: "2026-01-01", stripe_account_id: "acct_1", stripe_charges_enabled: true };
  it("betalar kontant bara till bolag med Stripe och över gränsen", () => {
    expect(payoutRouteFor({ sumOre: PAYOUT_MIN_ORE, profile: bolag })).toBe("transfer");
    expect(payoutRouteFor({ sumOre: PAYOUT_MIN_ORE - 1, profile: bolag })).toBe("credit");
    expect(payoutRouteFor({ sumOre: 50000, profile: { ...bolag, company_verified_at: null } })).toBe("credit");
    expect(payoutRouteFor({ sumOre: 50000, profile: { ...bolag, stripe_charges_enabled: false } })).toBe("credit");
    expect(payoutRouteFor({ sumOre: 50000, profile: null })).toBe("credit");
  });
});

describe("intjänad kredit i kassan", () => {
  it("används utan minimigräns men aldrig över ordersumman", () => {
    expect(applicableLedgerCredit(5000, 4000)).toBe(4000);
    expect(applicableLedgerCredit(5000, 20000)).toBe(5000);
    expect(applicableLedgerCredit(0, 20000)).toBe(0);
    expect(applicableLedgerCredit(5000, 0)).toBe(0);
  });
});
