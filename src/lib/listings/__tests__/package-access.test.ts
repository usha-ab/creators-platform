import { describe, it, expect } from "vitest";
import { requiresTaxiDancer, canPublishListingType } from "../package-access";

describe("klippkort och låsta annonstyper", () => {
  it("låter vem som helst publicera klippkort", () => {
    expect(requiresTaxiDancer("package")).toBe(false);
    expect(canPublishListingType("package", "general")).toBe(true);
    expect(canPublishListingType("package", null)).toBe(true);
  });

  it("håller coaching och B2B kvar hos taxidansarna", () => {
    for (const type of ["coaching_session", "b2b_offering"]) {
      expect(requiresTaxiDancer(type)).toBe(true);
      expect(canPublishListingType(type, "general")).toBe(false);
      expect(canPublishListingType(type, "taxi_dancer")).toBe(true);
    }
  });

  it("rör inte vanliga tjänster och event", () => {
    for (const type of ["service", "event"]) {
      expect(canPublishListingType(type, null)).toBe(true);
    }
  });
});
