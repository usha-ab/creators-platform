import { describe, it, expect } from "vitest";
import { entryCounts } from "../entry-counts";

const IN = "2026-11-26T17:30:00Z";

describe("entryCounts", () => {
  it("räknar enkelbiljetter", () => {
    const r = entryCounts(
      [
        { id: "a", status: "completed", guest_count: 1, checked_in_at: IN },
        { id: "b", status: "confirmed", guest_count: 1, checked_in_at: null },
      ],
      [],
      0
    );
    expect(r).toEqual({ sold: 2, checkedIn: 1, notArrived: 1, clips: 0 });
  });

  it("räknar ett sällskap per deltagare", () => {
    const r = entryCounts(
      [{ id: "m", status: "confirmed", guest_count: 3, checked_in_at: null }],
      [
        { booking_id: "m", checked_in_at: IN },
        { booking_id: "m", checked_in_at: null },
        { booking_id: "m", checked_in_at: IN },
      ],
      0
    );
    expect(r).toMatchObject({ sold: 3, checkedIn: 2, notArrived: 1 });
  });

  it("Swish-sällskap utan deltagarrader är inne som helhet", () => {
    const r = entryCounts([{ id: "s", status: "completed", guest_count: 4, checked_in_at: IN }], [], 0);
    expect(r).toMatchObject({ sold: 4, checkedIn: 4, notArrived: 0 });
  });

  it("räknar klipp som sålda och incheckade, aldrig som väntade", () => {
    const r = entryCounts([{ id: "a", status: "confirmed", guest_count: 1, checked_in_at: null }], [], 5);
    expect(r).toEqual({ sold: 6, checkedIn: 5, notArrived: 1, clips: 5 });
  });

  it("räknar inte vilande eller avbokade", () => {
    const r = entryCounts(
      [
        { id: "p", status: "pending", guest_count: 2, checked_in_at: null },
        { id: "c", status: "canceled", guest_count: 1, checked_in_at: null },
      ],
      [],
      0
    );
    expect(r).toEqual({ sold: 0, checkedIn: 0, notArrived: 0, clips: 0 });
  });
});
