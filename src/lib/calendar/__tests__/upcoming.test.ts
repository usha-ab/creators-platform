import { describe, it, expect } from "vitest";
import { groupUpcoming, bucketFor, hasEnoughSupply, weekdayOf, type CalendarListing } from "../upcoming";

function l(over: Partial<CalendarListing> & { id: string; event_date: string }): CalendarListing {
  return {
    user_id: null, slug: null, series_id: null, series_slug: null, title: over.id,
    event_time: "19:00:00", event_end_time: null, event_location: null,
    event_city: null, event_venue: null, image_url: null, price: 100,
    ...over,
  };
}

const TODAY = "2026-09-08"; // tisdag

describe("groupUpcoming", () => {
  it("visar en serie som en rad med nästa datum och antal tillfällen", () => {
    const rows = [
      l({ id: "a", event_date: "2026-09-14", series_id: "s", series_slug: "the-lab", title: "The Lab" }),
      l({ id: "b", event_date: "2026-09-21", series_id: "s", series_slug: "the-lab", title: "The Lab" }),
      l({ id: "c", event_date: "2026-09-28", series_id: "s", series_slug: "the-lab", title: "The Lab" }),
    ];
    const entries = groupUpcoming(rows, TODAY);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ date: "2026-09-14", occurrences: 3, href: "/event/the-lab", recurringWeekday: 1 });
  });

  it("markerar inte veckodag när tillfällena hoppar mellan dagar", () => {
    const rows = [
      l({ id: "a", event_date: "2026-09-14", series_id: "s", series_slug: "x" }),
      l({ id: "b", event_date: "2026-09-19", series_id: "s", series_slug: "x" }),
    ];
    expect(groupUpcoming(rows, TODAY)[0].recurringWeekday).toBeNull();
  });

  it("släpper passerade tillfällen och sorterar på nästa datum", () => {
    const rows = [
      l({ id: "gammal", event_date: "2026-09-01" }),
      l({ id: "sen", event_date: "2026-10-01" }),
      l({ id: "snart", event_date: "2026-09-09", slug: "snart-slug" }),
    ];
    const entries = groupUpcoming(rows, TODAY);
    expect(entries.map((e) => e.key)).toEqual(["snart", "sen"]);
    expect(entries[0].href).toBe("/event/snart-slug");
    expect(entries[1].href).toBe("/event/sen");
  });

  it("räknar en serie vars första kväll redan passerat från nästa kommande", () => {
    const rows = [
      l({ id: "a", event_date: "2026-09-07", series_id: "s", series_slug: "x" }),
      l({ id: "b", event_date: "2026-09-14", series_id: "s", series_slug: "x" }),
    ];
    const [e] = groupUpcoming(rows, TODAY);
    expect(e.date).toBe("2026-09-14");
    expect(e.occurrences).toBe(1);
  });

  it("föredrar lokalens namn som plats", () => {
    const [e] = groupUpcoming([l({ id: "a", event_date: "2026-09-09", event_venue: "Bacchi", event_location: "Gata 1", event_city: "Stockholm" })], TODAY);
    expect(e.location).toBe("Bacchi");
  });
});

describe("bucketFor (måndag som veckostart, tisdag 8 sep som i dag)", () => {
  it.each([
    ["2026-09-08", "today"],
    ["2026-09-13", "thisWeek"], // söndag samma vecka
    ["2026-09-14", "nextWeek"], // måndag
    ["2026-09-20", "nextWeek"],
    ["2026-09-21", "later"],
  ])("%s → %s", (date, bucket) => {
    expect(bucketFor(date, TODAY)).toBe(bucket);
  });
});

describe("hasEnoughSupply", () => {
  it("kräver minst tröskeln och aldrig mindre än en", () => {
    expect(hasEnoughSupply(1, 5)).toBe(false);
    expect(hasEnoughSupply(5, 5)).toBe(true);
    expect(hasEnoughSupply(0, 0)).toBe(false);
    expect(hasEnoughSupply(1, 0)).toBe(true);
  });
});

it("weekdayOf är tidszonsoberoende", () => {
  expect(weekdayOf("2026-09-14")).toBe(1);
  expect(weekdayOf("2026-09-13")).toBe(0);
});
