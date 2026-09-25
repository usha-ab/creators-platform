import { describe, it, expect } from "vitest";
import { BROWSABLE_TYPES } from "../browse";

/** Samma logik som PostgREST tillämpar på uttrycket, i JS. */
function slapperIgenom(listingType: string | null): boolean {
  return listingType === null || listingType !== "package";
}

describe("BROWSABLE_TYPES", () => {
  it("släpper igenom evenemang och tjänster", () => {
    expect(slapperIgenom("event")).toBe(true);
    expect(slapperIgenom("service")).toBe(true);
  });

  it("stoppar klippkort", () => {
    expect(slapperIgenom("package")).toBe(false);
  });

  it("släpper igenom en listning utan typ — den ska synas, inte försvinna", () => {
    expect(slapperIgenom(null)).toBe(true);
  });

  it("uttrycket är NULL-säkert, inte ett rent neq", () => {
    // Ett blott "listing_type.neq.package" hade tappat NULL-rader tyst.
    expect(BROWSABLE_TYPES).toContain("listing_type.is.null");
    expect(BROWSABLE_TYPES).toContain("listing_type.neq.package");
  });
});
