import { describe, it, expect } from "vitest";
import { getSaleState, type SaleInput, isPastEvent } from "../sale-state";

// Annas konfiguration: förköp 11 juli 11:00 → 14 juli 11:00 (Stockholm, UTC+2),
// publikt släpp 10 aug. Ord. pris 333, förköp 222.
const EB_START = "2026-07-11T09:00:00.000Z";
const EB_END = "2026-07-14T09:00:00.000Z";
const PUB = "2026-08-10T09:00:00.000Z";
const base: SaleInput = {
  price: 333,
  early_bird_start: EB_START,
  early_bird_end: EB_END,
  early_bird_price: 222,
  public_sale_at: PUB,
};
const at = (iso: string) => new Date(iso);

describe("getSaleState — ingen automatisering", () => {
  it("är köpbart till ord. pris", () => {
    const r = getSaleState({ price: 333 }, at("2026-07-01T00:00:00Z"));
    expect(r).toMatchObject({ state: "on_sale", buyable: true, price: 333 });
  });
});

describe("getSaleState — Annas funnel", () => {
  it("FAS 1 (före förköp): ej köpbart, visar förköpspris + öppningstid", () => {
    const r = getSaleState(base, at("2026-07-01T12:00:00Z"));
    expect(r.state).toBe("before");
    expect(r.buyable).toBe(false);
    expect(r.price).toBe(222);
    expect(r.until?.toISOString()).toBe(EB_START);
  });

  it("exakt vid förköpsstart: köpbart förköpspris", () => {
    const r = getSaleState(base, at(EB_START));
    expect(r).toMatchObject({ state: "early_bird", buyable: true, price: 222 });
  });

  it("mitt i 72h-fönstret: köpbart förköpspris", () => {
    const r = getSaleState(base, at("2026-07-12T20:00:00Z"));
    expect(r).toMatchObject({ state: "early_bird", buyable: true, price: 222 });
    expect(r.until?.toISOString()).toBe(EB_END);
  });

  it("en sekund före slut: fortfarande förköp", () => {
    const r = getSaleState(base, at("2026-07-14T08:59:59.000Z"));
    expect(r).toMatchObject({ state: "early_bird", buyable: true });
  });

  it("FAS 3 (exakt vid slut): ej köpbart, släpps senare (before), släpps-datum satt", () => {
    const r = getSaleState(base, at(EB_END));
    expect(r.state).toBe("before");
    expect(r.buyable).toBe(false);
    expect(r.until?.toISOString()).toBe(PUB);
  });

  it("FAS 3 (i gapet): inte slutsålt, utan 'släpps senare' (before)", () => {
    const r = getSaleState(base, at("2026-07-20T00:00:00Z"));
    expect(r).toMatchObject({ state: "before", buyable: false });
  });

  it("FAS 4 (vid publikt släpp): köpbart ord. pris", () => {
    const r = getSaleState(base, at(PUB));
    expect(r).toMatchObject({ state: "on_sale", buyable: true, price: 333 });
  });

  it("FAS 4 (efter släpp): köpbart ord. pris", () => {
    const r = getSaleState(base, at("2026-08-15T00:00:00Z"));
    expect(r).toMatchObject({ state: "on_sale", buyable: true, price: 333 });
  });
});

describe("getSaleState — kapacitet", () => {
  it("slutsålt när tickets_sold >= capacity, även mitt i förköpet", () => {
    const r = getSaleState({ ...base, capacity: 50, tickets_sold: 50 }, at("2026-07-12T00:00:00Z"));
    expect(r).toMatchObject({ state: "sold_out", buyable: false });
  });
  it("köpbart när det finns platser kvar", () => {
    const r = getSaleState({ ...base, capacity: 50, tickets_sold: 49 }, at("2026-07-12T00:00:00Z"));
    expect(r.buyable).toBe(true);
  });
});

describe("getSaleState — bara publikt släpp", () => {
  const pubOnly: SaleInput = { price: 333, public_sale_at: PUB };
  it("före släpp: ej köpbart", () => {
    expect(getSaleState(pubOnly, at("2026-08-01T00:00:00Z"))).toMatchObject({ state: "before", buyable: false });
  });
  it("vid/efter släpp: köpbart", () => {
    expect(getSaleState(pubOnly, at(PUB)).buyable).toBe(true);
  });
});

describe("getSaleState — defensivt", () => {
  it("ignorerar ofullständigt förköpsfönster (bara start)", () => {
    const r = getSaleState({ price: 333, early_bird_start: EB_START }, at("2026-07-01T00:00:00Z"));
    expect(r).toMatchObject({ state: "on_sale", buyable: true });
  });
});

describe("getSaleState — passerade event", () => {
  it("är inte köpbart dagen efter eventet", () => {
    const r = getSaleState({ price: 333, event_date: "2026-06-08" }, at("2026-06-09T08:00:00Z"));
    expect(r.state).toBe("past");
    expect(r.buyable).toBe(false);
  });

  it("är fortfarande köpbart under eventdagen, även sent på kvällen", () => {
    // 21:30 UTC = 23:30 svensk sommartid, alltså före midnatt.
    const r = getSaleState({ price: 333, event_date: "2026-06-08" }, at("2026-06-08T21:30:00Z"));
    expect(r.state).toBe("on_sale");
    expect(r.buyable).toBe(true);
  });

  it("stänger vid midnatt svensk tid, inte vid UTC-midnatt", () => {
    // 22:30 UTC 8 juni = 00:30 svensk tid 9 juni → passerat.
    const r = getSaleState({ price: 333, event_date: "2026-06-08" }, at("2026-06-08T22:30:00Z"));
    expect(r.state).toBe("past");
  });

  it("slår förköpsfönstret — ett passerat event säljs aldrig", () => {
    const r = getSaleState({ ...base, event_date: "2026-07-12" }, at("2026-07-13T09:00:00Z"));
    expect(r.state).toBe("past");
    expect(r.buyable).toBe(false);
  });

  it("rör inte tjänster utan datum", () => {
    const r = getSaleState({ price: 333 }, at("2030-01-01T00:00:00Z"));
    expect(r.state).toBe("on_sale");
    expect(r.buyable).toBe(true);
  });
});

/**
 * isPastEvent — samma gräns som getSaleState, nu exporterad för ytor som bara
 * har ett datum att gå på (rekommendationskorten). Regeln får finnas på ett
 * enda ställe, annars räknar en yta förr eller senare annorlunda än dörren.
 */
describe("isPastEvent", () => {
  it("är falsk under hela eventdagen, även sent på kvällen", () => {
    // 23:30 svensk tid på eventdagen — kvällen pågår.
    expect(isPastEvent("2026-10-15", new Date("2026-10-15T21:30:00Z"))).toBe(false);
  });

  it("är sann efter midnatt svensk tid", () => {
    // 00:30 den 16:e svensk tid = 22:30 UTC den 15:e (CEST, UTC+2).
    expect(isPastEvent("2026-10-15", new Date("2026-10-15T22:30:00Z"))).toBe(true);
  });

  it("är falsk för datumlösa poster, till exempel tjänster", () => {
    expect(isPastEvent(null, new Date("2030-01-01T00:00:00Z"))).toBe(false);
    expect(isPastEvent(undefined, new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });

  it("är falsk för en kommande kväll", () => {
    expect(isPastEvent("2026-12-24", new Date("2026-10-15T12:00:00Z"))).toBe(false);
  });

  it("säger samma sak som getSaleState", () => {
    const now = new Date("2026-10-16T10:00:00Z");
    const past = getSaleState({ price: 100, event_date: "2026-10-15" }, now);
    expect(past.state).toBe("past");
    expect(isPastEvent("2026-10-15", now)).toBe(true);
  });
});

/**
 * Kvällsgränsen bor i lib/tickets/evening.ts (beslut Pablo 2026-11-25).
 * Vanliga köp fungerar som förut — midnatt — utom för kvällar som pågår efter
 * midnatt, där sluttiden gäller. Den passerade kvällen säljs bara via
 * efterköpet ("Var du där?"), aldrig via sale-state.
 */
describe("getSaleState — kvällar över midnatt", () => {
  const night = { price: 333, event_date: "2026-06-08", event_time: "22:00", event_end_time: "02:00" };
  it("är köpbart efter midnatt medan kvällen pågår", () => {
    expect(getSaleState(night, at("2026-06-08T23:30:00Z")).state).toBe("on_sale"); // 01:30
  });
  it("passerar vid sluttiden", () => {
    expect(getSaleState(night, at("2026-06-09T00:00:00Z")).state).toBe("past"); // 02:00
  });
  it("en sluttid före midnatt stänger inte köpet tidigare än förut", () => {
    const lab = { price: 333, event_date: "2026-06-08", event_time: "17:00", event_end_time: "22:00" };
    expect(getSaleState(lab, at("2026-06-08T21:30:00Z")).state).toBe("on_sale"); // 23:30
    expect(getSaleState(lab, at("2026-06-08T22:00:00Z")).state).toBe("past"); // 00:00
  });
  it("isPastEvent tar hänsyn till sluttiden när den skickas med", () => {
    const now = new Date("2026-06-08T23:30:00Z");
    expect(isPastEvent("2026-06-08", now)).toBe(true);
    expect(isPastEvent("2026-06-08", now, { event_time: "22:00", event_end_time: "02:00" })).toBe(false);
  });
});
