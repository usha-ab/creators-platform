import { describe, it, expect, vi } from "vitest";
import { fakeAdmin, tKey } from "./fake-db";

// Klippkortsvägen hämtar seriens kvällar; i testet styr vi vilken som är "i dag".
const occ = vi.hoisted(() => ({ list: [] as { id: string; title: string; event_date: string; event_time: string | null; event_location: string | null }[] }));
vi.mock("@/lib/passes/series-pass", async (orig) => {
  const real = await orig<typeof import("@/lib/passes/series-pass")>();
  return { ...real, seriesOccurrences: async () => occ.list };
});

import { checkInAttendees, checkInBooking, checkInSeriesPass, isPaidBooking, type CheckinBooking } from "../checkin";

const NOW = new Date("2026-11-26T18:00:00Z");

function booking(over: Partial<CheckinBooking> = {}): CheckinBooking {
  return {
    id: "b1",
    status: "confirmed",
    creator_id: "host",
    checked_in_at: null,
    listing_id: "l1",
    guest_count: 1,
    sessions_total: null,
    sessions_redeemed: 0,
    amount_paid: 15000,
    platform_fee_amount: 0,
    credit_applied_ore: 0,
    payment_method: null,
    refunded_at: null,
    listings: { title: "The Lab" },
    ...over,
  };
}

describe("isPaidBooking", () => {
  it("släpper in bekräftade och avslutade bokningar", () => {
    expect(isPaidBooking({ status: "confirmed" })).toBe(true);
    expect(isPaidBooking({ status: "completed" })).toBe(true);
  });
  it("släpper aldrig in en vilande bokning — varken Stripe eller Swish", () => {
    expect(isPaidBooking({ status: "pending" })).toBe(false);
  });
  it("släpper inte in avbokade eller återbetalda", () => {
    expect(isPaidBooking({ status: "canceled" })).toBe(false);
    expect(isPaidBooking({ status: "confirmed", refunded_at: "2026-11-20T10:00:00Z" })).toBe(false);
  });
});

describe("checkInBooking (en biljett)", () => {
  it("checkar in och markerar bokningen avslutad", async () => {
    const row = { ...booking(), scanned_by: null };
    const admin = fakeAdmin({ tables: { bookings: [row] } });
    const r = await checkInBooking({ admin: admin as never, booking: booking(), actorId: "door", t: tKey, now: NOW });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, title: "The Lab", checkedInAt: NOW.toISOString() });
    expect(row).toMatchObject({ status: "completed", checked_in_at: NOW.toISOString(), scanned_by: "door" });
  });

  it("skriver scanned_by som null när gästen checkar in själv", async () => {
    const row = { ...booking(), scanned_by: "x" };
    const admin = fakeAdmin({ tables: { bookings: [row] } });
    await checkInBooking({ admin: admin as never, booking: booking(), actorId: null, t: tKey, now: NOW });
    expect(row.scanned_by).toBeNull();
  });

  it("säger redan incheckad", async () => {
    const b = booking({ checked_in_at: "2026-11-26T17:40:00Z" });
    const r = await checkInBooking({ admin: fakeAdmin({ tables: { bookings: [{ ...b }] } }) as never, booking: b, actorId: "door", t: tKey });
    expect(r.body).toMatchObject({ success: false, alreadyCheckedIn: true, checkedInAt: "2026-11-26T17:40:00Z" });
  });

  it("vägrar en vilande bokning med samma text som förut", async () => {
    const b = booking({ status: "pending", payment_method: "swish" });
    const r = await checkInBooking({ admin: fakeAdmin({ tables: { bookings: [{ ...b }] } }) as never, booking: b, actorId: "door", t: tKey });
    expect(r.body).toEqual({ success: false, error: "notConfirmedYet", status: "pending" });
  });

  it("vägrar en avbokad bokning", async () => {
    const b = booking({ status: "canceled" });
    const r = await checkInBooking({ admin: fakeAdmin({ tables: { bookings: [{ ...b }] } }) as never, booking: b, actorId: "door", t: tKey });
    expect(r.body).toEqual({ success: false, error: "bookingCanceled", status: "canceled" });
  });

  it("tappar inte bort att någon hann före (två telefoner samtidigt)", async () => {
    const b = booking();
    // Raden i databasen är redan incheckad, men bokningen som lästes var det inte.
    const admin = fakeAdmin({ tables: { bookings: [{ ...b, checked_in_at: "2026-11-26T17:59:59Z" }] } });
    const r = await checkInBooking({ admin: admin as never, booking: b, actorId: "door", t: tKey, now: NOW });
    expect(r.body).toMatchObject({ success: false, alreadyCheckedIn: true });
  });
});

describe("checkInAttendees (flerbiljett)", () => {
  const multi = () => booking({ guest_count: 3 });
  const attendees = () => [
    { id: "a1", booking_id: "b1", idx: 1, name: "Ana", checked_in_at: null, scanned_by: null },
    { id: "a2", booking_id: "b1", idx: 2, name: null, checked_in_at: null, scanned_by: null },
    { id: "a3", booking_id: "b1", idx: 3, name: "Leo", checked_in_at: null, scanned_by: null },
  ];

  it("FELET: en vilande bokning går inte att checka in i flerbiljettsvägen", async () => {
    const rows = attendees();
    const b = booking({ guest_count: 3, status: "pending" });
    const admin = fakeAdmin({ tables: { bookings: [{ ...b }], ticket_attendees: rows } });
    const r = await checkInAttendees({ admin: admin as never, booking: b, attendeeIds: ["a1"], actorId: "door", t: tKey });
    expect(r.body).toEqual({ success: false, error: "notConfirmedYet", status: "pending" });
    expect(rows.every((a) => a.checked_in_at === null)).toBe(true);
  });

  it("vägrar fortfarande en avbokad bokning", async () => {
    const b = booking({ guest_count: 3, status: "canceled" });
    const admin = fakeAdmin({ tables: { bookings: [{ ...b }], ticket_attendees: attendees() } });
    const r = await checkInAttendees({ admin: admin as never, booking: b, attendeeIds: ["a1"], actorId: "door", t: tKey });
    expect(r.body).toMatchObject({ success: false, error: "bookingCanceled", status: "canceled" });
  });

  it("checkar in en deltagare i dörren, som förut", async () => {
    const rows = attendees();
    const bk = { ...multi() };
    const admin = fakeAdmin({ tables: { bookings: [bk], ticket_attendees: rows } });
    const r = await checkInAttendees({ admin: admin as never, booking: multi(), attendeeIds: ["a2"], actorId: "door", t: tKey, now: NOW });
    expect(r.body).toMatchObject({ success: true, title: "The Lab", attendeeLabel: "guestLabel", checkedInAt: NOW.toISOString() });
    expect(rows[1]).toMatchObject({ checked_in_at: NOW.toISOString(), scanned_by: "door" });
    expect(bk.status).toBe("confirmed");
  });

  it("ger 404 för en deltagare som inte hör till bokningen", async () => {
    const admin = fakeAdmin({ tables: { bookings: [{ ...multi() }], ticket_attendees: attendees() } });
    const r = await checkInAttendees({ admin: admin as never, booking: multi(), attendeeIds: ["zz"], actorId: "door", t: tKey });
    expect(r.status).toBe(404);
  });

  it("delval: gästen checkar in två av tre, bokningen är inte klar", async () => {
    const rows = attendees();
    const bk = { ...multi() };
    const admin = fakeAdmin({ tables: { bookings: [bk], ticket_attendees: rows } });
    const r = await checkInAttendees({ admin: admin as never, booking: multi(), attendeeIds: ["a1", "a3"], actorId: null, t: tKey, now: NOW });
    expect(r.body.success).toBe(true);
    expect((r.body.attendees as { result: string }[]).map((a) => a.result)).toEqual(["checked_in", "checked_in"]);
    expect(rows.map((a) => !!a.checked_in_at)).toEqual([true, false, true]);
    expect(bk.status).toBe("confirmed");
  });

  it("markerar bokningen avslutad när den sista är inne", async () => {
    const rows = attendees();
    rows[0].checked_in_at = "2026-11-26T17:30:00Z" as never;
    const bk = { ...multi() };
    const admin = fakeAdmin({ tables: { bookings: [bk], ticket_attendees: rows } });
    await checkInAttendees({ admin: admin as never, booking: multi(), attendeeIds: ["a2", "a3"], actorId: null, t: tKey, now: NOW });
    expect(bk).toMatchObject({ status: "completed", checked_in_at: NOW.toISOString() });
  });

  it("delvis incheckad (completed av annan väg) får checka in resten", async () => {
    const b = booking({ guest_count: 3, status: "completed" });
    const admin = fakeAdmin({ tables: { bookings: [{ ...b }], ticket_attendees: attendees() } });
    const r = await checkInAttendees({ admin: admin as never, booking: b, attendeeIds: ["a1"], actorId: "door", t: tKey });
    expect(r.body.success).toBe(true);
  });

  it("säger redan incheckad om alla valda redan är inne", async () => {
    const rows = attendees();
    rows[0].checked_in_at = "2026-11-26T17:30:00Z" as never;
    const admin = fakeAdmin({ tables: { bookings: [{ ...multi() }], ticket_attendees: rows } });
    const r = await checkInAttendees({ admin: admin as never, booking: multi(), attendeeIds: ["a1"], actorId: "door", t: tKey });
    expect(r.body).toMatchObject({ success: false, alreadyCheckedIn: true, checkedInAt: "2026-11-26T17:30:00Z", attendeeLabel: "Ana" });
  });
});

describe("checkInSeriesPass (klippkort)", () => {
  const pass = () =>
    booking({ id: "p1", listing_id: "card", sessions_total: 10, sessions_redeemed: 2, amount_paid: 100000, pass_expires_at: "2027-06-01T00:00:00Z" });
  const tables = () => ({
    bookings: [{ ...pass() }],
    listings: [{ id: "card", title: "Klippkort", pass_series_id: "s1", pass_series_ids: ["s1"] }],
    pass_redemptions: [] as Record<string, unknown>[],
  });

  it("klipper kvällens tillfälle och fryser andelen", async () => {
    occ.list = [{ id: "tonight", title: "The Lab 26/11", event_date: "2026-11-26", event_time: "17:00:00", event_location: null }];
    const tb = tables();
    const admin = fakeAdmin({ tables: tb, unique: { pass_redemptions: [["booking_id", "listing_id", "is_manual"]] } });
    const r = await checkInSeriesPass({ admin: admin as never, booking: pass(), actorId: null, t: tKey, now: NOW });
    expect(r.body).toMatchObject({ success: true, title: "The Lab 26/11", passRemaining: 9, occurrenceId: "tonight" });
    expect(tb.pass_redemptions[0]).toMatchObject({ booking_id: "p1", listing_id: "tonight", scanned_by: null });
  });

  it("klipper aldrig två gånger samma kväll", async () => {
    occ.list = [{ id: "tonight", title: "The Lab", event_date: "2026-11-26", event_time: "17:00:00", event_location: null }];
    const tb = tables();
    const admin = fakeAdmin({ tables: tb, unique: { pass_redemptions: [["booking_id", "listing_id", "is_manual"]] } });
    await checkInSeriesPass({ admin: admin as never, booking: pass(), actorId: null, t: tKey, now: NOW });
    const again = await checkInSeriesPass({ admin: admin as never, booking: pass(), actorId: "door", t: tKey, now: NOW });
    expect(again.body).toMatchObject({ success: false, alreadyCheckedIn: true });
    expect(tb.pass_redemptions).toHaveLength(1);
  });

  it("låter grinden stoppa före allt annat (behörighet eller fönster)", async () => {
    occ.list = [{ id: "tonight", title: "The Lab", event_date: "2026-11-26", event_time: "17:00:00", event_location: null }];
    const tb = tables();
    const admin = fakeAdmin({ tables: tb });
    const r = await checkInSeriesPass({
      admin: admin as never,
      booking: booking({ ...pass(), status: "canceled" }),
      actorId: "x",
      t: tKey,
      now: NOW,
      gate: async () => ({ status: 403, body: { error: "noCheckinPermission" } }),
    });
    expect(r.status).toBe(403);
    expect(tb.pass_redemptions).toHaveLength(0);
  });

  it("vägrar utan kväll i dag", async () => {
    occ.list = [{ id: "next", title: "The Lab", event_date: "2026-12-03", event_time: "17:00:00", event_location: null }];
    const r = await checkInSeriesPass({ admin: fakeAdmin({ tables: tables() }) as never, booking: pass(), actorId: null, t: tKey, now: NOW });
    expect(r.body).toEqual({ success: false, error: "passNoEventToday" });
  });

  it("vägrar ett utgånget kort utan att skriva ett klipp", async () => {
    occ.list = [{ id: "tonight", title: "The Lab", event_date: "2026-11-26", event_time: "17:00:00", event_location: null }];
    const tb = tables();
    const r = await checkInSeriesPass({
      admin: fakeAdmin({ tables: tb }) as never,
      booking: booking({ ...pass(), pass_expires_at: "2026-11-01T00:00:00Z" }),
      actorId: null,
      t: tKey,
      now: NOW,
    });
    expect(r.body).toEqual({ success: false, error: "passExpired" });
    expect(tb.pass_redemptions).toHaveLength(0);
  });
});
