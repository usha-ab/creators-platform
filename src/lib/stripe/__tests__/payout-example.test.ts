import { describe, it, expect } from "vitest";
import {
  ticketPayoutExample, commissionParts, commissionTextParts, formatKrFromOre, PAYOUT_EXAMPLE_DEFAULT, PAYOUT_EXAMPLE_LIMITS, isBelowMinimumPrice,
} from "../payout-example";
import { platformCommissionOre, PLATFORM_COMMISSION } from "../commission";

describe("ticketPayoutExample (räkneexemplet på säljsidorna)", () => {
  it("20 biljetter à 150 kr → 3 000 kr in, 175 kr provision, 2 825 kr till arrangören", () => {
    expect(ticketPayoutExample(150, 20)).toEqual({ grossOre: 300_000, commissionOre: 17_500, netOre: 282_500 });
  });

  it("standardexemplet är 20 × 150 kr", () => {
    expect(PAYOUT_EXAMPLE_DEFAULT).toEqual({ priceKr: 150, qty: 20 });
  });

  it("räknar provisionen per biljett × antal, som kassan gör", () => {
    // 133,33 kr ger en udda öresavrundning: per biljett 4,67 + 3,50 = 8,17 kr.
    const ex = ticketPayoutExample(133.33, 3);
    expect(ex.commissionOre).toBe(platformCommissionOre(13333, 1) * 3);
    expect(ex.netOre).toBe(13333 * 3 - platformCommissionOre(13333, 1) * 3);
  });

  it("följer provisionen i commission.ts, inte en egen siffra", () => {
    const ex = ticketPayoutExample(100, 1);
    expect(ex.commissionOre).toBe(Math.round(10_000 * PLATFORM_COMMISSION.rate) + PLATFORM_COMMISSION.fixedOre);
  });

  it("gratis, noll eller ogiltigt ger noll överallt", () => {
    const zero = { grossOre: 0, commissionOre: 0, netOre: 0 };
    expect(ticketPayoutExample(0, 20)).toEqual(zero);
    expect(ticketPayoutExample(150, 0)).toEqual(zero);
    expect(ticketPayoutExample(-5, 3)).toEqual(zero);
    expect(ticketPayoutExample(Number.NaN, 3)).toEqual(zero);
  });

  it("delar av biljetter räknas inte, och orimliga tal stannar vid taket", () => {
    expect(ticketPayoutExample(150, 2.9)).toEqual(ticketPayoutExample(150, 2));
    expect(ticketPayoutExample(150, 1e9).grossOre).toBe(15_000 * PAYOUT_EXAMPLE_LIMITS.maxQty);
    expect(ticketPayoutExample(1e9, 1).grossOre).toBe(PAYOUT_EXAMPLE_LIMITS.maxPriceKr * 100);
  });

  it("arrangörens del är positiv för alla tillåtna priser (från 50 kr)", () => {
    for (const kr of [50, 51, 150, 450]) {
      expect(ticketPayoutExample(kr, 10).netOre).toBeGreaterThan(0);
    }
  });

  it("ger inget exempel för betalda priser under lägsta priset", () => {
    const zero = { grossOre: 0, commissionOre: 0, netOre: 0 };
    for (const kr of [1, 5, 10, 49, 49.99]) {
      expect(ticketPayoutExample(kr, 10)).toEqual(zero);
      expect(isBelowMinimumPrice(kr)).toBe(true);
    }
    expect(isBelowMinimumPrice(0)).toBe(false);
    expect(isBelowMinimumPrice(50)).toBe(false);
  });

  it("commissionParts speglar PLATFORM_COMMISSION", () => {
    expect(commissionParts()).toEqual({ rate: PLATFORM_COMMISSION.rate, fixedKr: PLATFORM_COMMISSION.fixedOre / 100 });
  });
});

// Intl lägger hårda mellanslag; jämför med vanliga.
const norm = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

describe("formatKrFromOre och commissionTextParts", () => {
  it("svenska: hela kronor utan öre, öre när de finns", () => {
    expect(norm(formatKrFromOre(282_500, "sv"))).toBe("2 825 kr");
    expect(norm(formatKrFromOre(805, "sv"))).toBe("8,05 kr");
  });

  it("provisionens text kommer ur PLATFORM_COMMISSION", () => {
    expect(norm(commissionTextParts("sv").rate)).toBe("3,5 %");
    expect(norm(commissionTextParts("sv").fixed)).toBe("3,50 kr");
    expect(norm(commissionTextParts("en").rate)).toBe("3.5%");
    expect(norm(commissionTextParts("en").fixed)).toBe("SEK 3.50");
  });
});
