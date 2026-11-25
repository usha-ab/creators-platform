import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Swish-köpet från eventsidan ska neka med 409 när antalet biljetter är fler
 * än platserna som är kvar — som kortkassan. Databasen är en liten fake:
 * listings, ticket_types och vilande Swish-bokningar i minnet.
 */

type Booking = {
  id: string;
  listing_id: string;
  guest_email: string;
  payment_method: string;
  status: string;
  guest_count: number;
  ticket_type_id: string | null;
  created_at: string;
};

const db: {
  listing: Record<string, unknown>;
  ticketTypes: Record<string, unknown>[];
  bookings: Booking[];
  seq: number;
  /** Bokningar som "någon annan" lägger in samtidigt, precis efter vår insert. */
  racer: Booking | null;
  pools: Record<string, unknown>[];
  poolLinks: Record<string, unknown>[];
  /** Körs precis efter vår insert, t.ex. ett kortköp som hinner reservera. */
  afterInsert: (() => void) | null;
} = { listing: {}, ticketTypes: [], bookings: [], seq: 0, racer: null, pools: [], poolLinks: [], afterInsert: null };

function query(table: string) {
  const filters: [string, unknown][] = [];
  let op: "select" | "insert" | "update" = "select";
  let payload: Record<string, unknown> = {};
  const rows = () => {
    if (table === "listings") return [db.listing];
    if (table === "ticket_types") return db.ticketTypes;
    if (table === "bookings") return db.bookings as unknown as Record<string, unknown>[];
    if (table === "ticket_pools") return db.pools;
    if (table === "ticket_type_pools") return db.poolLinks;
    return [];
  };
  const inFilters: [string, unknown[]][] = [];
  const match = () =>
    rows().filter(
      (r) => filters.every(([c, v]) => r[c] === v) && inFilters.every(([c, vs]) => vs.includes(r[c])),
    );
  const run = () => {
    if (op === "insert") {
      const row = {
        ...payload,
        id: `b${++db.seq}`,
        created_at: new Date(Date.UTC(2026, 10, 25, 10, 0, db.seq)).toISOString(),
      } as unknown as Booking;
      db.bookings.push(row);
      if (db.racer) {
        db.bookings.push(db.racer);
        db.racer = null;
      }
      if (db.afterInsert) {
        db.afterInsert();
        db.afterInsert = null;
      }
      return { data: row, error: null };
    }
    if (op === "update") {
      match().forEach((r) => Object.assign(r, payload));
      return { data: null, error: null };
    }
    return { data: match(), error: null };
  };
  const b = {
    select: () => b,
    insert: (p: Record<string, unknown>) => ((op = "insert"), (payload = p), b),
    update: (p: Record<string, unknown>) => ((op = "update"), (payload = p), b),
    eq: (c: string, v: unknown) => (filters.push([c, v]), b),
    in: (c: string, vs: unknown[]) => (inFilters.push([c, vs]), b),
    maybeSingle: async () => {
      const r = run();
      return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null };
    },
    single: async () => {
      const r = run();
      return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null };
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: query }) }));
vi.mock("@/lib/supabase/current-user", () => ({ getCurrentUser: async () => null }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ allowed: true }), getRateLimitKey: () => "k" }));
vi.mock("@/lib/notifications/event-owner", () => ({ notifyEntranceSwishRequest: vi.fn(async () => {}) }));
vi.mock("@/lib/email/send-swish-pending", () => ({ sendSwishPendingEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/swish/availability", () => ({
  swishOfferForListing: async () => ({ number: "1230000000", formatted: "123 000 00 00", message: "Kväll" }),
}));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "sv",
  getTranslations: async () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import { POST } from "../route";
import { sendSwishPendingEmail } from "@/lib/email/send-swish-pending";
import { notifyEntranceSwishRequest } from "@/lib/notifications/event-owner";

const LISTING = "11111111-1111-4111-8111-111111111111";
const TT = "22222222-2222-4222-8222-222222222222";

function req(body: Record<string, unknown>) {
  return new NextRequest("https://usha.se/api/swish/intent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ listingId: LISTING, email: "gast@example.com", ...body }),
  });
}

function pendingRow(n: number, guest_count: number, ticket_type_id: string | null = null): Booking {
  return {
    id: `p${n}`,
    listing_id: LISTING,
    guest_email: `annan${n}@example.com`,
    payment_method: "swish",
    status: "pending",
    guest_count,
    ticket_type_id,
    created_at: "2026-11-25T09:00:00.000Z",
  };
}

beforeEach(() => {
  db.listing = {
    id: LISTING,
    user_id: "owner",
    title: "Kväll",
    price: 200,
    // Långt fram, så att köpgränsen (sale-state) aldrig slår till här.
    event_date: "2099-01-01",
    event_time: "20:00:00",
    event_end_time: null,
    is_active: true,
    is_public: true,
    capacity: 10,
    tickets_sold: 6,
    early_bird_start: null,
    early_bird_end: null,
    early_bird_price: null,
    public_sale_at: null,
  };
  db.ticketTypes = [];
  db.bookings = [];
  db.seq = 0;
  db.racer = null;
  db.pools = [];
  db.poolLinks = [];
  db.afterInsert = null;
  vi.mocked(sendSwishPendingEmail).mockClear();
  vi.mocked(notifyEntranceSwishRequest).mockClear();
});

describe("POST /api/swish/intent — platser kvar", () => {
  it("släpper igenom precis det som är kvar", async () => {
    const res = await POST(req({ quantity: 4 }));
    expect(res.status).toBe(200);
    expect(db.bookings.filter((b) => b.status === "pending")).toHaveLength(1);
  });

  it("nekar en för mycket med 409 och antalet kvar", async () => {
    const res = await POST(req({ quantity: 5 }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ error: "notEnoughSeats", left: 4 });
    expect(body.message).toContain("notEnoughSeats");
    expect(db.bookings).toHaveLength(0);
  });

  it("slutsålt genom vilande Swish-köp ger 409 och texten för slutsålt", async () => {
    db.bookings.push(pendingRow(1, 4));
    const res = await POST(req({ quantity: 1 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "soldOut", message: "soldOut", left: 0 });
  });

  it("ingen kapacitetsgräns: tio biljetter går igenom", async () => {
    db.listing.capacity = null;
    db.bookings.push(pendingRow(1, 9));
    const res = await POST(req({ quantity: 10 }));
    expect(res.status).toBe(200);
  });

  it("flera biljetter i ett köp räknas mot biljettypens gräns", async () => {
    db.ticketTypes = [{ id: TT, listing_id: LISTING, name: "Fest", price: 150, capacity: 3, tickets_sold: 1 }];
    const ok = await POST(req({ quantity: 2, ticketTypeId: TT }));
    expect(ok.status).toBe(200);
    const nej = await POST(req({ quantity: 1, ticketTypeId: TT, email: "tva@example.com" }));
    expect(nej.status).toBe(409);
    expect(await nej.json()).toMatchObject({ error: "soldOut" });
  });

  it("kapplöpning: ett samtidigt köp som kom före tar sista platsen, vårt avbokas utan mejl", async () => {
    db.listing.tickets_sold = 9;
    // Den andra bokningen har en tidigare tidsstämpel än vår.
    db.racer = { ...pendingRow(9, 1), created_at: "2026-11-25T09:59:00.000Z" };
    const res = await POST(req({ quantity: 1 }));
    expect(res.status).toBe(409);
    const own = db.bookings.find((b) => b.guest_email === "gast@example.com");
    expect(own?.status).toBe("canceled");
    expect(sendSwishPendingEmail).not.toHaveBeenCalled();
  });

  it("biljettpoolen räknas: en annan biljettyp i samma pool har tagit platserna", async () => {
    const TT2 = "33333333-3333-4333-8333-333333333333";
    db.ticketTypes = [
      { id: TT, listing_id: LISTING, name: "Fest", price: 150, capacity: null, tickets_sold: 0 },
      { id: TT2, listing_id: LISTING, name: "Fest sen", price: 200, capacity: null, tickets_sold: 2 },
    ];
    db.pools = [{ id: "pool1", capacity: 3 }];
    db.poolLinks = [
      { pool_id: "pool1", ticket_type_id: TT },
      { pool_id: "pool1", ticket_type_id: TT2 },
    ];
    const nej = await POST(req({ quantity: 2, ticketTypeId: TT }));
    expect(nej.status).toBe(409);
    expect(await nej.json()).toMatchObject({ error: "notEnoughSeats", left: 1 });
    const ok = await POST(req({ quantity: 1, ticketTypeId: TT }));
    expect(ok.status).toBe(200);
  });

  it("ett kortköp som reserverar under Swish-köpet syns vid omkontrollen", async () => {
    db.listing.tickets_sold = 9;
    db.afterInsert = () => {
      db.listing.tickets_sold = 10;
    };
    const res = await POST(req({ quantity: 1 }));
    expect(res.status).toBe(409);
    expect(db.bookings.find((b) => b.guest_email === "gast@example.com")?.status).toBe("canceled");
    expect(sendSwishPendingEmail).not.toHaveBeenCalled();
  });
});

describe("POST /api/swish/intent — notisen till dörren", () => {
  it("skapar en notis om just den vilande bokningen, med belopp och kväll", async () => {
    const res = await POST(req({ quantity: 2, name: "Ana" }));
    expect(res.status).toBe(200);
    const { bookingId } = await res.json();
    expect(notifyEntranceSwishRequest).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyEntranceSwishRequest).mock.calls[0][1]).toMatchObject({
      listingId: LISTING,
      ownerId: "owner",
      bookingId,
      name: "Ana",
      amountOre: 40000,
      eventDate: "2099-01-01",
    });
  });

  it("ingen notis när köpet nekas", async () => {
    const res = await POST(req({ quantity: 5 }));
    expect(res.status).toBe(409);
    expect(notifyEntranceSwishRequest).not.toHaveBeenCalled();
  });

  it("ingen ny notis när samma adress trycker igen", async () => {
    await POST(req({}));
    await POST(req({}));
    expect(notifyEntranceSwishRequest).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/swish/intent — Swish Handel bakom flaggan", () => {
  it("flaggan av: mejlet är Swish Företag och entrén får en notis, som förut", async () => {
    const { notifyEntranceSwishRequest } = await import("@/lib/notifications/event-owner");
    vi.mocked(notifyEntranceSwishRequest).mockClear();
    const res = await POST(req({ quantity: 1 }));
    expect(res.status).toBe(200);
    expect(vi.mocked(sendSwishPendingEmail).mock.calls[0][0]).toMatchObject({ commerce: false });
    expect(notifyEntranceSwishRequest).toHaveBeenCalledTimes(1);
  });

  it("flaggan på: mejlet pekar till biljettsidan och entrén störs inte", async () => {
    const { notifyEntranceSwishRequest } = await import("@/lib/notifications/event-owner");
    vi.mocked(notifyEntranceSwishRequest).mockClear();
    vi.stubEnv("SWISH_COMMERCE_ENABLED", "true");
    vi.stubEnv("SWISH_PAYEE_ALIAS", "1234679304");
    vi.stubEnv("SWISH_CERT_PEM", "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----");
    vi.stubEnv("SWISH_KEY_PEM", "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----");
    try {
      const res = await POST(req({ quantity: 1 }));
      expect(res.status).toBe(200);
      expect(vi.mocked(sendSwishPendingEmail).mock.calls[0][0]).toMatchObject({ commerce: true });
      expect(notifyEntranceSwishRequest).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
