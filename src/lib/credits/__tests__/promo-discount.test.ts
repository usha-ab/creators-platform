import { describe, it, expect } from "vitest";
import { sessionDiscountOre, totalCreditOre } from "@/lib/credits/promo-discount";

const sess = (amount_discount: unknown) =>
  ({ total_details: { amount_discount } } as never);

describe("sessionDiscountOre", () => {
  it("läser rabatten ur sessionen", () => {
    expect(sessionDiscountOre(sess(5000))).toBe(5000);
  });

  it("ger 0 när ingen rabatt användes", () => {
    expect(sessionDiscountOre(sess(0))).toBe(0);
  });

  it("tål sessioner utan total_details", () => {
    expect(sessionDiscountOre({} as never)).toBe(0);
    expect(sessionDiscountOre(null)).toBe(0);
    expect(sessionDiscountOre(undefined)).toBe(0);
  });

  it("släpper aldrig igenom negativa eller orimliga värden", () => {
    // Ett negativt värde skulle öka lokalens andel över ordinarie pris.
    expect(sessionDiscountOre(sess(-5000))).toBe(0);
    expect(sessionDiscountOre(sess(NaN))).toBe(0);
    expect(sessionDiscountOre(sess(Infinity))).toBe(0);
    expect(sessionDiscountOre(sess("5000"))).toBe(0);
  });
});

describe("totalCreditOre", () => {
  it("lägger ihop välkomstavdrag och rabattkod", () => {
    expect(totalCreditOre("5000", sess(5000))).toBe(10000);
  });

  it("fungerar när bara ett av dem finns", () => {
    expect(totalCreditOre("5000", sess(0))).toBe(5000);
    expect(totalCreditOre(undefined, sess(5000))).toBe(5000);
    expect(totalCreditOre(null, sess(0))).toBe(0);
  });

  it("ignorerar skräp i metadata", () => {
    expect(totalCreditOre("inte ett tal", sess(5000))).toBe(5000);
    expect(totalCreditOre("-5000", sess(0))).toBe(0);
  });
});
