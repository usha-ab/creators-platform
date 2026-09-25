import { describe, it, expect } from "vitest";
import {
  applicableCredit,
  settlementBasisOre,
  SIGNUP_CREDIT_ORE,
  SIGNUP_CREDIT_MIN_SPEND_ORE,
} from "../signup";

describe("applicableCredit", () => {
  it("ger hela avdraget på ett köp över gränsen", () => {
    expect(applicableCredit({ creditOre: SIGNUP_CREDIT_ORE, subtotalOre: 20000 })).toBe(5000);
  });

  it("ger ingenting på en practica för 50 kr", () => {
    // Hela poängen med minsta köp: en registrering ska inte ge gratis inträde.
    expect(applicableCredit({ creditOre: SIGNUP_CREDIT_ORE, subtotalOre: 5000 })).toBe(0);
  });

  it("gäller precis på gränsen", () => {
    expect(
      applicableCredit({ creditOre: SIGNUP_CREDIT_ORE, subtotalOre: SIGNUP_CREDIT_MIN_SPEND_ORE })
    ).toBe(5000);
    expect(
      applicableCredit({ creditOre: SIGNUP_CREDIT_ORE, subtotalOre: SIGNUP_CREDIT_MIN_SPEND_ORE - 1 })
    ).toBe(0);
  });

  it("aldrig mer än ordersumman", () => {
    // Stripe vägrar negativa rader, och köparen ska inte få pengar tillbaka.
    expect(applicableCredit({ creditOre: 20000, subtotalOre: 16000 })).toBe(16000);
  });

  it("ger ingenting när avdraget är använt eller utgånget", () => {
    expect(applicableCredit({ creditOre: SIGNUP_CREDIT_ORE, subtotalOre: 20000, used: true })).toBe(0);
    expect(applicableCredit({ creditOre: SIGNUP_CREDIT_ORE, subtotalOre: 20000, expired: true })).toBe(0);
  });

  it("tål saknat, tomt och orimligt", () => {
    expect(applicableCredit({ creditOre: null, subtotalOre: 20000 })).toBe(0);
    expect(applicableCredit({ creditOre: 0, subtotalOre: 20000 })).toBe(0);
    expect(applicableCredit({ creditOre: -5000, subtotalOre: 20000 })).toBe(0);
    expect(applicableCredit({ creditOre: SIGNUP_CREDIT_ORE, subtotalOre: 0 })).toBe(0);
    expect(applicableCredit({ creditOre: SIGNUP_CREDIT_ORE, subtotalOre: NaN })).toBe(0);
  });
});

describe("settlementBasisOre", () => {
  it("lägger tillbaka avdraget så partnern får sin andel av ordinarie pris", () => {
    // Köparen betalade 150 av 200. Partnern ska räkna på 200.
    expect(settlementBasisOre({ amount_paid: 15000, credit_applied_ore: 5000 })).toBe(20000);
  });

  it("är oförändrat för bokningar utan avdrag", () => {
    expect(settlementBasisOre({ amount_paid: 20000, credit_applied_ore: 0 })).toBe(20000);
    expect(settlementBasisOre({ amount_paid: 20000 })).toBe(20000);
    expect(settlementBasisOre({})).toBe(0);
  });
});
