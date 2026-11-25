import { describe, it, expect, beforeEach, vi } from "vitest";
import { MIN_PRICE_ERROR_CODE } from "@/lib/stripe/min-price";

/**
 * Servern nekar betalda priser under 50 kr (min-price.ts), oavsett vad
 * formuläret gör. Databasen är en liten fake: varje tabell svarar med det
 * testet lagt i `db`, och skrivningar loggas så vi ser att inget sparades.
 */

const USER = "11111111-1111-1111-1111-111111111111";
const LISTING = "22222222-2222-2222-2222-222222222222";

const db: {
  listing: Record<string, unknown> | null;
  ticketTypes: Record<string, unknown>[];
  writes: { table: string; op: string; payload: unknown }[];
  failWrites: boolean;
} = { listing: null, ticketTypes: [], writes: [], failWrites: true };

function chain(table: string) {
  let op: "select" | "insert" | "update" = "select";
  let payload: unknown = null;
  const result = () => {
    if (op !== "select") {
      db.writes.push({ table, op, payload });
      return db.failWrites ? { data: null, error: { message: "fake" } } : { data: [{ id: "x" }], error: null };
    }
    if (table === "profiles") {
      return { data: { role: "creator", bankid_verified_at: "2026-01-01", bankid_grandfathered_at: null }, error: null };
    }
    if (table === "listings") return { data: db.listing, error: null };
    if (table === "ticket_types") return { data: db.ticketTypes, error: null };
    if (table === "bookings") return { data: null, count: 0, error: null };
    return { data: null, error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    insert: (p: unknown) => ((op = "insert"), (payload = p), b),
    update: (p: unknown) => ((op = "update"), (payload = p), b),
    eq: () => b,
    in: () => b,
    order: () => b,
    single: async () => result(),
    maybeSingle: async () => result(),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
  };
  return b;
}
const fakeClient = {
  auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
  from: (t: string) => chain(t),
  rpc: async () => ({ data: null, error: null }),
};

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeClient }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/listings/manage-access", () => ({ canManageListing: async () => false }));
vi.mock("@/lib/venues/members", () => ({ venuesUserCanCreateFor: async () => [] }));
vi.mock("@/lib/venues/create-as-venue", () => ({ listingWriterFor: () => fakeClient }));
vi.mock("@/lib/subscription/check", () => ({
  getSubscriptionStatus: async () => ({ tier: "gratis" }),
  requirePaidSubscription: async () => undefined,
}));
vi.mock("@/lib/listings/limits", () => ({
  checkListingLimit: async () => ({ allowed: true, max: null, current: 0 }),
}));
vi.mock("@/lib/listings/slug", () => ({
  generateUniqueListingSlug: async () => "slug",
  generateUniqueSeriesSlug: async () => "serie",
}));
vi.mock("@/lib/capabilities/gate", () => ({
  ticketGateForNewEvent: async () => false,
  ticketGateForListing: async () => null,
}));
vi.mock("@/lib/facebook/auto-sync", () => ({ syncListingPost: vi.fn(), touchesPost: () => false }));
vi.mock("@/lib/notifications/create", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/passes/expiry-extension", () => ({ extendPassesForCanceledEvening: vi.fn() }));

import { createEvent, updateEvent } from "../actions";
import { createAccessCode } from "../[id]/codes/actions";

function eventForm(fields: Record<string, string>) {
  const fd = new FormData();
  fd.set("title", "Salsakväll");
  fd.set("category", "dance");
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  db.listing = null;
  db.ticketTypes = [];
  db.writes = [];
  db.failWrites = true;
});

describe("createEvent nekar pris under 50 kr", () => {
  it("49 kr nekas och ingenting sparas", async () => {
    const r = await createEvent(eventForm({ price: "49" }));
    expect(r).toMatchObject({ code: MIN_PRICE_ERROR_CODE });
    expect(db.writes).toHaveLength(0);
  });

  it("50 kr och 0 kr går vidare till insättningen", async () => {
    for (const price of ["50", "0"]) {
      db.writes = [];
      const r = await createEvent(eventForm({ price }));
      expect(r).not.toMatchObject({ code: MIN_PRICE_ERROR_CODE });
      expect(db.writes.some((w) => w.table === "listings" && w.op === "insert")).toBe(true);
    }
  });

  it("en biljettyp eller ett förköpspris under 50 kr nekas", async () => {
    const types = JSON.stringify([
      { name: "Ordinarie", price: 150 },
      { name: "Student", price: 30 },
    ]);
    expect(await createEvent(eventForm({ ticket_types: types }))).toMatchObject({ code: MIN_PRICE_ERROR_CODE });
    expect(await createEvent(eventForm({ price: "150", early_bird_price: "25" }))).toMatchObject({
      code: MIN_PRICE_ERROR_CODE,
    });
    expect(db.writes).toHaveLength(0);
  });
});

describe("updateEvent: gammalt pris får stå kvar, nytt måste följa regeln", () => {
  beforeEach(() => {
    db.listing = { user_id: USER, price: 30, early_bird_price: null, slug: "s", event_date: null, series_id: null, venue_profile_id: null };
  });

  it("oförändrat pris under 50 kr passerar spärren", async () => {
    const r = await updateEvent(LISTING, eventForm({ price: "30" }));
    expect(r).not.toMatchObject({ code: MIN_PRICE_ERROR_CODE });
    expect(db.writes.some((w) => w.table === "listings" && w.op === "update")).toBe(true);
  });

  it("ändrat pris under 50 kr nekas", async () => {
    const r = await updateEvent(LISTING, eventForm({ price: "35" }));
    expect(r).toMatchObject({ code: MIN_PRICE_ERROR_CODE });
    expect(db.writes).toHaveLength(0);
  });
});

describe("createAccessCode: rabattpriset är 0 eller minst 50 kr", () => {
  beforeEach(() => {
    db.listing = { user_id: USER };
  });
  const codeForm = (discount: string) => {
    const fd = new FormData();
    fd.set("code", "VIP");
    fd.set("discount_price", discount);
    return fd;
  };

  it("49 kr nekas", async () => {
    expect(await createAccessCode(LISTING, codeForm("49"))).toMatchObject({ code: MIN_PRICE_ERROR_CODE });
    expect(db.writes).toHaveLength(0);
  });

  it("50 kr, 0 kr och tomt (gratis) sparas", async () => {
    db.failWrites = false;
    for (const d of ["50", "0", ""]) {
      expect(await createAccessCode(LISTING, codeForm(d))).toEqual({ success: true });
    }
    expect(db.writes.filter((w) => w.table === "event_access_codes")).toHaveLength(3);
  });
});
