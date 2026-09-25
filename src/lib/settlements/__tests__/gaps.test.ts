import { describe, it, expect } from "vitest";
import { findGaps, type NightInput, type VenueDefault, type SeriesRules } from "../gaps";

const BACCHI = "venue-bacchi";
const CHRISTIAN = "user-christian";

const venueDefaults: VenueDefault[] = [
  { venueProfileId: BACCHI, partnerPercent: 50, vatRate: 0.25, payoutDelayDays: 1 },
];
const seriesRules: SeriesRules[] = [
  { seriesSlug: "the-lab-mandag", codes: ["NICOLAS-A7K2"], collaboratorUserIds: [] },
  { seriesSlug: "brazilian-zouk-tisdag", codes: [], collaboratorUserIds: [CHRISTIAN] },
];

function night(over: Partial<NightInput> = {}): NightInput {
  return {
    id: "l1",
    title: "En kväll",
    eventDate: "2026-10-05",
    venueProfileId: BACCHI,
    seriesSlug: null,
    share: { partnerProfileId: BACCHI, partnerPercent: 50, vatRate: 0.25, payoutDelayDays: 1 },
    codes: [],
    collaboratorUserIds: [],
    ...over,
  };
}

describe("findGaps", () => {
  it("tiger när allt stämmer", () => {
    expect(findGaps({ nights: [night()], venueDefaults, seriesRules })).toEqual([]);
  });

  it("larmar när en kväll på lokalen saknar avräkning", () => {
    const gaps = findGaps({ nights: [night({ share: null })], venueDefaults, seriesRules });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].kind).toBe("saknar_avrakning");
    expect(gaps[0].detalj).toContain("50 %");
  });

  it("larmar när procenten avviker från lokalens avtal", () => {
    const gaps = findGaps({
      nights: [night({ share: { partnerProfileId: BACCHI, partnerPercent: 40, vatRate: 0.25, payoutDelayDays: 1 } })],
      venueDefaults,
      seriesRules,
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].kind).toBe("avrakning_avviker");
    expect(gaps[0].detalj).toContain("40 % i stället för 50 %");
  });

  it("larmar när utbetalningsdagen avviker", () => {
    const gaps = findGaps({
      nights: [night({ share: { partnerProfileId: BACCHI, partnerPercent: 50, vatRate: 0.25, payoutDelayDays: 7 } })],
      venueDefaults,
      seriesRules,
    });
    expect(gaps[0].detalj).toContain("efter 7 dagar i stället för 1");
  });

  it("jämför moms numeriskt, så 0.250 och 0.25 inte larmar", () => {
    const gaps = findGaps({
      nights: [night({ share: { partnerProfileId: BACCHI, partnerPercent: 50, vatRate: 0.250, payoutDelayDays: 1 } })],
      venueDefaults,
      seriesRules,
    });
    expect(gaps).toEqual([]);
  });

  it("rör inte kvällar på en lokal utan avtal", () => {
    const gaps = findGaps({
      nights: [night({ venueProfileId: "nagon-annan-lokal", share: null })],
      venueDefaults,
      seriesRules,
    });
    expect(gaps).toEqual([]);
  });

  it("larmar när seriens stående kod saknas", () => {
    const gaps = findGaps({
      nights: [night({ seriesSlug: "the-lab-mandag", codes: [] })],
      venueDefaults,
      seriesRules,
    });
    expect(gaps.map((g) => g.kind)).toEqual(["saknar_kod"]);
    expect(gaps[0].detalj).toContain("NICOLAS-A7K2");
  });

  it("tiger när koden redan finns", () => {
    const gaps = findGaps({
      nights: [night({ seriesSlug: "the-lab-mandag", codes: ["NICOLAS-A7K2"] })],
      venueDefaults,
      seriesRules,
    });
    expect(gaps).toEqual([]);
  });

  it("larmar när seriens stående medarrangör saknas", () => {
    const gaps = findGaps({
      nights: [night({ seriesSlug: "brazilian-zouk-tisdag", collaboratorUserIds: [] })],
      venueDefaults,
      seriesRules,
    });
    expect(gaps.map((g) => g.kind)).toEqual(["saknar_medarrangor"]);
  });

  it("samlar flera brister på samma kväll", () => {
    const gaps = findGaps({
      nights: [night({ seriesSlug: "the-lab-mandag", share: null, codes: [] })],
      venueDefaults,
      seriesRules,
    });
    expect(gaps.map((g) => g.kind).sort()).toEqual(["saknar_avrakning", "saknar_kod"]);
  });

  it("sorterar närmast i tiden först", () => {
    const gaps = findGaps({
      nights: [
        night({ id: "sen", eventDate: "2026-12-01", share: null }),
        night({ id: "tidig", eventDate: "2026-10-01", share: null }),
      ],
      venueDefaults,
      seriesRules,
    });
    expect(gaps.map((g) => g.listingId)).toEqual(["tidig", "sen"]);
  });
});
