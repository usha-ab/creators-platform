import { describe, it, expect } from "vitest";
import { buildEventsCalendarIcs } from "../ics";

const bas = { uid: "u@usha.se", title: "The Lab", dateStr: "2026-09-21" };

describe("buildEventsCalendarIcs — sluttid", () => {
  it("skriver DTEND när sluttid finns", () => {
    const ics = buildEventsCalendarIcs("The Lab", [
      { ...bas, timeStr: "17:00", endTimeStr: "23:00" },
    ]);
    expect(ics).toContain("DTSTART:20260921T170000");
    expect(ics).toContain("DTEND:20260921T230000");
  });

  it("lägger sluttiden på nästa dag när kvällen passerar midnatt", () => {
    const ics = buildEventsCalendarIcs("Sen kväll", [
      { ...bas, timeStr: "22:00", endTimeStr: "03:00" },
    ]);
    expect(ics).toContain("DTSTART:20260921T220000");
    expect(ics).toContain("DTEND:20260922T030000");
  });

  it("utelämnar DTEND när sluttid saknas", () => {
    const ics = buildEventsCalendarIcs("The Lab", [{ ...bas, timeStr: "17:00" }]);
    expect(ics).toContain("DTSTART:20260921T170000");
    expect(ics).not.toContain("DTEND");
  });

  it("håller tiderna flytande — ingen Z, alltså ingen tidszonsförskjutning", () => {
    const ics = buildEventsCalendarIcs("The Lab", [
      { ...bas, timeStr: "17:00", endTimeStr: "23:00" },
    ]);
    expect(ics).not.toMatch(/DTSTART:[0-9T]+Z/);
    expect(ics).not.toMatch(/DTEND:[0-9T]+Z/);
  });

  it("tar med URL när den finns", () => {
    const ics = buildEventsCalendarIcs("The Lab", [
      { ...bas, timeStr: "17:00", url: "https://usha.se/event/x" },
    ]);
    expect(ics).toContain("URL:https://usha.se/event/x");
  });

  it("heldagspost när tid saknas helt", () => {
    const ics = buildEventsCalendarIcs("The Lab", [bas]);
    expect(ics).toContain("DTSTART;VALUE=DATE:20260921");
  });
});
