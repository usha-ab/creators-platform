import { describe, it, expect } from "vitest";
import {
  isFoundingPartner,
  foundingPartnerDaysLeft,
} from "@/lib/partners/founding";
import { getGratisPlan, GRUNDARPARTNER_PLAN } from "@/lib/stripe/config";

const NOW = new Date("2026-09-19T12:00:00Z");

describe("isFoundingPartner", () => {
  it("är falskt utan since", () => {
    expect(
      isFoundingPartner({ founding_partner_since: null, founding_partner_until: null }, NOW)
    ).toBe(false);
    expect(isFoundingPartner(null, NOW)).toBe(false);
    expect(isFoundingPartner(undefined, NOW)).toBe(false);
  });

  it("gäller tills vidare när until saknas", () => {
    expect(
      isFoundingPartner(
        { founding_partner_since: "2026-01-01T00:00:00Z", founding_partner_until: null },
        NOW
      )
    ).toBe(true);
  });

  it("gäller fram till until, men inte efter", () => {
    const p = {
      founding_partner_since: "2026-01-01T00:00:00Z",
      founding_partner_until: "2029-01-01T00:00:00Z",
    };
    expect(isFoundingPartner(p, NOW)).toBe(true);
    expect(isFoundingPartner(p, new Date("2029-01-02T00:00:00Z"))).toBe(false);
  });

  it("gäller inte innan since har inträffat", () => {
    expect(
      isFoundingPartner(
        { founding_partner_since: "2027-01-01T00:00:00Z", founding_partner_until: null },
        NOW
      )
    ).toBe(false);
  });

  it("förlänger inte tyst vid oläsbara datum", () => {
    expect(
      isFoundingPartner(
        { founding_partner_since: "inte ett datum", founding_partner_until: null },
        NOW
      )
    ).toBe(false);
    expect(
      isFoundingPartner(
        { founding_partner_since: "2026-01-01T00:00:00Z", founding_partner_until: "skräp" },
        NOW
      )
    ).toBe(false);
  });
});

describe("foundingPartnerDaysLeft", () => {
  it("är null när statusen inte gäller eller löper tills vidare", () => {
    expect(
      foundingPartnerDaysLeft({ founding_partner_since: null, founding_partner_until: null }, NOW)
    ).toBeNull();
    expect(
      foundingPartnerDaysLeft(
        { founding_partner_since: "2026-01-01T00:00:00Z", founding_partner_until: null },
        NOW
      )
    ).toBeNull();
  });

  it("räknar dagar kvar", () => {
    expect(
      foundingPartnerDaysLeft(
        {
          founding_partner_since: "2026-01-01T00:00:00Z",
          founding_partner_until: "2026-09-29T12:00:00Z",
        },
        NOW
      )
    ).toBe(10);
  });
});

describe("getGratisPlan", () => {
  it("ger grundarpartnerplanen till kreatör och venue", () => {
    expect(getGratisPlan("creator", true)).toEqual(GRUNDARPARTNER_PLAN);
    expect(getGratisPlan("venue", true)).toEqual(GRUNDARPARTNER_PLAN);
  });

  it("lovar inte obegränsat till publik, som inte skapar utbud", () => {
    expect(getGratisPlan("customer", true).name).not.toBe("Grundarpartner");
  });

  it("är oförändrad utan statusen", () => {
    expect(getGratisPlan("creator").name).toBe("Gratis");
  });

  it("säger självkostnad, inte provision", () => {
    const text = GRUNDARPARTNER_PLAN.features.join(" ");
    expect(text).toContain("obegränsat");
    expect(text).not.toMatch(/\d+% kommission/);
  });
});
