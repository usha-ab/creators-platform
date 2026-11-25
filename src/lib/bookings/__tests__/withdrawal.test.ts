import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isUndatedPurchase,
  refundDueAt,
  refundMethodFor,
  sameEmail,
  withdrawalClosesAt,
  withdrawalLastDay,
  withdrawalRefundOre,
  withdrawalState,
} from "../withdrawal";

const refund = vi.fn();
const receipt = vi.fn();
const sellerNotice = vi.fn();
const supportCase = vi.fn();
const notify = vi.fn();
vi.mock("@/lib/tickets/refund", () => ({ refundBookingCharge: (...a: unknown[]) => refund(...a) }));
vi.mock("@/lib/affiliate/rewards", () => ({ voidRewardsForBooking: async () => {} }));
vi.mock("@/lib/notifications/create", () => ({ createNotification: (...a: unknown[]) => notify(...a) }));
vi.mock("@/lib/email/send-withdrawal", () => ({
  sendWithdrawalReceipt: (...a: unknown[]) => receipt(...a),
  sendWithdrawalSellerNotice: (...a: unknown[]) => sellerNotice(...a),
  sendWithdrawalSupportCase: (...a: unknown[]) => supportCase(...a),
}));

const { withdrawPurchase } = await import("../withdraw");

// Köpt 2026-11-10 kl. 15 svensk tid.
const BOUGHT = "2026-11-10T14:00:00Z";
const pass = {
  status: "confirmed",
  created_at: BOUGHT,
  amount_paid: 65000,
  sessions_total: 5,
  minutes_total: null,
  is_free: false,
};

describe("ångerfristen", () => {
  it("sista dagen är köpdagen + 14, räknat i svensk tid", () => {
    expect(withdrawalLastDay(new Date(BOUGHT))).toBe("2026-11-24");
    // 23:30 UTC den 10:e är redan den 11:e i Stockholm.
    expect(withdrawalLastDay(new Date("2026-11-10T23:30:00Z"))).toBe("2026-11-25");
  });

  it("stänger vid midnatt svensk tid efter sista dagen", () => {
    expect(withdrawalClosesAt(new Date(BOUGHT)).toISOString()).toBe("2026-11-24T23:00:00.000Z");
  });

  it("pengarna ska vara tillbaka senast 14 dagar efter meddelandet", () => {
    expect(refundDueAt(new Date("2026-11-20T10:00:00Z")).toISOString()).toBe("2026-12-04T10:00:00.000Z");
  });
});

describe("withdrawalState", () => {
  it("klippkort inom fristen kan ångras", () => {
    expect(withdrawalState(pass, new Date("2026-11-24T22:59:00Z"))).toEqual({ kind: "open", lastDay: "2026-11-24" });
  });

  it("klippkort efter fristen kan inte ångras", () => {
    expect(withdrawalState(pass, new Date("2026-11-24T23:00:00Z"))).toEqual({ kind: "expired", lastDay: "2026-11-24" });
  });

  it("använda klipp hindrar inte ånger (inget avdrag utan begäran, 15 § p. 3)", () => {
    expect(withdrawalState({ ...pass, status: "completed" }, new Date("2026-11-12T10:00:00Z")).kind).toBe("open");
  });

  it("minutpaket räknas som köp utan datum", () => {
    const pkg = { ...pass, sessions_total: null, minutes_total: 60 };
    expect(isUndatedPurchase(pkg)).toBe(true);
    expect(withdrawalState(pkg, new Date("2026-11-12T10:00:00Z")).kind).toBe("open");
  });

  it("biljett till ett bestämt datum har ingen ångerrätt men ska få besked", () => {
    const ticket = { ...pass, sessions_total: null };
    expect(withdrawalState(ticket, new Date("2026-11-12T10:00:00Z"))).toEqual({ kind: "fixedDate" });
  });

  it("gratis, obetalt, väntande Swish och avbokat ger inget att ångra", () => {
    const at = new Date("2026-11-12T10:00:00Z");
    expect(withdrawalState({ ...pass, is_free: true }, at).kind).toBe("none");
    expect(withdrawalState({ ...pass, amount_paid: 0 }, at).kind).toBe("none");
    expect(withdrawalState({ ...pass, status: "pending" }, at).kind).toBe("none");
    expect(withdrawalState({ ...pass, status: "canceled" }, at).kind).toBe("none");
  });
});

describe("belopp och sätt", () => {
  it("hela beloppet tillbaka, serviceavgiften ingår", () => {
    expect(withdrawalRefundOre({ amount_paid: 65000 })).toBe(65000);
    expect(withdrawalRefundOre({ amount_paid: null })).toBe(0);
  });

  it("kort via Stripe, Swish och Epassi för hand", () => {
    expect(refundMethodFor({ stripe_payment_id: "pi_1" })).toBe("stripe");
    expect(refundMethodFor({ stripe_payment_id: null })).toBe("manual");
  });

  it("e-post jämförs utan versaler och mellanslag", () => {
    expect(sameEmail(" Anna@Example.se ", "anna@example.se")).toBe(true);
    expect(sameEmail("anna@example.se", "bo@example.se")).toBe(false);
    expect(sameEmail(null, "a@b.se")).toBe(false);
  });
});

// ── withdrawPurchase mot en databas i minnet ──────────────────────────────

type Row = Record<string, unknown>;

function fakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = { booking_withdrawals: [], ...seed };
  let nextId = 1;
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: [string, unknown][] = [];
    const match = () => rows.filter((r) => filters.every(([k, v]) => r[k] === v));
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => {
        filters.push([k, v]);
        return q;
      },
      maybeSingle: async () => ({ data: match()[0] ?? null, error: null }),
      single: async () => ({ data: match()[0] ?? null, error: null }),
      insert: (row: Row) => {
        if (table === "booking_withdrawals" && rows.some((r) => r.booking_id === row.booking_id)) {
          return { select: () => ({ single: async () => ({ data: null, error: { code: "23505" } }) }) };
        }
        const withId = { id: `w${nextId++}`, ...row };
        rows.push(withId);
        return { select: () => ({ single: async () => ({ data: withId, error: null }) }) };
      },
      update: (patch: Row) => ({
        eq: async (k: string, v: unknown) => {
          for (const r of rows) if (r[k] === v) Object.assign(r, patch);
          return { error: null };
        },
      }),
    };
    return q;
  };
  return {
    tables,
    client: { from, rpc: async () => ({ error: null }) } as never,
  };
}

function seed(overrides: Row = {}) {
  return fakeDb({
    bookings: [
      {
        id: "11111111-2222-3333-4444-555555555555",
        ...pass,
        stripe_payment_id: "pi_1",
        payment_method: null,
        guest_email: "anna@example.se",
        guest_name: "Anna",
        customer_id: null,
        creator_id: "seller",
        listing_id: "l1",
        booking_type: "ticket",
        guest_count: 1,
        ticket_type_id: null,
        ...overrides,
      },
    ],
    listings: [{ id: "l1", title: "The Lab 5-kort" }],
    profiles: [{ id: "seller", email: "joy@example.se", full_name: "Joy" }],
  });
}

const ID = "11111111-2222-3333-4444-555555555555";
const NOW = new Date("2026-11-12T10:00:00Z");

describe("withdrawPurchase", () => {
  beforeEach(() => {
    for (const f of [refund, receipt, sellerNotice, supportCase, notify]) f.mockReset();
    refund.mockResolvedValue({ refundId: "re_1", amount: 65000 });
    receipt.mockResolvedValue(true);
    sellerNotice.mockResolvedValue(true);
    supportCase.mockResolvedValue(true);
    notify.mockResolvedValue(undefined);
  });

  it("kortköp: återbetalar via Stripe, avslutar kortet, skickar bevis och säger till säljaren", async () => {
    const db = seed();
    const r = await withdrawPurchase(db.client, { bookingId: ID, name: "Anna", email: "ANNA@example.se", now: NOW });
    expect(r).toMatchObject({ ok: true, refundMethod: "stripe", refundOre: 65000, alreadyWithdrawn: false });
    expect(refund).toHaveBeenCalledWith("pi_1");
    expect(db.tables.bookings[0]).toMatchObject({ status: "canceled", refund_amount: 65000, stripe_refund_id: "re_1" });
    const w = db.tables.booking_withdrawals[0];
    expect(w).toMatchObject({ booking_id: ID, refund_method: "stripe", stripe_refund_id: "re_1" });
    expect(w.receipt_sent_at).toBeTruthy();
    expect(w.seller_notified_at).toBeTruthy();
    expect(receipt).toHaveBeenCalledWith(expect.objectContaining({ to: "anna@example.se", bookingCode: "USH-11111111" }));
    expect(sellerNotice).toHaveBeenCalledWith(expect.objectContaining({ to: "joy@example.se", buyerName: "Anna" }));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: "seller", titleKey: "withdrawalTitle" }));
    expect(supportCase).not.toHaveBeenCalled();
  });

  it("ett andra klick ger samma svar och inga nya pengar", async () => {
    const db = seed();
    await withdrawPurchase(db.client, { bookingId: ID, name: "Anna", email: "anna@example.se", now: NOW });
    const again = await withdrawPurchase(db.client, { bookingId: ID, name: "Anna", email: "anna@example.se", now: NOW });
    expect(again).toMatchObject({ ok: true, alreadyWithdrawn: true });
    expect(refund).toHaveBeenCalledTimes(1);
    expect(receipt).toHaveBeenCalledTimes(1);
  });

  it("Swish: inget Stripe-anrop, ett ärende till supporten med sista dag", async () => {
    const db = seed({ stripe_payment_id: null, payment_method: "swish" });
    const r = await withdrawPurchase(db.client, { bookingId: ID, name: "Anna", email: "anna@example.se", now: NOW });
    expect(r).toMatchObject({ ok: true, refundMethod: "manual" });
    expect(refund).not.toHaveBeenCalled();
    expect(db.tables.bookings[0].status).toBe("canceled");
    expect(supportCase).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "manual", paymentMethodLabel: "Swish", refundOre: 65000 })
    );
    expect((supportCase.mock.calls[0][0] as { refundDueAt: Date }).refundDueAt.toISOString()).toBe("2026-11-26T10:00:00.000Z");
  });

  it("Stripe nere: ångern står fast och blir ett ärende", async () => {
    refund.mockRejectedValue(new Error("stripe nere"));
    const db = seed();
    const r = await withdrawPurchase(db.client, { bookingId: ID, name: "Anna", email: "anna@example.se", now: NOW });
    expect(r).toMatchObject({ ok: true, refundMethod: "manual" });
    expect(db.tables.bookings[0].status).toBe("canceled");
    expect(db.tables.booking_withdrawals[0].refund_error).toBe("stripe nere");
    expect(supportCase).toHaveBeenCalledWith(expect.objectContaining({ reason: "stripeFailed" }));
  });

  it("fel e-post: inget ångras", async () => {
    const db = seed();
    const r = await withdrawPurchase(db.client, { bookingId: ID, name: "Anna", email: "nagon@annan.se", now: NOW });
    expect(r).toEqual({ ok: false, error: "emailMismatch" });
    expect(db.tables.booking_withdrawals).toHaveLength(0);
    expect(refund).not.toHaveBeenCalled();
  });

  it("biljett med datum och kort efter fristen nekas", async () => {
    expect(
      await withdrawPurchase(seed({ sessions_total: null }).client, { bookingId: ID, name: "A", email: "anna@example.se", now: NOW })
    ).toEqual({ ok: false, error: "fixedDate" });
    expect(
      await withdrawPurchase(seed().client, {
        bookingId: ID,
        name: "A",
        email: "anna@example.se",
        now: new Date("2026-11-30T10:00:00Z"),
      })
    ).toEqual({ ok: false, error: "expired" });
  });

  it("namn krävs", async () => {
    expect(await withdrawPurchase(seed().client, { bookingId: ID, name: "  ", email: "anna@example.se", now: NOW })).toEqual({
      ok: false,
      error: "nameMissing",
    });
  });
});
