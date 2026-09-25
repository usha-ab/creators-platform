import { describe, it, expect } from "vitest";
import { ROLES, normalizeRole } from "../roles";

// Rollistan har funnits på flera ställen och glidit isär: triggern saknade
// venue i tre månader. Det här testet pinnar den enda källan.
describe("normalizeRole", () => {
  it("släpper igenom de tre kanoniska rollerna oförändrade", () => {
    for (const r of Object.values(ROLES)) expect(normalizeRole(r)).toBe(r);
  });

  it("mappar det gamla namnet experience till venue", () => {
    expect(normalizeRole("experience")).toBe(ROLES.VENUE);
    expect(normalizeRole("upplevelse")).toBe(ROLES.VENUE);
  });

  it("ger null för okända värden — aldrig en gissad roll", () => {
    expect(normalizeRole("admin")).toBeNull();
    expect(normalizeRole("")).toBeNull();
    expect(normalizeRole(undefined)).toBeNull();
  });
});
