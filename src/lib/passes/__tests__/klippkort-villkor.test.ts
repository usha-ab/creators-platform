import { describe, it, expect } from "vitest";
import { withdrawalRefundOre } from "@/lib/bookings/withdrawal";
import { passEarlyStartFields } from "../series-pass";
import { CANCELED_EVENING_EXTENSION_DAYS, extendedExpiry, shouldExtend, extendPassesForCanceledEvening } from "../expiry-extension";
import { reminderDue } from "../expiry-reminders";

describe("avdrag för använda klipp vid ånger (2 kap. 15 § p. 3)", () => {
  const card = { amount_paid: 65000, sessions_total: 5, sessions_redeemed: 2 };

  it("utan begäran i kassan: hela beloppet tillbaka trots använda klipp", () => {
    expect(withdrawalRefundOre({ ...card, pass_early_start_requested_at: null })).toBe(65000);
  });

  it("med begäran: pris ÷ klipp × använda dras av", () => {
    expect(withdrawalRefundOre({ ...card, pass_early_start_requested_at: "2026-11-10T14:00:00Z" })).toBe(39000);
  });

  it("med begäran men inga klipp använda: hela beloppet", () => {
    expect(withdrawalRefundOre({ ...card, sessions_redeemed: 0, pass_early_start_requested_at: "x" })).toBe(65000);
  });

  it("alla klipp använda: noll, aldrig negativt", () => {
    expect(withdrawalRefundOre({ ...card, sessions_redeemed: 5, pass_early_start_requested_at: "x" })).toBe(0);
    expect(withdrawalRefundOre({ ...card, sessions_redeemed: 9, pass_early_start_requested_at: "x" })).toBe(0);
  });

  it("minutpaket räknas på minuter", () => {
    expect(
      withdrawalRefundOre({ amount_paid: 60000, minutes_total: 60, minutes_redeemed: 15, pass_early_start_requested_at: "x" })
    ).toBe(45000);
  });
});

describe("kryssrutan sparas bara som uttryckligt ja", () => {
  const at = new Date("2026-11-25T10:00:00Z");
  it("true på ett kort ger tidpunkten", () => {
    expect(passEarlyStartFields({ passEarlyStart: "true", sessionsTotal: "5" }, at)).toEqual({
      pass_early_start_requested_at: "2026-11-25T10:00:00.000Z",
    });
  });
  it("false, saknas eller ingen kortbokning ger ingenting", () => {
    expect(passEarlyStartFields({ passEarlyStart: "false", sessionsTotal: "5" }, at)).toEqual({});
    expect(passEarlyStartFields({ sessionsTotal: "5" }, at)).toEqual({});
    expect(passEarlyStartFields({ passEarlyStart: "true", sessionsTotal: "" }, at)).toEqual({});
    expect(passEarlyStartFields(null, at)).toEqual({});
  });
});

describe("förlängning när säljaren ställer in en kväll", () => {
  const card = {
    id: "b1",
    status: "confirmed",
    created_at: "2026-11-01T10:00:00Z",
    pass_expires_at: "2027-04-01T10:00:00Z",
    sessions_total: 5,
    sessions_redeemed: 1,
  };

  it("aktivt kort med klipp kvar, giltigt på kvällen, förlängs", () => {
    expect(shouldExtend(card, "2026-12-03")).toBe(true);
  });

  it("kvällen efter sista giltighetsdag, kort köpt efter kvällen, slutklippt eller avbokat: ingen förlängning", () => {
    expect(shouldExtend(card, "2027-04-08")).toBe(false);
    expect(shouldExtend({ ...card, created_at: "2026-12-10T10:00:00Z" }, "2026-12-03")).toBe(false);
    expect(shouldExtend({ ...card, sessions_redeemed: 5 }, "2026-12-03")).toBe(false);
    expect(shouldExtend({ ...card, status: "canceled" }, "2026-12-03")).toBe(false);
    expect(shouldExtend({ ...card, pass_expires_at: null }, "2026-12-03")).toBe(false);
  });

  it("en vecka per inställd kväll", () => {
    expect(CANCELED_EVENING_EXTENSION_DAYS).toBe(7);
    expect(extendedExpiry("2027-04-01T10:00:00.000Z")).toBe("2027-04-08T10:00:00.000Z");
  });

  it("förlänger varje kort en gång per kväll, även om kvällen avpubliceras igen", async () => {
    const ext: { booking_id: string; listing_id: string }[] = [];
    const bookings = [{ ...card }];
    const db = {
      from: (table: string) => {
        const q: Record<string, unknown> = {};
        const chain = () => q;
        Object.assign(q, {
          select: chain,
          eq: chain,
          in: chain,
          not: chain,
          or: chain,
          maybeSingle: async () => ({ data: { id: "kv1", series_id: "s1", event_date: "2026-12-03" } }),
          then: (res: (v: unknown) => unknown) =>
            res(table === "listings" ? { data: [{ id: "kort" }] } : { data: bookings }),
          insert: async (row: { booking_id: string; listing_id: string }) => {
            if (ext.some((e) => e.booking_id === row.booking_id && e.listing_id === row.listing_id)) {
              return { error: { code: "23505" } };
            }
            ext.push(row);
            return { error: null };
          },
          update: (patch: { pass_expires_at: string }) => ({
            eq: async () => {
              bookings[0].pass_expires_at = patch.pass_expires_at;
              return { error: null };
            },
          }),
        });
        return q;
      },
    } as never;
    const now = new Date("2026-11-25T10:00:00Z");
    expect(await extendPassesForCanceledEvening(db, "kv1", now)).toBe(1);
    expect(bookings[0].pass_expires_at).toBe("2027-04-08T10:00:00.000Z");
    expect(await extendPassesForCanceledEvening(db, "kv1", now)).toBe(0);
    expect(bookings[0].pass_expires_at).toBe("2027-04-08T10:00:00.000Z");
  });
});

describe("påminnelse före förfall", () => {
  const now = new Date("2026-11-25T07:00:00Z");
  const base = {
    created_at: "2026-06-01T10:00:00Z",
    sessions_total: 5,
    sessions_redeemed: 2,
    pass_expiry_reminded_30_at: null,
    pass_expiry_reminded_7_at: null,
  };
  const inDays = (d: number) => new Date(now.getTime() + d * 24 * 3600_000).toISOString();

  it("30 dagar kvar: 30-påminnelsen", () => {
    expect(reminderDue({ ...base, pass_expires_at: inDays(29) }, now)).toBe("30");
  });

  it("7 dagar kvar: 7-påminnelsen, även om 30 redan gått", () => {
    expect(reminderDue({ ...base, pass_expires_at: inDays(6), pass_expiry_reminded_30_at: "x" }, now)).toBe("7");
  });

  it("redan påmind, långt kvar, utgånget eller inga klipp kvar: ingenting", () => {
    expect(reminderDue({ ...base, pass_expires_at: inDays(29), pass_expiry_reminded_30_at: "x" }, now)).toBeNull();
    expect(reminderDue({ ...base, pass_expires_at: inDays(6), pass_expiry_reminded_7_at: "x" }, now)).toBeNull();
    expect(reminderDue({ ...base, pass_expires_at: inDays(45) }, now)).toBeNull();
    expect(reminderDue({ ...base, pass_expires_at: inDays(-1) }, now)).toBeNull();
    expect(reminderDue({ ...base, sessions_redeemed: 5, pass_expires_at: inDays(6) }, now)).toBeNull();
  });

  it("nyss köpt kort med kort giltighet får ingen 30-påminnelse dagen efter köpet", () => {
    expect(reminderDue({ ...base, created_at: inDays(-1), pass_expires_at: inDays(29) }, now)).toBeNull();
  });
});
