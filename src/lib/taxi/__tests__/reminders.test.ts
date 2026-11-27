import { describe, expect, it } from "vitest";
import {
  chooseShiftReminders,
  isCheckinReminderDue,
  isQuietHour,
  listingIdFromLink,
  sentKey,
  stockholmClock,
  type ChooseApproval,
  type ChooseEvening,
} from "../reminders";

// Torsdag 26 nov 2026, vintertid: Stockholm = UTC+1.
const at = (hhmm: string) => new Date(`2026-11-26T${hhmm}:00+01:00`);
const iso = (hhmm: string) => at(hhmm).toISOString();

describe("isCheckinReminderDue", () => {
  const shift = (start: string, end: string, extra: Partial<Parameters<typeof isCheckinReminderDue>[0]> = {}) => ({
    status: "booked",
    checked_in_at: null,
    checkin_reminded_at: null,
    starts_at: iso(start),
    ends_at: iso(end),
    ...extra,
  });

  it("går när incheckningen öppnar, en timme före (Sammy 17–19)", () => {
    expect(isCheckinReminderDue(shift("17:00", "19:00"), at("16:00"))).toBe(true);
  });

  it("körningen varje kvart: 15:45 för tidigt, 16:00 i tid", () => {
    expect(isCheckinReminderDue(shift("17:00", "19:00"), at("15:45"))).toBe(false);
    expect(isCheckinReminderDue(shift("17:00", "19:00"), at("16:00"))).toBe(true);
  });

  it("tål att servern kör ett par minuter före", () => {
    expect(isCheckinReminderDue(shift("17:00", "19:00"), at("15:57"))).toBe(true);
  });

  it("pass på kvart: 19:15 påminns 18:15", () => {
    expect(isCheckinReminderDue(shift("19:15", "21:15"), at("18:00"))).toBe(false);
    expect(isCheckinReminderDue(shift("19:15", "21:15"), at("18:15"))).toBe(true);
  });

  it("fångar ett pass som redan börjat om körningen missats, men inte för sent", () => {
    expect(isCheckinReminderDue(shift("17:00", "19:00"), at("17:30"))).toBe(true);
    expect(isCheckinReminderDue(shift("17:00", "19:00"), at("18:15"))).toBe(false);
  });

  it("inga dubbletter: redan påmind, incheckad eller avbokad", () => {
    expect(isCheckinReminderDue(shift("17:00", "19:00", { checkin_reminded_at: iso("16:30") }), at("16:45"))).toBe(false);
    expect(isCheckinReminderDue(shift("17:00", "19:00", { checked_in_at: iso("16:40") }), at("16:45"))).toBe(false);
    expect(isCheckinReminderDue(shift("17:00", "19:00", { status: "cancelled" }), at("16:45"))).toBe(false);
  });

  it("starttiden i notisen är svensk tid", () => {
    expect(stockholmClock(iso("17:00"))).toBe("17:00");
  });
});

describe("isQuietHour", () => {
  it("tyst 22–08 svensk tid", () => {
    expect(isQuietHour(at("22:00"))).toBe(true);
    expect(isQuietHour(at("03:00"))).toBe(true);
    expect(isQuietHour(at("07:59"))).toBe(true);
    expect(isQuietHour(at("08:00"))).toBe(false);
    expect(isQuietHour(at("10:00"))).toBe(false);
    expect(isQuietHour(at("21:59"))).toBe(false);
  });
});

describe("listingIdFromLink", () => {
  it("läser kvällen ur länken, med eller utan ankare", () => {
    expect(listingIdFromLink("/app/taxi/abc#valj-pass")).toBe("abc");
    expect(listingIdFromLink("/app/taxi/abc")).toBe("abc");
    expect(listingIdFromLink("/app/events/abc")).toBeNull();
    expect(listingIdFromLink(null)).toBeNull();
  });
});

describe("chooseShiftReminders", () => {
  const evening = (over: Partial<ChooseEvening> = {}): ChooseEvening => ({
    id: "lab-26",
    title: "The Lab",
    event_date: "2026-11-26",
    series_id: "lab",
    user_id: "host",
    shifts: [
      { id: "s1", role: "taxi_dancer", starts_at: iso("17:00"), capacity: 2, booked: 0 },
      { id: "s2", role: "taxi_dancer", starts_at: iso("19:00"), capacity: 2, booked: 0 },
      { id: "d1", role: "door_host", starts_at: iso("19:00"), capacity: 1, booked: 0 },
    ],
    ...over,
  });
  const approved = (who: string, role = "taxi_dancer", decided = "2026-11-20T12:00:00Z"): ChooseApproval => ({
    volunteer_id: who,
    scope_key: "series:lab",
    role,
    status: "approved",
    decided_at: decided,
  });
  const base = {
    evenings: [evening()],
    approvals: [approved("nadia")],
    signups: [] as { shift_id: string; dancer_id: string }[],
    alreadySent: new Set<string>(),
    today: "2026-11-26",
    now: at("10:00"),
  };

  it("godkänd utan pass får en notis kl. 10 (Nadia)", () => {
    expect(chooseShiftReminders(base)).toEqual([
      { userId: "nadia", listingId: "lab-26", title: "The Lab", scopeKey: "series:lab" },
    ]);
  });

  it("den som redan bokat ett pass får ingen", () => {
    expect(chooseShiftReminders({ ...base, signups: [{ shift_id: "s1", dancer_id: "nadia" }] })).toEqual([]);
  });

  it("aldrig mer än en per kväll och volontär", () => {
    expect(chooseShiftReminders({ ...base, alreadySent: new Set([sentKey("nadia", "lab-26")]) })).toEqual([]);
  });

  it("en annan kväll räknas för sig", () => {
    expect(chooseShiftReminders({ ...base, alreadySent: new Set([sentKey("nadia", "lab-19")]) })).toHaveLength(1);
  });

  it("bara dagens kväll", () => {
    expect(chooseShiftReminders({ ...base, evenings: [evening({ event_date: "2026-11-27" })] })).toEqual([]);
  });

  it("väntande eller nekad ansökan får ingen", () => {
    expect(chooseShiftReminders({ ...base, approvals: [{ ...approved("nadia"), status: "pending" }] })).toEqual([]);
    expect(chooseShiftReminders({ ...base, approvals: [{ ...approved("nadia"), status: "declined" }] })).toEqual([]);
  });

  it("godkänd i en annan serie får ingen", () => {
    expect(chooseShiftReminders({ ...base, approvals: [{ ...approved("nadia"), scope_key: "series:annan" }] })).toEqual([]);
  });

  it("arrangörens egna kvällar utan serie: avgränsningen är arrangören", () => {
    const e = evening({ series_id: null });
    expect(chooseShiftReminders({ ...base, evenings: [e], approvals: [{ ...approved("nadia"), scope_key: "host:host" }] })).toHaveLength(1);
  });

  it("inga lediga pass i rollen: fulla eller redan börjat", () => {
    const full = evening({
      shifts: [
        { id: "s1", role: "taxi_dancer", starts_at: iso("17:00"), capacity: 2, booked: 2 },
        { id: "s2", role: "taxi_dancer", starts_at: iso("09:00"), capacity: 2, booked: 0 },
        { id: "d1", role: "door_host", starts_at: iso("19:00"), capacity: 1, booked: 0 },
      ],
    });
    expect(chooseShiftReminders({ ...base, evenings: [full] })).toEqual([]);
    // Dörrvärden har fortfarande ett ledigt pass.
    expect(chooseShiftReminders({ ...base, evenings: [full], approvals: [approved("nadia", "door_host")] })).toHaveLength(1);
  });

  it("kvällens taxitak nått: inga taxidansarpass kvar för nya", () => {
    const signups = ["a", "b", "c", "d"].map((d, i) => ({ shift_id: i < 2 ? "s1" : "s2", dancer_id: d }));
    expect(chooseShiftReminders({ ...base, signups })).toEqual([]);
  });

  it("nyss godkänd har just fått godkännandenotisen", () => {
    expect(chooseShiftReminders({ ...base, approvals: [approved("nadia", "taxi_dancer", iso("09:00"))] })).toEqual([]);
    expect(chooseShiftReminders({ ...base, approvals: [approved("nadia", "taxi_dancer", iso("06:30"))] })).toHaveLength(1);
  });

  it("två godkända roller ger ändå en notis", () => {
    expect(chooseShiftReminders({ ...base, approvals: [approved("nadia"), approved("nadia", "door_host")] })).toHaveLength(1);
  });

  it("aldrig på natten", () => {
    expect(chooseShiftReminders({ ...base, now: at("07:00") })).toEqual([]);
  });
});
