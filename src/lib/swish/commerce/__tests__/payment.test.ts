import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const sendEmail = vi.fn(async (..._a: unknown[]) => {});
const notify = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/lib/email/send-booking", () => ({ sendBookingConfirmationEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock("@/lib/notifications/create", () => ({ createNotification: (...a: unknown[]) => notify(...a) }));

import { fakeDb, type Row } from "./fake-db";
import { applyRemote, commerceMessage, handleCallback, pollBooking, startPayment, tokenForQr, verifyRemote, type PaymentRow } from "../payment";
import { SwishApiError, type SwishClient, type SwishPaymentRequest } from "../client";
import type { SwishCommerceConfig } from "../config";
import { decideSwishBooking } from "@/lib/swish/confirm";

/**
 * Swish Handel mot en mockad Swish: skapa förfrågan, callback PAID, DECLINED,
 * dubbel callback, fel belopp, fel callbackIdentifier och polling-reserven.
 * Det som måste hålla: bokningen bekräftas EN gång, bara när Swishs eget
 * GET-svar säger PAID med rätt belopp och mottagare.
 */

const BOOKING = "7f1c2a9e-1111-4222-8333-944455556666";
const LISTING = "0b5e8c1d-aaaa-4bbb-8ccc-ddddeeeeffff";
const OWNER = "c0ffee00-0000-4000-8000-000000000001";
const PAYEE = "1234679304";

const cfg: SwishCommerceConfig = {
  env: "test",
  baseUrl: "https://mss.cpc.getswish.net",
  qrUrl: "https://mpc.getswish.net/qrg-swish/api/v1/commerce",
  payeeAlias: PAYEE,
  callbackUrl: "https://usha.se/api/swish/commerce/callback",
  tls: {},
};

function setup(overrides: { booking?: Row; owner?: Row; listing?: Row } = {}) {
  const db = fakeDb({
    bookings: [
      {
        id: BOOKING,
        listing_id: LISTING,
        status: "pending",
        payment_method: "swish",
        amount_paid: 26000,
        guest_count: 2,
        guest_email: "gast@example.com",
        guest_name: "Gäst",
        customer_id: null,
        ticket_type_id: null,
        ticket_type_name: null,
        scheduled_at: "2099-11-26T18:00:00.000Z",
        notes: "Swish via eventsidan",
        ...overrides.booking,
      },
    ],
    listings: [
      {
        id: LISTING,
        user_id: OWNER,
        title: "The Lab – torsdagar på Bacchi",
        event_date: "2099-11-26",
        event_time: "19:00:00",
        event_end_time: "23:00:00",
        event_location: "Bacchi",
        organizer_name: "Usha",
        is_active: true,
        tickets_sold: 10,
        ...overrides.listing,
      },
    ],
    profiles: [{ id: OWNER, is_usha_owned_seller: true, company_name: "Usha AB", org_number: "559000-0000", full_name: "Usha", ...overrides.owner }],
    swish_payment_requests: [],
  });
  const remote: { current: Partial<SwishPaymentRequest> | null } = { current: null };
  const client = {
    create: vi.fn(async () => ({ token: "tok123", location: "loc" })),
    get: vi.fn(async (id: string) => (remote.current ? ({ id, payeeAlias: PAYEE, currency: "SEK", amount: 260, status: "CREATED", ...remote.current } as SwishPaymentRequest) : null)),
    qr: vi.fn(async () => Buffer.from("png")),
  } satisfies SwishClient;
  const admin = db.admin as unknown as SupabaseClient;
  const booking = () => db.tables.bookings[0];
  const requests = () => db.tables.swish_payment_requests as unknown as PaymentRow[];
  const ticketRpcs = () => db.rpcCalls.filter((c) => c.fn === "increment_tickets_sold");
  return { db, admin, client, remote, booking, requests, ticketRpcs };
}

beforeEach(() => {
  sendEmail.mockClear();
  notify.mockClear();
});

describe("commerceMessage", () => {
  it("har kväll, datum och referens, inga otillåtna tecken, högst 50", () => {
    const m = commerceMessage("The Lab – torsdagar på Bacchi", "2026-11-26", BOOKING);
    expect(m).toBe("The Lab 26-11 ref 7F1C2A9E");
    expect(m.length).toBeLessThanOrEqual(50);
    expect(m).not.toMatch(/\//);
  });
  it("kortar en lång titel men behåller referensen", () => {
    const m = commerceMessage("Salsa & bachata / social dance night with live band and DJ", "2026-01-02", BOOKING);
    expect(m.length).toBeLessThanOrEqual(50);
    expect(m.endsWith("02-01 ref 7F1C2A9E")).toBe(true);
    expect(m).toMatch(/^[a-zA-ZåäöÅÄÖéÉüÜ0-9 !?(),.\-:;]+$/);
  });
});

describe("startPayment", () => {
  it("sparar raden FÖRE anropet och tar beloppet ur bokningen", async () => {
    const s = setup();
    s.client.create.mockImplementationOnce(async () => {
      expect(s.requests()).toHaveLength(1); // callbacken ska alltid hitta raden
      return { token: "tok123", location: "loc" };
    });
    const r = await startPayment(s.admin, s.client, cfg, BOOKING);
    expect(r).toMatchObject({ ok: true, token: "tok123", reused: false });
    const call = (s.client.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(call.amountOre).toBe(26000);
    expect(call.payeePaymentReference).toBe(BOOKING.replace(/-/g, ""));
    expect(String(call.callbackIdentifier)).toMatch(/^[0-9A-F]{32}$/);
    expect(s.requests()[0]).toMatchObject({ status: "CREATED", token: "tok123", amount_ore: 26000, payee_alias: PAYEE, env: "test" });
  });

  it("återanvänder en färsk förfrågan i stället för att skapa en ny", async () => {
    const s = setup();
    const a = await startPayment(s.admin, s.client, cfg, BOOKING);
    const b = await startPayment(s.admin, s.client, cfg, BOOKING);
    expect(b).toMatchObject({ ok: true, reused: true });
    expect(a.ok && b.ok && a.instructionId === b.instructionId).toBe(true);
    expect(s.client.create).toHaveBeenCalledTimes(1);
  });

  it("nekar en bokning som inte är vilande", async () => {
    const s = setup({ booking: { status: "confirmed" } });
    expect(await startPayment(s.admin, s.client, cfg, BOOKING)).toEqual({ ok: false, error: "notPending" });
    expect(s.client.create).not.toHaveBeenCalled();
  });

  it("nekar när säljaren inte är Usha (pengarna landar på bolagets konto)", async () => {
    const s = setup({ owner: { is_usha_owned_seller: false } });
    expect(await startPayment(s.admin, s.client, cfg, BOOKING)).toEqual({ ok: false, error: "unavailable" });
  });

  it("nekar en passerad kväll", async () => {
    const s = setup({ listing: { event_date: "2020-01-01" } });
    expect(await startPayment(s.admin, s.client, cfg, BOOKING)).toEqual({ ok: false, error: "past" });
  });

  it("Swish svarar 422: raden blir ERROR med koden, bokningen orörd", async () => {
    const s = setup();
    s.client.create.mockRejectedValueOnce(new SwishApiError(422, ["RP02"]));
    expect(await startPayment(s.admin, s.client, cfg, BOOKING)).toEqual({ ok: false, error: "swishFailed", codes: ["RP02"] });
    expect(s.requests()[0]).toMatchObject({ status: "ERROR", error_code: "RP02" });
    expect(s.booking().status).toBe("pending");
  });
});

async function started() {
  const s = setup();
  const r = await startPayment(s.admin, s.client, cfg, BOOKING);
  if (!r.ok) throw new Error("start failed");
  const row = s.requests()[0];
  return { ...s, id: r.instructionId, cbid: row.callback_identifier };
}

describe("handleCallback", () => {
  it("PAID: bokningen bekräftas, biljetten räknas och mejlas — en gång", async () => {
    const s = await started();
    s.remote.current = { status: "PAID", paymentReference: "PR1", datePaid: "2099-11-26T17:00:00Z" };
    const r = await handleCallback(s.admin, s.client, { id: s.id, status: "PAID" }, s.cbid);
    expect(r).toEqual({ http: 200, body: { ok: true, outcome: "confirmed" } });
    expect(s.booking().status).toBe("confirmed");
    expect(s.ticketRpcs()).toHaveLength(1);
    expect(s.ticketRpcs()[0].args).toMatchObject({ p_listing: LISTING, p_n: 2 });
    expect(s.db.tables.listings[0].tickets_sold).toBe(12);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(s.requests()[0]).toMatchObject({ status: "PAID", payment_reference: "PR1" });
  });

  it("dubbel callback: andra gången händer ingenting", async () => {
    const s = await started();
    s.remote.current = { status: "PAID", paymentReference: "PR1" };
    await handleCallback(s.admin, s.client, { id: s.id }, s.cbid);
    const second = await handleCallback(s.admin, s.client, { id: s.id }, s.cbid);
    expect(second).toEqual({ http: 200, body: { ok: true, outcome: "alreadyHandled" } });
    expect(s.ticketRpcs()).toHaveLength(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("DECLINED: bokningen förblir vilande så att gästen kan försöka igen", async () => {
    const s = await started();
    s.remote.current = { status: "DECLINED" };
    const r = await handleCallback(s.admin, s.client, { id: s.id }, s.cbid);
    expect(r.body).toMatchObject({ outcome: "notPaid" });
    expect(s.booking().status).toBe("pending");
    expect(s.requests()[0].status).toBe("DECLINED");
    expect(s.ticketRpcs()).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("fel belopp hos Swish: ingen bekräftelse, raden markeras MISMATCH", async () => {
    const s = await started();
    s.remote.current = { status: "PAID", amount: "1.00" };
    const r = await handleCallback(s.admin, s.client, { id: s.id, amount: 260 }, s.cbid);
    expect(r.body).toMatchObject({ outcome: "mismatch" });
    expect(s.booking().status).toBe("pending");
    expect(s.requests()[0]).toMatchObject({ status: "MISMATCH", error_code: "mismatch:amount" });
    expect(s.ticketRpcs()).toHaveLength(0);
  });

  it("fel mottagare hos Swish: ingen bekräftelse", async () => {
    const s = await started();
    s.remote.current = { status: "PAID", payeeAlias: "1231111111" };
    await handleCallback(s.admin, s.client, { id: s.id }, s.cbid);
    expect(s.booking().status).toBe("pending");
  });

  it("litar inte på kroppen: callback säger PAID men Swishs GET säger CREATED", async () => {
    const s = await started();
    s.remote.current = { status: "CREATED" };
    const r = await handleCallback(s.admin, s.client, { id: s.id, status: "PAID", amount: 260, payeeAlias: PAYEE }, s.cbid);
    expect(r.body).toMatchObject({ outcome: "waiting" });
    expect(s.booking().status).toBe("pending");
  });

  it("fel callbackIdentifier: 401, Swish tillfrågas inte, inget händer", async () => {
    const s = await started();
    s.remote.current = { status: "PAID" };
    const r = await handleCallback(s.admin, s.client, { id: s.id }, "0".repeat(32));
    expect(r.http).toBe(401);
    expect(s.client.get).not.toHaveBeenCalled();
    expect(s.booking().status).toBe("pending");
  });

  it("saknad header: 401", async () => {
    const s = await started();
    expect((await handleCallback(s.admin, s.client, { id: s.id }, null)).http).toBe(401);
  });

  it("okänd förfrågan: 200 så att Swish slutar försöka, inget händer", async () => {
    const s = await started();
    const r = await handleCallback(s.admin, s.client, { id: "A".repeat(32) }, s.cbid);
    expect(r).toEqual({ http: 200, body: { ignored: true } });
    expect(s.client.get).not.toHaveBeenCalled();
  });

  it("Swish GET svarar inte: 503 så att Swish skickar callbacken igen", async () => {
    const s = await started();
    s.client.get.mockRejectedValueOnce(new Error("timeout"));
    expect((await handleCallback(s.admin, s.client, { id: s.id }, s.cbid)).http).toBe(503);
    expect(s.booking().status).toBe("pending");
  });

  it("entrén hann bekräfta för hand först: Swish PAID räknar inte en gång till", async () => {
    const s = await started();
    const listing = s.db.tables.listings[0] as never;
    await decideSwishBooking(s.admin, { listing, bookingId: BOOKING, action: "confirm", decidedBy: "dorrvard" });
    s.remote.current = { status: "PAID" };
    const r = await handleCallback(s.admin, s.client, { id: s.id }, s.cbid);
    expect(r.body).toMatchObject({ outcome: "alreadyHandled" });
    expect(s.ticketRpcs()).toHaveLength(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("bokningen ändrade belopp efter förfrågan: ingen bekräftelse", async () => {
    const s = await started();
    s.booking().amount_paid = 13000;
    s.remote.current = { status: "PAID" };
    await handleCallback(s.admin, s.client, { id: s.id }, s.cbid);
    expect(s.booking().status).toBe("pending");
  });
});

describe("pollBooking (reserv när callbacken uteblir)", () => {
  it("frågar Swish själv och bekräftar", async () => {
    const s = await started();
    s.remote.current = { status: "PAID" };
    const later = new Date(Date.now() + 10_000);
    expect(await pollBooking(s.admin, s.client, BOOKING, later)).toEqual({ state: "confirmed" });
    expect(s.booking().status).toBe("confirmed");
    expect(s.ticketRpcs()).toHaveLength(1);
  });

  it("frågar inte Swish oftare än var fjärde sekund", async () => {
    const s = await started();
    s.remote.current = { status: "CREATED" };
    const t = Date.now() + 10_000;
    await pollBooking(s.admin, s.client, BOOKING, new Date(t));
    await pollBooking(s.admin, s.client, BOOKING, new Date(t + 1_000));
    expect(s.client.get).toHaveBeenCalledTimes(1);
  });

  it("nekad i appen → declined", async () => {
    const s = await started();
    s.remote.current = { status: "DECLINED" };
    expect((await pollBooking(s.admin, s.client, BOOKING, new Date(Date.now() + 10_000))).state).toBe("declined");
    expect(s.booking().status).toBe("pending");
  });

  it("ERROR BANKIDCL (avbröt i BankID) → declined; annan ERROR → error", async () => {
    const s = await started();
    s.remote.current = { status: "ERROR", errorCode: "BANKIDCL" };
    expect((await pollBooking(s.admin, s.client, BOOKING, new Date(Date.now() + 10_000))).state).toBe("declined");
    const t = await started();
    t.remote.current = { status: "ERROR", errorCode: "TM01" };
    expect(await pollBooking(t.admin, t.client, BOOKING, new Date(Date.now() + 10_000))).toMatchObject({ state: "error", errorCode: "TM01" });
    expect(t.requests()[0]).toMatchObject({ status: "ERROR", error_code: "TM01" });
  });

  it("redan bekräftad: frågar inte Swish", async () => {
    const s = await started();
    s.booking().status = "confirmed";
    expect(await pollBooking(s.admin, s.client, BOOKING)).toEqual({ state: "confirmed" });
    expect(s.client.get).not.toHaveBeenCalled();
  });
});

describe("verifyRemote / tokenForQr", () => {
  const row = { id: "A".repeat(32), payee_alias: PAYEE, amount_ore: 13000 };
  it("godtar rätt svar, även belopp som sträng", () => {
    expect(verifyRemote(row, { id: row.id, payeeAlias: PAYEE, currency: "SEK", amount: "130.00", status: "PAID" })).toBeNull();
  });
  it("fångar valuta och id", () => {
    expect(verifyRemote(row, { id: row.id, payeeAlias: PAYEE, currency: "EUR", amount: 130, status: "PAID" })).toBe("currency");
    expect(verifyRemote(row, { id: "B".repeat(32), payeeAlias: PAYEE, currency: "SEK", amount: 130, status: "PAID" })).toBe("id");
  });
  it("QR bara för en väntande förfrågan", async () => {
    const s = await started();
    expect(await tokenForQr(s.admin, s.id)).toBe("tok123");
    s.requests()[0].status = "PAID";
    expect(await tokenForQr(s.admin, s.id)).toBeNull();
    expect(await tokenForQr(s.admin, "not-an-id")).toBeNull();
  });
  it("applyRemote med PAID två gånger direkt räknar en gång", async () => {
    const s = await started();
    const remote = { id: s.id, payeeAlias: PAYEE, currency: "SEK", amount: 260, status: "PAID" } as SwishPaymentRequest;
    const row = { ...s.requests()[0] };
    const [a, b] = await Promise.all([applyRemote(s.admin, row, remote), applyRemote(s.admin, row, remote)]);
    expect([a.outcome, b.outcome].sort()).toEqual(["alreadyHandled", "confirmed"]);
    expect(s.ticketRpcs()).toHaveLength(1);
  });
});
