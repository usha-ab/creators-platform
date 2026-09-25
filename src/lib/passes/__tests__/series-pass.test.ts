import { describe, it, expect } from "vitest";
import { isPassBooking, passRemaining, passBookingFields, passSavings, passSeriesIds, redemptionSlice, pickOccurrence } from "../series-pass";

describe("klippkort på serie", () => {
  it("känner igen ett klippkort och räknar kvarvarande klipp", () => {
    expect(isPassBooking({ sessions_total: 5, sessions_redeemed: 2 })).toBe(true);
    expect(isPassBooking({ sessions_total: null, sessions_redeemed: null })).toBe(false);
    expect(passRemaining({ sessions_total: 5, sessions_redeemed: 2 })).toBe(3);
    expect(passRemaining({ sessions_total: 5, sessions_redeemed: 9 })).toBe(0);
  });

  it("ger bokningen klippkortsfält bara när kassan sålde ett kort", () => {
    expect(passBookingFields("5")).toEqual({ sessions_total: 5, sessions_redeemed: 0 });
    expect(passBookingFields("")).toEqual({});
    expect(passBookingFields(undefined)).toEqual({});
    expect(passBookingFields("0")).toEqual({});
  });

  it("delar kortets pris lika på tillfällena, inklusive avgift och avdrag", () => {
    expect(redemptionSlice({ amount_paid: 80000, platform_fee_amount: 8000, credit_applied_ore: 5000, sessions_total: 5 }))
      .toEqual({ amount_paid: 16000, platform_fee_amount: 1600, credit_applied_ore: 1000 });
    expect(redemptionSlice({ amount_paid: 1000, platform_fee_amount: null, sessions_total: 3 }))
      .toEqual({ amount_paid: 333, platform_fee_amount: null, credit_applied_ore: 0 });
  });

  const occ = (id: string, date: string) => ({ id, title: id, event_date: date, event_time: "17:00:00", event_location: null });

  it("hittar kvällens tillfälle i Stockholmstid och nästa kommande", () => {
    const list = [occ("a", "2026-09-14"), occ("b", "2026-09-21"), occ("c", "2026-09-07")];
    // Måndag 14 sep kl 22:00 svensk tid (20:00Z)
    const r = pickOccurrence(list, new Date("2026-09-14T20:00:00Z"));
    expect(r.today?.id).toBe("a");
    expect(r.next?.id).toBe("b");
  });

  it("räknar natten efter som samma kväll, och ingen kväll alls en tisdag", () => {
    const list = [occ("a", "2026-09-14"), occ("b", "2026-09-21")];
    // 00:30 svensk tid natten efter måndagen = 22:30Z söndag→måndag? Nej: 2026-09-14T22:30Z = 00:30 tisdag 15 sep.
    expect(pickOccurrence(list, new Date("2026-09-14T22:30:00Z")).today?.id).toBe("a");
    const tue = pickOccurrence(list, new Date("2026-09-15T18:00:00Z"));
    expect(tue.today).toBeNull();
    expect(tue.next?.id).toBe("b");
  });
});

describe("kort som gäller flera serier", () => {
  const MON = "97206f7c-156e-4c53-9b9a-188ba61eba0b";
  const THU = "c4a8fb90-d0ec-455f-be0d-269a00a2ea10";

  it("läser arrayen när den finns", () => {
    expect(passSeriesIds({ pass_series_ids: [MON, THU], pass_series_id: MON })).toEqual([MON, THU]);
  });

  it("faller tillbaka på den gamla kolumnen för äldre kort", () => {
    expect(passSeriesIds({ pass_series_ids: null, pass_series_id: MON })).toEqual([MON]);
    expect(passSeriesIds({ pass_series_id: MON })).toEqual([MON]);
  });

  it("ger tom lista för kort utan serie", () => {
    expect(passSeriesIds({ pass_series_ids: [], pass_series_id: null })).toEqual([]);
    expect(passSeriesIds(null)).toEqual([]);
  });

  it("dubblerar inte en serie som står i båda kolumnerna", () => {
    expect(passSeriesIds({ pass_series_ids: [MON, MON, THU], pass_series_id: MON })).toEqual([MON, THU]);
  });

  it("hittar kvällens tillfälle oavsett vilken serie det tillhör", () => {
    // Måndagen är passerad, torsdagen är i dag: kortet ska klippas på torsdagen.
    const occurrences = [
      { id: "mon", title: "Måndag", event_date: "2026-09-21", event_time: "17:00", event_location: null },
      { id: "thu", title: "Torsdag", event_date: "2026-09-24", event_time: "17:00", event_location: null },
    ];
    const { today, next } = pickOccurrence(occurrences, new Date("2026-09-24T19:00:00+02:00"));
    expect(today?.id).toBe("thu");
    expect(next).toBeNull();
  });
});

describe("rabatten på ett klippkort", () => {
  it("räknar procent mot kvällens ordinarie biljett", () => {
    // 1 400 kr för tio kvällar à 200 kr = 140 kr/kväll, 30 procent under.
    expect(passSavings({ price: 1400, sessionCount: 10 }, 200)).toEqual({ perSession: 140, percent: 30 });
    expect(passSavings({ price: 800, sessionCount: 5 }, 200)).toEqual({ perSession: 160, percent: 20 });
    expect(passSavings({ price: 1050, sessionCount: 10 }, 150)).toEqual({ perSession: 105, percent: 30 });
  });

  it("visar ingen rabatt när kortet inte är billigare", () => {
    expect(passSavings({ price: 1000, sessionCount: 5 }, 200)).toBeNull();
    expect(passSavings({ price: 1200, sessionCount: 5 }, 200)).toBeNull();
  });

  it("påstår ingenting när jämförpriset saknas", () => {
    expect(passSavings({ price: 800, sessionCount: 5 }, 0)).toBeNull();
    expect(passSavings({ price: 800, sessionCount: 5 }, null)).toBeNull();
  });

  it("delar aldrig med noll", () => {
    expect(passSavings({ price: 800, sessionCount: 0 }, 2000)).toEqual({ perSession: 800, percent: 60 });
  });
});
