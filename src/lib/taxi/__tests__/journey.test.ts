import { describe, it, expect } from "vitest";
import { volunteerJourney, nextCheckIn, shiftToCheckInNow, type JourneyInput, type BookedShift } from "../journey";

// 26 nov 2026: Stockholm = UTC+1. Pass 17–19 = 16:00–18:00 UTC.
const shift: BookedShift = {
  signupId: "s1",
  starts_at: "2026-11-26T16:00:00.000Z",
  ends_at: "2026-11-26T18:00:00.000Z",
  checked_in_at: null,
};
const base: JourneyInput = {
  loggedIn: true,
  eligibility: "ok",
  blocked: false,
  roleStatuses: [undefined],
  booked: [],
  hasOpenShifts: true,
  now: new Date("2026-11-26T10:00:00.000Z"),
};
const states = (i: JourneyInput) => volunteerJourney(i).steps.map((s) => s.state);

describe("volontärens väg", () => {
  it("utloggad: skapa konto först", () => {
    const j = volunteerJourney({ ...base, loggedIn: false });
    expect(j.next.kind).toBe("account");
    expect(states({ ...base, loggedIn: false })).toEqual(["todo", "todo", "todo"]);
  });

  it("utan BankID: verifiera före ansökan", () => {
    expect(volunteerJourney({ ...base, eligibility: "bankid" }).next.kind).toBe("bankid");
    expect(volunteerJourney({ ...base, eligibility: "bankidAgain" }).next.kind).toBe("bankid");
    expect(volunteerJourney({ ...base, eligibility: "age" }).next.kind).toBe("age");
  });

  it("inte ansökt: ansök, steg 1 pågår", () => {
    expect(volunteerJourney(base).next.kind).toBe("apply");
    expect(states(base)).toEqual(["current", "todo", "todo"]);
  });

  it("ansökan skickad: väntar", () => {
    expect(volunteerJourney({ ...base, roleStatuses: ["pending"] }).next.kind).toBe("waiting");
  });

  it("alla roller nekade", () => {
    expect(volunteerJourney({ ...base, roleStatuses: ["declined", "declined"] }).next.kind).toBe("declined");
    expect(volunteerJourney({ ...base, roleStatuses: ["declined", undefined] }).next.kind).toBe("apply");
  });

  it("godkänd utan pass (Nadia 26 nov): välj pass, steg 2 pågår", () => {
    const i = { ...base, roleStatuses: ["approved" as const] };
    expect(volunteerJourney(i).next.kind).toBe("choose");
    expect(states(i)).toEqual(["done", "current", "todo"]);
  });

  it("godkänd men inga lediga pass", () => {
    expect(volunteerJourney({ ...base, roleStatuses: ["approved"], hasOpenShifts: false }).next.kind).toBe("noOpen");
  });

  it("avstängd: inget att boka", () => {
    expect(volunteerJourney({ ...base, roleStatuses: ["approved"], blocked: true }).next.kind).toBe("blocked");
  });

  it("bokat, före fönstret: säger när incheckningen öppnar", () => {
    const j = volunteerJourney({ ...base, roleStatuses: ["approved"], booked: [shift] });
    expect(j.next).toEqual({ kind: "checkInLater", shift, opensAt: "2026-11-26T15:00:00.000Z" });
    expect(j.steps.map((s) => s.state)).toEqual(["done", "done", "current"]);
  });

  it("i fönstret (Sammy 26 nov): stora knappen, även en timme före", () => {
    for (const t of ["2026-11-26T15:00:00.000Z", "2026-11-26T17:59:00.000Z"]) {
      const j = volunteerJourney({ ...base, roleStatuses: ["approved"], booked: [shift], now: new Date(t) });
      expect(j.next).toEqual({ kind: "checkInNow", shift });
    }
  });

  it("checka in går före BankID-kravet", () => {
    const j = volunteerJourney({ ...base, eligibility: "bankidAgain", booked: [shift], now: new Date("2026-11-26T16:10:00.000Z") });
    expect(j.next.kind).toBe("checkInNow");
  });

  it("incheckad: klart, alla steg gjorda", () => {
    const i = { ...base, roleStatuses: ["approved" as const], booked: [{ ...shift, checked_in_at: "2026-11-26T16:05:00.000Z" }], now: new Date("2026-11-26T16:30:00.000Z") };
    expect(volunteerJourney(i).next.kind).toBe("done");
    expect(states(i)).toEqual(["done", "done", "done"]);
  });

  it("passet slut utan incheckning: missat", () => {
    const j = volunteerJourney({ ...base, roleStatuses: ["approved"], booked: [shift], now: new Date("2026-11-26T19:00:00.000Z") });
    expect(j.next.kind).toBe("missed");
  });

  it("missat första passet men nästa kommer: visa nästa", () => {
    const late: BookedShift = { signupId: "s2", starts_at: "2026-11-26T20:00:00.000Z", ends_at: "2026-11-26T22:00:00.000Z", checked_in_at: null };
    const j = volunteerJourney({ ...base, roleStatuses: ["approved"], booked: [late, shift], now: new Date("2026-11-26T18:30:00.000Z") });
    expect(j.next.kind).toBe("checkInLater");
  });
});

describe("incheckningshjälp", () => {
  it("väljer tidigaste öppna pass", () => {
    const b: BookedShift = { ...shift, signupId: "s2", starts_at: "2026-11-26T17:00:00.000Z", ends_at: "2026-11-26T19:00:00.000Z" };
    expect(shiftToCheckInNow([b, shift], new Date("2026-11-26T16:45:00.000Z"))?.signupId).toBe("s1");
  });
  it("inget kommande när allt passerat", () => {
    expect(nextCheckIn([shift], new Date("2026-11-26T15:31:00.000Z"))).toBeNull();
  });
});
