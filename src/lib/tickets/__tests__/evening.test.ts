import { describe, it, expect } from "vitest";
import {
  checkinButtonMode,
  eventEndsAt,
  eveningIsOver,
  eveningPassesAt,
  eveningStartsAt,
  pickRegularOccurrence,
  pickWasThereOccurrence,
  selfCheckinWindow,
  wasThereEndsAt,
} from "../evening";

/**
 * Kvällens gränser (beslut Pablo 2026-11-25). Alla tider i förväntningarna är
 * UTC. 26 november är vintertid (UTC+1), 15 oktober sommartid (UTC+2).
 */

const LAB = { event_date: "2026-11-26", event_time: "17:00:00", event_end_time: "23:00:00" };
const NIGHT = { event_date: "2026-11-26", event_time: "22:00", event_end_time: "02:00" };
const NO_END = { event_date: "2026-11-26", event_time: "17:00" };
const u = (iso: string) => new Date(iso);

describe("eventEndsAt — kvällens slut", () => {
  it("är sluttiden", () => {
    expect(eventEndsAt(LAB)?.toISOString()).toBe("2026-11-26T22:00:00.000Z");
  });
  it("ligger på dagen efter när kvällen går över midnatt", () => {
    expect(eventEndsAt(NIGHT)?.toISOString()).toBe("2026-11-27T01:00:00.000Z");
  });
  it("är 23:59 när sluttid saknas", () => {
    expect(eventEndsAt(NO_END)?.toISOString()).toBe("2026-11-26T22:59:00.000Z");
  });
  it("är null utan datum (tjänster)", () => {
    expect(eventEndsAt({})).toBeNull();
  });
});

describe("eveningPassesAt / eveningIsOver — vanliga köp, som förut", () => {
  it("passerar vid midnatt för en kväll som slutar före midnatt", () => {
    expect(eveningPassesAt(LAB)?.toISOString()).toBe("2026-11-26T23:00:00.000Z");
    expect(eveningIsOver(LAB, u("2026-11-26T22:59:00Z"))).toBe(false); // 23:59
    expect(eveningIsOver(LAB, u("2026-11-26T23:00:00Z"))).toBe(true); // 00:00
  });
  it("passerar vid sluttiden när kvällen pågår efter midnatt", () => {
    expect(eveningIsOver(NIGHT, u("2026-11-27T00:59:00Z"))).toBe(false); // 01:59
    expect(eveningIsOver(NIGHT, u("2026-11-27T01:00:00Z"))).toBe(true); // 02:00
  });
  it("sommartid: midnatt svensk tid är 22:00 UTC", () => {
    const oct = { event_date: "2026-10-15", event_time: "17:00" };
    expect(eveningIsOver(oct, u("2026-10-15T21:59:00Z"))).toBe(false);
    expect(eveningIsOver(oct, u("2026-10-15T22:00:00Z"))).toBe(true);
  });
  it("passerar aldrig utan datum", () => {
    expect(eveningIsOver({}, u("2030-01-01T00:00:00Z"))).toBe(false);
  });
});

describe("wasThereEndsAt — 24 timmar efter kvällens slut", () => {
  it("räknas från sluttiden", () => {
    expect(wasThereEndsAt(LAB)?.toISOString()).toBe("2026-11-27T22:00:00.000Z");
    expect(wasThereEndsAt(NIGHT)?.toISOString()).toBe("2026-11-28T01:00:00.000Z");
  });
  it("räknas från 23:59 utan sluttid", () => {
    expect(wasThereEndsAt(NO_END)?.toISOString()).toBe("2026-11-27T22:59:00.000Z");
  });
});

describe("eveningStartsAt", () => {
  it("datum + starttid i svensk tid", () => {
    expect(eveningStartsAt(LAB)?.toISOString()).toBe("2026-11-26T16:00:00.000Z");
  });
});

describe("checkinButtonMode", () => {
  it("före start − 30 min: before", () => {
    expect(checkinButtonMode(u("2026-11-26T15:29:00Z"), LAB)).toBe("before");
  });
  it("från start − 30 min till midnatt: Checka in", () => {
    expect(checkinButtonMode(u("2026-11-26T15:30:00Z"), LAB)).toBe("checkin");
    expect(checkinButtonMode(u("2026-11-26T22:59:00Z"), LAB)).toBe("checkin"); // 23:59, efter sluttiden
  });
  it("från midnatt och 24 timmar efter sluttiden: Var du där?", () => {
    expect(checkinButtonMode(u("2026-11-26T23:00:00Z"), LAB)).toBe("wasThere"); // 00:00
    expect(checkinButtonMode(u("2026-11-27T21:59:00Z"), LAB)).toBe("wasThere"); // 22:59 dagen efter
  });
  it("stänger exakt 24 timmar efter sluttiden", () => {
    expect(checkinButtonMode(u("2026-11-27T22:00:00Z"), LAB)).toBe("closed"); // 23:00 dagen efter
  });
  it("kväll efter midnatt: Checka in till sluttiden, sedan Var du där? i 24 timmar", () => {
    expect(checkinButtonMode(u("2026-11-26T23:30:00Z"), NIGHT)).toBe("checkin"); // 00:30
    expect(checkinButtonMode(u("2026-11-27T01:00:00Z"), NIGHT)).toBe("wasThere"); // 02:00
    expect(checkinButtonMode(u("2026-11-28T00:59:00Z"), NIGHT)).toBe("wasThere"); // 01:59 dagen efter
    expect(checkinButtonMode(u("2026-11-28T01:00:00Z"), NIGHT)).toBe("closed");
  });
  it("utan sluttid: Var du där? till 23:59 dagen efter", () => {
    expect(checkinButtonMode(u("2026-11-27T22:58:00Z"), NO_END)).toBe("wasThere");
    expect(checkinButtonMode(u("2026-11-27T22:59:00Z"), NO_END)).toBe("closed");
  });
  it("utan datum: none", () => {
    expect(checkinButtonMode(new Date(), {})).toBe("none");
  });
});

describe("selfCheckinWindow", () => {
  it("följer knappen: öppet bara i Checka in-läget", () => {
    expect(selfCheckinWindow(LAB, u("2026-11-26T15:29:00Z")).state).toBe("before");
    expect(selfCheckinWindow(LAB, u("2026-11-26T15:30:00Z")).state).toBe("open");
    expect(selfCheckinWindow(LAB, u("2026-11-26T23:00:00Z")).state).toBe("closed");
  });
  it("säger när den öppnar", () => {
    const w = selfCheckinWindow(LAB, u("2026-11-26T12:00:00Z"));
    if (w.state !== "before") throw new Error("förväntade before");
    expect(w.opensAt.toISOString()).toBe("2026-11-26T15:30:00.000Z");
  });
});

/**
 * Pablos villkor: köpen till kommande kvällar får inte störas. Två kvällar
 * tätt (dagliga evenemang): den passerade ligger i efterköpsfönstret, nästa
 * är dagen efter. Köp ska gå till nästa, "Var du där?" till den passerade.
 */
describe("köp och efterköp med två kvällar tätt", () => {
  const yesterday = { id: "y", event_date: "2026-11-26", event_time: "17:00", event_end_time: "23:00" };
  const tonight = { id: "t", event_date: "2026-11-27", event_time: "17:00", event_end_time: "23:00" };
  const nextWeek = { id: "n", event_date: "2026-12-03", event_time: "17:00", event_end_time: "23:00" };
  const all = [yesterday, tonight, nextWeek];

  it("på förmiddagen dagen efter: köp → nästa kväll, Var du där? → den passerade", () => {
    const now = u("2026-11-27T09:00:00Z"); // 10:00
    expect(pickRegularOccurrence(all, now)?.id).toBe("t");
    expect(pickWasThereOccurrence(all, now)?.id).toBe("y");
  });

  it("strax efter midnatt: samma sak", () => {
    const now = u("2026-11-26T23:05:00Z"); // 00:05
    expect(pickRegularOccurrence(all, now)?.id).toBe("t");
    expect(pickWasThereOccurrence(all, now)?.id).toBe("y");
  });

  it("under kvällen själv: köp och Checka in gäller kvällen, ingen efterköpskväll", () => {
    const now = u("2026-11-26T19:00:00Z"); // 20:00 den 26:e
    expect(pickRegularOccurrence(all, now)?.id).toBe("y");
    expect(pickWasThereOccurrence(all, now)).toBeNull();
  });

  it("ett dygn senare har efterköpet flyttat till kvällen som just passerat", () => {
    const now = u("2026-11-27T23:30:00Z"); // 00:30 den 28:e
    expect(pickWasThereOccurrence(all, now)?.id).toBe("t");
    expect(pickRegularOccurrence(all, now)?.id).toBe("n");
  });

  it("efter fönstret: ingen efterköpskväll", () => {
    expect(pickWasThereOccurrence([yesterday], u("2026-11-27T22:00:00Z"))).toBeNull();
  });
});
