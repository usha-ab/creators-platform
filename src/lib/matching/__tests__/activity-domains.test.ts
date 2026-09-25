import { describe, it, expect } from "vitest";
import {
  domainForActivity,
  domainsForActivities,
  sharesDomain,
  isInDomain,
  isDomain,
  DEFAULT_DOMAIN,
} from "@/lib/matching/activity-domains";

describe("domainForActivity", () => {
  it("placerar aktiviteter i rätt domän", () => {
    expect(domainForActivity("kizomba")).toBe("dans");
    expect(domainForActivity("löpning")).toBe("traning");
    expect(domainForActivity("tennis")).toBe("racket");
    expect(domainForActivity("yoga")).toBe("kropp");
  });

  it("bryr sig inte om skiftläge eller blanksteg", () => {
    expect(domainForActivity("  KIZOMBA ")).toBe("dans");
    expect(domainForActivity("Urban Kiz")).toBe("dans");
  });

  it("lägger okända aktiviteter i den bredaste hinken", () => {
    // Hellre en rimlig gissning än att stänga ute någon som skrev något
    // vi inte hunnit lägga till.
    expect(domainForActivity("rodd")).toBe(DEFAULT_DOMAIN);
    expect(domainForActivity("")).toBe(DEFAULT_DOMAIN);
  });
});

describe("domainsForActivities", () => {
  it("ger domänerna i stabil ordning, utan dubbletter", () => {
    expect(domainsForActivities(["tennis", "kizomba", "padel", "bachata"])).toEqual([
      "dans",
      "racket",
    ]);
  });

  it("ger TOM lista när aktiviteter saknas", () => {
    // Viktigt: den som inte fyllt i något ska inte tyst hamna i en domän och
    // börja matchas mot främlingar.
    expect(domainsForActivities([])).toEqual([]);
    expect(domainsForActivities(null)).toEqual([]);
    expect(domainsForActivities(undefined)).toEqual([]);
    expect(domainsForActivities(["", "   "])).toEqual([]);
  });
});

describe("sharesDomain", () => {
  it("dansare hittar dansare", () => {
    expect(sharesDomain(["kizomba"], ["bachata"])).toBe(true);
  });

  it("löpare matchas INTE mot dansare", () => {
    // Hela poängen med domänindelningen.
    expect(sharesDomain(["löpning"], ["kizomba"])).toBe(false);
    expect(sharesDomain(["tennis"], ["yoga"])).toBe(false);
  });

  it("den som gör båda möter båda", () => {
    expect(sharesDomain(["kizomba", "löpning"], ["gym"])).toBe(true);
    expect(sharesDomain(["kizomba", "löpning"], ["salsa"])).toBe(true);
  });

  it("utan aktiviteter delas ingenting", () => {
    expect(sharesDomain([], ["kizomba"])).toBe(false);
    expect(sharesDomain(["kizomba"], [])).toBe(false);
    expect(sharesDomain(null, null)).toBe(false);
  });
});

describe("isInDomain", () => {
  it("svarar på om någon tillhör en domän", () => {
    expect(isInDomain(["padel"], "racket")).toBe(true);
    expect(isInDomain(["padel"], "dans")).toBe(false);
    expect(isInDomain(null, "dans")).toBe(false);
  });
});

describe("isDomain", () => {
  it("validerar frågeparametern", () => {
    expect(isDomain("dans")).toBe(true);
    expect(isDomain("racket")).toBe(true);
    expect(isDomain("hittepå")).toBe(false);
    expect(isDomain(null)).toBe(false);
    expect(isDomain(42)).toBe(false);
  });
});
