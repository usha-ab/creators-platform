import { describe, it, expect } from "vitest";
import {
  validateShift, overlaps, taxiEveningFull, cancelDeadline, isLateCancel, isStrike, strikeStatus, canCheckIn, dancerEligibility, type SignupFacts,
} from "../rules";

const shift = { starts_at: "2026-11-12T19:00:00+01:00", ends_at: "2026-11-12T21:00:00+01:00" };

describe("validateShift", () => {
  const base = { eventDate: "2026-11-12", capacity: 4 };
  it("godkänner två timmar inom 17–23", () => {
    const r = validateShift({ ...base, startTime: "17:00", endTime: "19:00" });
    expect(r).toEqual({ ok: true, startsAt: "2026-11-12T17:00:00+01:00", endsAt: "2026-11-12T19:00:00+01:00" });
  });
  it("vägrar kortare än två timmar", () => {
    expect(validateShift({ ...base, startTime: "19:00", endTime: "20:30" })).toEqual({ ok: false, error: "length" });
  });
  it("vägrar utanför 17–23", () => {
    expect(validateShift({ ...base, startTime: "16:30", endTime: "19:00" })).toEqual({ ok: false, error: "window" });
    expect(validateShift({ ...base, startTime: "21:30", endTime: "23:30" })).toEqual({ ok: false, error: "window" });
  });
  it("vägrar sluttid före start och konstiga tider", () => {
    expect(validateShift({ ...base, startTime: "21:00", endTime: "19:00" })).toEqual({ ok: false, error: "length" });
    expect(validateShift({ ...base, startTime: "7pm", endTime: "21:00" })).toEqual({ ok: false, error: "time" });
  });
  it("vägrar noll platser", () => {
    expect(validateShift({ ...base, capacity: 0, startTime: "17:00", endTime: "19:00" })).toEqual({ ok: false, error: "capacity" });
  });
  it("räknar sommartid rätt", () => {
    const r = validateShift({ ...base, eventDate: "2026-06-11", startTime: "17:00", endTime: "19:00" });
    expect(r.ok && r.startsAt).toBe("2026-06-11T17:00:00+02:00");
  });
});

describe("avbokning", () => {
  it("fristen är kl. 10 samma dag i Stockholm", () => {
    expect(cancelDeadline("2026-11-12")).toBe("2026-11-12T10:00:00+01:00");
  });
  it("09.59 samma dag är i tid, 10.00 är sent", () => {
    expect(isLateCancel("2026-11-12", new Date("2026-11-12T08:59:00Z"))).toBe(false);
    expect(isLateCancel("2026-11-12", new Date("2026-11-12T09:00:00Z"))).toBe(true);
  });
  it("bokat efter kl. 10: fritt fram till två timmar före passet", () => {
    // Bokat 11.35, pass 19–21 (Stockholm). Avbokat 13.54 → ingen varning.
    const signup = { created_at: "2026-11-12T10:35:00Z", starts_at: "2026-11-12T19:00:00+01:00" };
    expect(isLateCancel("2026-11-12", new Date("2026-11-12T12:54:00Z"), signup)).toBe(false);
    expect(isLateCancel("2026-11-12", new Date("2026-11-12T15:59:00Z"), signup)).toBe(false);
    expect(isLateCancel("2026-11-12", new Date("2026-11-12T16:00:00Z"), signup)).toBe(true);
  });
  it("bokat före kl. 10: gränsen är fortfarande kl. 10", () => {
    const signup = { created_at: "2026-11-11T20:00:00Z", starts_at: "2026-11-12T19:00:00+01:00" };
    expect(isLateCancel("2026-11-12", new Date("2026-11-12T09:30:00Z"), signup)).toBe(true);
  });
});

/** Ett uteblivet pass som slutade vid tiden t. */
const noShow = (t: string): SignupFacts => ({ status: "booked", late_cancel: false, cancelled_at: null, checked_in_at: null, ends_at: t });
const lateCancel = (t: string): SignupFacts => ({ status: "cancelled", late_cancel: true, cancelled_at: t, checked_in_at: null, ends_at: t });

describe("varningar", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  it("uteblivet pass och sen avbokning ger varning, i tid avbokat och incheckat gör det inte", () => {
    expect(isStrike(noShow(shift.ends_at), now)).toBe(true);
    expect(isStrike({ ...noShow(shift.ends_at), checked_in_at: shift.starts_at }, now)).toBe(false);
    expect(isStrike(lateCancel("2026-11-12T11:00:00Z"), now)).toBe(true);
    expect(isStrike({ ...lateCancel("2026-11-11T11:00:00Z"), late_cancel: false }, now)).toBe(false);
  });
  it("ett pass som inte är slut än är ingen varning", () => {
    expect(isStrike(noShow(shift.ends_at), new Date("2026-11-12T19:30:00Z"))).toBe(false);
  });
  it("två varningar räknas men stänger inte av", () => {
    const st = strikeStatus([noShow("2026-09-01T20:00:00Z"), lateCancel("2026-10-01T10:00:00Z")], now);
    expect(st).toEqual({ active: 2, suspendedUntil: null });
  });
  it("tre inom sex månader ger sex månaders avstängning från den tredje", () => {
    const st = strikeStatus(
      [noShow("2026-06-01T20:00:00Z"), noShow("2026-09-01T20:00:00Z"), lateCancel("2026-11-12T10:30:00Z")],
      now,
    );
    expect(st.suspendedUntil).toBe("2027-05-12T10:30:00.000Z");
  });
  it("tre varningar utspridda över mer än sex månader stänger inte av, och gamla räknas inte", () => {
    const st = strikeStatus(
      [noShow("2026-01-10T20:00:00Z"), noShow("2026-06-01T20:00:00Z"), noShow("2026-09-01T20:00:00Z")],
      now,
    );
    expect(st).toEqual({ active: 2, suspendedUntil: null });
  });
  it("efter avstängningen är räknaren noll", () => {
    const strikes = [noShow("2026-01-01T20:00:00Z"), noShow("2026-02-01T20:00:00Z"), noShow("2026-03-01T20:00:00Z")];
    expect(strikeStatus(strikes, new Date("2026-08-01T12:00:00Z")).suspendedUntil).toBe("2026-09-01T20:00:00.000Z");
    expect(strikeStatus(strikes, new Date("2026-09-02T12:00:00Z"))).toEqual({ active: 0, suspendedUntil: null });
    // En ny varning efter avstängningen börjar om på ett.
    expect(strikeStatus([...strikes, noShow("2026-10-01T20:00:00Z")], new Date("2026-10-02T12:00:00Z"))).toEqual({
      active: 1,
      suspendedUntil: null,
    });
  });
});

describe("incheckning", () => {
  it("öppnar en timme före och stänger vid passets slut", () => {
    expect(canCheckIn(shift, new Date("2026-11-12T16:59:00Z"))).toBe(false);
    expect(canCheckIn(shift, new Date("2026-11-12T17:00:00Z"))).toBe(true);
    expect(canCheckIn(shift, new Date("2026-11-12T20:01:00Z"))).toBe(false);
  });
});

describe("dancerEligibility", () => {
  const verified = { bankid_verified_at: "2026-10-01T10:00:00Z" };
  it("kräver Mobilt BankID", () => {
    expect(dancerEligibility({ bankid_verified_at: null, bankid_birth_date: null }, "2026-11-12")).toBe("bankid");
  });
  it("verifierad utan födelsedatum får verifiera igen", () => {
    expect(dancerEligibility({ ...verified, bankid_birth_date: null }, "2026-11-12")).toBe("bankidAgain");
  });
  it("18 år räknas på kvällens datum", () => {
    expect(dancerEligibility({ ...verified, bankid_birth_date: "2008-11-12" }, "2026-11-12")).toBe("ok");
    expect(dancerEligibility({ ...verified, bankid_birth_date: "2008-11-13" }, "2026-11-12")).toBe("age");
  });
});

describe("taxitak och överlapp", () => {
  const base = { eventDate: "2026-11-12", startTime: "17:00", endTime: "19:00" };
  it("högst två platser på ett taxipass, andra roller har inget sådant tak", () => {
    expect(validateShift({ ...base, role: "taxi_dancer", capacity: 2 }).ok).toBe(true);
    expect(validateShift({ ...base, role: "taxi_dancer", capacity: 3 })).toEqual({ ok: false, error: "taxiCapacity" });
    expect(validateShift({ ...base, role: "instructor", capacity: 3 }).ok).toBe(true);
  });
  it("högst fyra olika taxidansare per kväll, men den som redan är med får ta fler pass", () => {
    const fyra = new Set(["a", "b", "c", "d"]);
    expect(taxiEveningFull(fyra, "e")).toBe(true);
    expect(taxiEveningFull(fyra, "a")).toBe(false);
    expect(taxiEveningFull(new Set(["a", "b", "c"]), "e")).toBe(false);
  });
  it("pass som delar tid överlappar, pass som bara möts gör det inte", () => {
    const a = { starts_at: "2026-11-12T17:00:00+01:00", ends_at: "2026-11-12T19:00:00+01:00" };
    expect(overlaps(a, { starts_at: "2026-11-12T18:00:00+01:00", ends_at: "2026-11-12T20:00:00+01:00" })).toBe(true);
    expect(overlaps(a, { starts_at: "2026-11-12T19:00:00+01:00", ends_at: "2026-11-12T21:00:00+01:00" })).toBe(false);
  });
});
