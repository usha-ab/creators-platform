import { describe, it, expect } from "vitest";
import { absoluteUrl, languageAlternates, indexable, notIndexable, asLocale, SITE_URL } from "../metadata";

describe("absoluteUrl", () => {
  it("gör relativa vägar absoluta och lämnar absoluta i fred", () => {
    expect(absoluteUrl("/kalender")).toBe(`${SITE_URL}/kalender`);
    expect(absoluteUrl("kalender")).toBe(`${SITE_URL}/kalender`);
    expect(absoluteUrl("https://usha.se/om")).toBe("https://usha.se/om");
  });
});

describe("languageAlternates", () => {
  it("ger en adress per språk plus x-default", () => {
    const alts = languageAlternates("/kalender");
    expect(alts).toEqual({
      sv: `${SITE_URL}/kalender?lang=sv`,
      en: `${SITE_URL}/kalender?lang=en`,
      es: `${SITE_URL}/kalender?lang=es`,
      "x-default": `${SITE_URL}/kalender`,
    });
  });

  it("använder & när adressen redan har en frågesträng", () => {
    expect(languageAlternates("/upplevelser?category=dance").sv).toBe(
      `${SITE_URL}/upplevelser?category=dance&lang=sv`
    );
  });
});

describe("indexable och notIndexable", () => {
  it("pekar ut canonical och språken", () => {
    const m = indexable("/event/the-lab");
    expect(m.alternates?.canonical).toBe(`${SITE_URL}/event/the-lab`);
    expect(Object.keys(m.alternates?.languages ?? {})).toContain("x-default");
  });

  it("håller kvitton och bekräftelser utanför index men följer länkar", () => {
    expect(notIndexable().robots).toEqual({ index: false, follow: true });
  });
});

describe("asLocale", () => {
  it("släpper bara igenom språk vi har", () => {
    expect(asLocale("sv")).toBe("sv");
    expect(asLocale("es")).toBe("es");
    expect(asLocale("de")).toBeNull();
    expect(asLocale(null)).toBeNull();
  });
});
