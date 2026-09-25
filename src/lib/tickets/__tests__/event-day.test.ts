import { describe, it, expect } from "vitest";
import { isEventDay, stockholmDay } from "../event-day";

describe("isEventDay", () => {
  it("godkänner biljetten på eventdagen, svensk tid", () => {
    expect(isEventDay("2026-09-07", new Date("2026-09-07T15:00:00Z"))).toBe(true);
  });

  it("nekar en biljett för en annan dag — den 21:a på kvällen den 7:e", () => {
    expect(isEventDay("2026-09-21", new Date("2026-09-07T18:37:22Z"))).toBe(false);
  });

  // 22:30 UTC den 7:e är 00:30 den 8:e i Stockholm. Biljetten för den 7:e
  // ska hålla — kvällen pågår, bara UTC-dygnet har bytt.
  it("räknar Stockholm, inte UTC, runt midnatt", () => {
    expect(stockholmDay(new Date("2026-09-07T22:30:00Z"))).toBe("2026-09-08");
    expect(isEventDay("2026-09-07", new Date("2026-09-07T22:30:00Z"))).toBe(true);
  });

  it("släpper inte in gårdagens biljett efter kl. 04", () => {
    expect(isEventDay("2026-09-07", new Date("2026-09-08T03:30:00Z"))).toBe(false); // 05:30 sv tid
  });

  it("släpper igenom när eventet saknar datum", () => {
    expect(isEventDay(null)).toBe(true);
  });
});
