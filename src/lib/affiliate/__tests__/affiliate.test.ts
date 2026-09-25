import { describe, it, expect } from "vitest";
import { normalizeRefCode, isFreshSignup, withinAttributionWindow } from "../attribution";
import { ushaRevenueOre, rewardsForBooking, summarizeRewards } from "../rewards";

describe("attribuering", () => {
  it("normaliserar koden och avvisar skräp", () => {
    expect(normalizeRefCode(" ab12cd ")).toBe("AB12CD");
    expect(normalizeRefCode("x")).toBeNull();
    expect(normalizeRefCode("drop table;")).toBeNull();
  });
  it("räknar bara nyskapade konton som färska", () => {
    const now = new Date("2026-09-11T12:00:00Z");
    expect(isFreshSignup("2026-09-11T11:55:00Z", now)).toBe(true);
    expect(isFreshSignup("2026-09-11T11:40:00Z", now)).toBe(false);
    expect(isFreshSignup(null, now)).toBe(false);
  });
  it("håller 12-månadersfönstret", () => {
    const at = new Date("2026-09-11T00:00:00Z");
    expect(withinAttributionWindow("2025-10-01T00:00:00Z", at)).toBe(true);
    expect(withinAttributionWindow("2025-09-01T00:00:00Z", at)).toBe(false);
  });
});

describe("belöningar", () => {
  it("räknar Ushas intäkt: provisionen för tredjepart, 10 % för egna event", () => {
    expect(ushaRevenueOre({ flow: "third_party", platformFeeOre: 1500, amountOre: 10000 })).toBe(1500);
    expect(ushaRevenueOre({ flow: "usha_principal", platformFeeOre: 1500, amountOre: 20000 })).toBe(2000);
  });
  it("ger 30 % andel och 50 kr vid värvad kunds första köp", () => {
    const rows = rewardsForBooking({ bookingId: "b1", affiliateId: "a", referredProfileId: "c", ushaRevenueOre: 2000, isFirstPurchase: true });
    expect(rows.map((r) => [r.kind, r.amount_ore])).toEqual([["commission_share", 600], ["credit", 5000]]);
    expect(rows.map((r) => r.ref)).toEqual(["b1:commission_share", "b1:credit"]);
  });
  it("ger ingen kredit för gäster och ingen andel utan intäkt", () => {
    expect(rewardsForBooking({ bookingId: "b2", affiliateId: "a", referredProfileId: null, ushaRevenueOre: 0, isFirstPurchase: true })).toEqual([]);
    const guest = rewardsForBooking({ bookingId: "b3", affiliateId: "a", referredProfileId: null, ushaRevenueOre: 1000, isFirstPurchase: false });
    expect(guest).toHaveLength(1);
    expect(guest[0].kind).toBe("commission_share");
  });
  it("summerar intjänat, utbetalt och premiumdagar, och räknar bort void", () => {
    const s = summarizeRewards([
      { kind: "commission_share", amount_ore: 600, premium_days: 0, status: "pending" },
      { kind: "credit", amount_ore: 5000, premium_days: 0, status: "paid" },
      { kind: "premium_days", amount_ore: 0, premium_days: 30, status: "approved" },
      { kind: "commission_share", amount_ore: 900, premium_days: 0, status: "void" },
    ]);
    expect(s).toEqual({ earnedOre: 5600, paidOre: 5000, pendingOre: 600, premiumDays: 30, voidOre: 900 });
  });
});
