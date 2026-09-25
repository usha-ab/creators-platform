import { describe, it, expect } from "vitest";
import { isCompGrant, isPermanentGrant, hasExpired } from "../comp";

describe("isCompGrant", () => {
  it("räknar ett äkta Stripe-abonnemang som betalande", () => {
    expect(isCompGrant({ stripe_subscription_id: "sub_1ABCdef" })).toBe(false);
  });

  it("känner igen betans comp-rader", () => {
    expect(isCompGrant({ stripe_subscription_id: "comp_owner_lifetime" })).toBe(true);
    expect(isCompGrant({ stripe_subscription_id: "comp_family_lifetime_osvaldo" })).toBe(true);
  });

  it("behandlar saknat id som comp — hellre det än att en gåva löper vidare", () => {
    expect(isCompGrant({ stripe_subscription_id: null })).toBe(true);
    expect(isCompGrant({})).toBe(true);
  });
});

describe("hasExpired", () => {
  const nu = new Date("2026-09-16T12:00:00Z");

  it("faller på sitt eget slutdatum", () => {
    expect(hasExpired({ current_period_end: "2026-09-15T00:00:00Z" }, nu, null)).toBe(true);
  });

  it("står kvar när slutdatumet ligger framåt", () => {
    expect(hasExpired({ current_period_end: "2026-10-16T00:00:00Z" }, nu, null)).toBe(false);
  });

  it("2099-raderna står kvar tills betans slutdatum sätts", () => {
    expect(hasExpired({ current_period_end: "2099-12-31T00:00:00Z" }, nu, null)).toBe(false);
  });

  it("faller när betan tagit slut, oavsett 2099", () => {
    const betaSlut = new Date("2026-09-01T00:00:00Z");
    expect(hasExpired({ current_period_end: "2099-12-31T00:00:00Z" }, nu, betaSlut)).toBe(true);
  });

  it("betans slutdatum i framtiden rör ingenting", () => {
    const betaSlut = new Date("2027-01-01T00:00:00Z");
    expect(hasExpired({ current_period_end: "2099-12-31T00:00:00Z" }, nu, betaSlut)).toBe(false);
  });

  it("utan slutdatum och utan betagräns händer inget", () => {
    expect(hasExpired({ current_period_end: null }, nu, null)).toBe(false);
  });
});

describe("isPermanentGrant", () => {
  it("känner igen de fem livstidsgåvorna", () => {
    for (const id of [
      "comp_owner_lifetime",
      "comp_owner_lifetime_gmail",
      "comp_owner_lifetime_aztk",
      "comp_owner_lifetime_gmail2",
      "comp_family_lifetime_osvaldo",
    ]) {
      expect(isPermanentGrant({ stripe_subscription_id: id })).toBe(true);
    }
  });

  it("en tidsbegränsad gåva är inte permanent", () => {
    expect(isPermanentGrant({ stripe_subscription_id: "comp_christian_1man" })).toBe(false);
    expect(isPermanentGrant({ stripe_subscription_id: null })).toBe(false);
  });
});

describe("livstidsgåvor faller aldrig", () => {
  const nu = new Date("2026-09-16T12:00:00Z");
  const betaSlut = new Date("2026-09-01T00:00:00Z"); // redan passerat

  it("överlever betans slut", () => {
    expect(
      hasExpired(
        { current_period_end: "2099-12-31T00:00:00Z", stripe_subscription_id: "comp_owner_lifetime" },
        nu,
        betaSlut
      )
    ).toBe(false);
  });

  it("överlever även ett passerat eget slutdatum", () => {
    expect(
      hasExpired(
        { current_period_end: "2026-01-01T00:00:00Z", stripe_subscription_id: "comp_family_lifetime_osvaldo" },
        nu,
        null
      )
    ).toBe(false);
  });

  it("men en tidsbegränsad gåva faller som förut", () => {
    expect(
      hasExpired(
        { current_period_end: "2026-09-15T00:00:00Z", stripe_subscription_id: "comp_christian_1man" },
        nu,
        null
      )
    ).toBe(true);
  });
});
