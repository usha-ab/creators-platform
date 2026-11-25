import { describe, it, expect } from "vitest";
import { efterkopLage, efterkopOppet, EFTERKOP_FONSTER_TIMMAR } from "../late-purchase";
import { sessionLivslangdMinuter } from "../late-checkout";

/**
 * Efterköpsfönstret — samma för dörrens efterköp och gästens "Var du där?"
 * (beslut Pablo 2026-11-25, se evening.ts).
 *
 * Alla tider nedan är UTC. Öppnar när kvällen passerat för vanliga köp
 * (midnatt, eller sluttiden om kvällen går över midnatt) och stänger 24
 * timmar efter kvällens slut. Saknas sluttid räknas 23:59. The Lab torsdag
 * 15 oktober 2026 utan sluttid: passerar 00:00 svensk tid (22:00 UTC) och
 * stänger 23:59 den 16:e (21:59 UTC, sommartid UTC+2).
 */

const KVALL = "2026-10-15";

describe("efterkopLage", () => {
  it("är inte aktuellt medan kvällen pågår", () => {
    expect(efterkopLage(KVALL, new Date("2026-10-15T20:00:00Z")).kind).toBe("inte_aktuellt");
  });

  it("är inte aktuellt för en kväll som inte varit", () => {
    expect(efterkopLage("2026-10-22", new Date("2026-10-16T08:00:00Z")).kind).toBe("inte_aktuellt");
  });

  it("öppnar vid midnatt, när vanliga köp stänger", () => {
    expect(efterkopLage(KVALL, new Date("2026-10-15T21:59:00Z")).kind).toBe("inte_aktuellt"); // 23:59
    expect(efterkopLage(KVALL, new Date("2026-10-15T22:00:00Z")).kind).toBe("oppet"); // 00:00
  });

  it("är öppet på morgonen efter — Maries fall", () => {
    // Marie försökte betala 07:24 svensk tid den 16 oktober.
    expect(efterkopLage(KVALL, new Date("2026-10-16T05:24:00Z")).kind).toBe("oppet");
  });

  it("stänger 24 timmar efter kvällens slut (23:59 utan sluttid)", () => {
    expect(efterkopLage(KVALL, new Date("2026-10-16T21:58:00Z")).kind).toBe("oppet");
    expect(efterkopLage(KVALL, new Date("2026-10-16T21:59:00Z")).kind).toBe("stangt");
  });

  it("räknar från sluttiden när den finns", () => {
    const times = { event_time: "17:00", event_end_time: "23:00" };
    const lage = efterkopLage(KVALL, new Date("2026-10-16T08:00:00Z"), times);
    if (lage.kind !== "oppet") throw new Error("förväntade öppet");
    expect(lage.stangerVid.toISOString()).toBe("2026-10-16T21:00:00.000Z");
  });

  it("kväll över midnatt: öppnar vid sluttiden", () => {
    const times = { event_time: "22:00", event_end_time: "02:00" };
    expect(efterkopLage(KVALL, new Date("2026-10-15T23:30:00Z"), times).kind).toBe("inte_aktuellt"); // 01:30
    expect(efterkopLage(KVALL, new Date("2026-10-16T00:00:00Z"), times).kind).toBe("oppet"); // 02:00
  });

  it("är stängt för en kväll förra veckan", () => {
    expect(efterkopLage("2026-10-08", new Date("2026-10-16T08:00:00Z")).kind).toBe("stangt");
  });

  it("ger aldrig efterköp för en post utan datum", () => {
    expect(efterkopLage(null, new Date()).kind).toBe("inte_aktuellt");
    expect(efterkopLage(undefined, new Date()).kind).toBe("inte_aktuellt");
    expect(efterkopLage("", new Date()).kind).toBe("inte_aktuellt");
  });

  it("hanterar vintertid utan att tappa en timme", () => {
    // 5 november: svensk tid UTC+1, så 23:59 dagen efter är 22:59 UTC.
    const lage = efterkopLage("2026-11-05", new Date("2026-11-05T23:30:00Z"));
    expect(lage.kind).toBe("oppet");
    if (lage.kind !== "oppet") return;
    expect(lage.stangerVid.toISOString()).toBe("2026-11-06T22:59:00.000Z");
  });
});

describe("efterkopOppet", () => {
  it("är sann bara i det öppna läget", () => {
    expect(efterkopOppet(KVALL, new Date("2026-10-16T05:24:00Z"))).toBe(true);
    expect(efterkopOppet(KVALL, new Date("2026-10-15T20:00:00Z"))).toBe(false);
    expect(efterkopOppet(KVALL, new Date("2026-10-20T08:00:00Z"))).toBe(false);
  });
});

describe("fönstret", () => {
  it("är ett dygn", () => {
    expect(EFTERKOP_FONSTER_TIMMAR).toBe(24);
  });
});

/**
 * Sessionens livslängd.
 *
 * Första versionen av efterköpet bad Stripe om 15 minuter. Stripe accepterar
 * bara 30 minuter till 24 timmar, så koden hade fallerat i det ögonblick en
 * gäst faktiskt skulle betala — och felet var osynligt i både typkontroll och
 * bygge. Därför har gränsen egna test.
 */
describe("sessionLivslangdMinuter", () => {
  it("lyfter för korta värden till Stripes minimum", () => {
    expect(sessionLivslangdMinuter(15)).toBe(30);
    expect(sessionLivslangdMinuter(1)).toBe(30);
    expect(sessionLivslangdMinuter(0)).toBe(30);
    expect(sessionLivslangdMinuter(-5)).toBe(30);
  });

  it("låter rimliga värden passera", () => {
    expect(sessionLivslangdMinuter(30)).toBe(30);
    expect(sessionLivslangdMinuter(60)).toBe(60);
  });

  it("kapar vid ett dygn", () => {
    expect(sessionLivslangdMinuter(10_000)).toBe(1440);
  });

  it("faller tillbaka på minimum när inget anges", () => {
    expect(sessionLivslangdMinuter(undefined)).toBe(30);
    expect(sessionLivslangdMinuter(NaN)).toBe(30);
    expect(sessionLivslangdMinuter(Infinity)).toBe(30);
  });
});
