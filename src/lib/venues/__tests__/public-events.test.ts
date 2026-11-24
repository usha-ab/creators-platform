import { describe, it, expect } from "vitest";
import { visibleVenueEvents, countUpcoming, isTestEvent, formatEventDate } from "../public-events";

const rows = [
  { id: "pass", title: "The Lab – Klippkort 8 torsdagar", event_date: null },
  { id: "test", title: "Test and taste", event_date: "2026-12-01" },
  { id: "past", title: "The Lab Torsdag", event_date: "2026-11-19" },
  { id: "cancel", title: "INSTÄLLT: The Lab Torsdag", event_date: "2026-12-03" },
  { id: "dec10", title: "The Lab Torsdag", event_date: "2026-12-10" },
  { id: "today", title: "Brazilian Zouk Tisdag", event_date: "2026-11-24" },
  { id: "nov26", title: "The Lab Torsdag", event_date: "2026-11-26" },
];

describe("visibleVenueEvents", () => {
  it("visar bara kommande kvällar, närmast först, och klippkort sist", () => {
    expect(visibleVenueEvents(rows, "2026-11-24").map((r) => r.id)).toEqual(["today", "nov26", "dec10", "pass"]);
  });

  it("räknar bara daterade kommande kvällar", () => {
    expect(countUpcoming(rows, "2026-11-24")).toBe(3);
    expect(countUpcoming(rows, "2027-01-01")).toBe(0);
  });
});

describe("isTestEvent", () => {
  it("känner igen testevenemang på titeln", () => {
    expect(isTestEvent("Test and taste")).toBe(true);
    expect(isTestEvent("[TEST] Kväll")).toBe(true);
    expect(isTestEvent("Testevenemang")).toBe(true);
  });
  it("rör inte riktiga titlar som innehåller ordet", () => {
    expect(isTestEvent("The Lab Torsdag")).toBe(false);
    expect(isTestEvent("Testosteron-PT")).toBe(false);
    expect(isTestEvent("Smaktest på Bacchi")).toBe(false);
  });
});

describe("formatEventDate", () => {
  it("skriver datum på svenska", () => {
    expect(formatEventDate("2026-11-26", "17:00:00", "sv")).toMatch(/^tors 26 nov\.? · 17:00$/);
    expect(formatEventDate("2026-11-26", null, "sv")).toMatch(/^tors 26 nov/);
    expect(formatEventDate("2026-11-26", null, "sv")).not.toContain("2026");
  });
});
