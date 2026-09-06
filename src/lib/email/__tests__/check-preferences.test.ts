import { describe, it, expect, vi, beforeEach } from "vitest";

// En tom inställningsrad får inte betyda "ja" för marknadsföring. Testet finns
// för att den defaulten en gång skickade 19 mejl utan grund.
const maybeSingle = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));

import { shouldSendEmail } from "../check-preferences";

describe("shouldSendEmail", () => {
  beforeEach(() => maybeSingle.mockReset());

  it("skickar inte marknadsföring till den som aldrig valt", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await shouldSendEmail("u1", "notif_marketing")).toBe(false);
  });

  it("skickar marknadsföring bara vid aktivt ja", async () => {
    maybeSingle.mockResolvedValue({ data: { notif_marketing: true }, error: null });
    expect(await shouldSendEmail("u1", "notif_marketing")).toBe(true);
  });

  it("behandlar tystnad som ja för transaktionella notiser", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await shouldSendEmail("u1", "notif_booking_confirmed")).toBe(true);
  });

  it("respekterar ett uttryckligt nej", async () => {
    maybeSingle.mockResolvedValue({ data: { notif_booking_confirmed: false }, error: null });
    expect(await shouldSendEmail("u1", "notif_booking_confirmed")).toBe(false);
  });

  it("tolkar inte ett databasfel som samtycke", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await shouldSendEmail("u1", "notif_marketing")).toBe(false);
    expect(await shouldSendEmail("u1", "notif_payout")).toBe(true);
  });
});
