import { describe, it, expect } from "vitest";
import { fakeAdmin } from "./fake-db";
import { eveningLineName, isWasThere, wasThereGate } from "../was-there";

const LAB = { id: "l1", event_date: "2026-11-26", event_time: "17:00:00", event_end_time: "23:00:00" };
const AT_0030 = new Date("2026-11-26T23:30:00Z"); // 00:30 svensk tid
const AT_2200 = new Date("2026-11-26T21:00:00Z"); // 22:00

function gate(over: Partial<Parameters<typeof wasThereGate>[0]> = {}, bookings: Record<string, unknown>[] = []) {
  return wasThereGate({
    admin: fakeAdmin({ tables: { bookings } }) as never,
    listing: LAB,
    now: AT_0030,
    requested: true,
    isPass: false,
    userId: null,
    email: "gast@exempel.se",
    ...over,
  });
}

describe("isWasThere", () => {
  it("från midnatt till 24 timmar efter kvällens slut", () => {
    expect(isWasThere(LAB, AT_2200)).toBe(false);
    expect(isWasThere(LAB, AT_0030)).toBe(true);
    expect(isWasThere(LAB, new Date("2026-11-27T21:59:00Z"))).toBe(true); // 22:59 dagen efter
    expect(isWasThere(LAB, new Date("2026-11-27T22:00:00Z"))).toBe(false); // 23:00 dagen efter
  });
});

describe("wasThereGate", () => {
  it("rör inte vanliga köp — de går genom sale-state", async () => {
    expect(await gate({ requested: false })).toEqual({ kind: "off" });
    expect(await gate({ now: AT_2200, requested: false })).toEqual({ kind: "off" });
  });

  it("säljer aldrig en kommande eller pågående kväll som efterköp", async () => {
    expect(await gate({ now: AT_2200 })).toMatchObject({ kind: "error", status: 403, code: "wasThereClosed" });
  });

  it("stänger 24 timmar efter kvällens slut", async () => {
    expect(await gate({ now: new Date("2026-11-27T22:00:00Z") })).toMatchObject({ code: "wasThereClosed" });
  });

  it("säljer inga klippkort", async () => {
    expect(await gate({ isPass: true })).toMatchObject({ kind: "error", code: "wasThereNoPass" });
  });

  it("kräver e-post av en gäst utan konto", async () => {
    expect(await gate({ email: null })).toMatchObject({ kind: "error", code: "wasThereEmail" });
  });

  it("släpper igenom ett första köp", async () => {
    expect(await gate()).toEqual({ kind: "ok" });
  });

  it("spärrar ett andra köp från samma e-post (oavsett versaler)", async () => {
    const r = await gate({}, [{ id: "b", listing_id: "l1", guest_email: "Gast@Exempel.se", status: "confirmed" }]);
    expect(r).toMatchObject({ kind: "error", status: 409, code: "wasThereAlreadyPaid" });
  });

  it("spärrar ett andra köp från samma konto, också efter incheckning", async () => {
    const r = await gate({ userId: "u1", email: null }, [{ id: "b", listing_id: "l1", customer_id: "u1", status: "completed" }]);
    expect(r).toMatchObject({ code: "wasThereAlreadyPaid" });
  });

  it("räknar inte avbrutna eller avbokade köp", async () => {
    const r = await gate({}, [
      { id: "p", listing_id: "l1", guest_email: "gast@exempel.se", status: "pending" },
      { id: "c", listing_id: "l1", guest_email: "gast@exempel.se", status: "canceled" },
    ]);
    expect(r).toEqual({ kind: "ok" });
  });

  it("räknar inte köp till en annan kväll", async () => {
    const r = await gate({}, [{ id: "b", listing_id: "other", guest_email: "gast@exempel.se", status: "confirmed" }]);
    expect(r).toEqual({ kind: "ok" });
  });
});

describe("eveningLineName", () => {
  it("sätter kvällens datum på kvittoraden", () => {
    expect(eveningLineName("The Lab", "2026-11-26", "17:00:00")).toBe("The Lab – torsdag 26 november 2026 17:00");
  });
  it("lämnar titeln orörd utan datum", () => {
    expect(eveningLineName("Massage", null)).toBe("Massage");
  });
});
