import { describe, it, expect, vi } from "vitest";
import { touchesPost, syncListingPost, POST_RELEVANT_FIELDS } from "../auto-sync";

describe("touchesPost", () => {
  it("reagerar på fälten som bygger inläggstexten", () => {
    for (const f of POST_RELEVANT_FIELDS) {
      expect(touchesPost({ [f]: "något" })).toBe(true);
    }
  });

  it("reagerar INTE på fält som inte syns i inlägget", () => {
    // Utan det här skulle varje såld biljett och varje sparning utan
    // textändring skicka ett anrop till Facebook.
    expect(touchesPost({ tickets_sold: 4 })).toBe(false);
    expect(touchesPost({ updated_at: "2026-09-28" })).toBe(false);
    expect(touchesPost({ capacity: 0, venue_profile_id: "x" })).toBe(false);
    expect(touchesPost({})).toBe(false);
  });
});

/** Minimal stubb: ger olika rader beroende på tabell. */
function admin(listing: unknown, connection: unknown) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === "listings" ? listing : connection,
          }),
        }),
      }),
    }),
  } as never;
}

const LISTING = {
  id: "l1",
  user_id: "u1",
  title: "The Lab Torsdag",
  description: "Tarraxo & urban kizomba",
  price: 200,
  slug: "the-lab-torsdag",
  is_active: true,
  facebook_event_id: "438136616060981_122177582798647885",
};

const CONN = { facebook_page_access_token: "hemlig-token" };

describe("syncListingPost", () => {
  it("uppdaterar inlägget och skickar rätt id till Facebook", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const r = await syncListingPost(admin(LISTING, CONN), "l1", "https://usha.se", f as never);
    expect(r.status).toBe("uppdaterad");
    expect(f).toHaveBeenCalledOnce();
    const [url, init] = f.mock.calls[0];
    expect(url).toContain("438136616060981_122177582798647885");
    expect(JSON.parse((init as RequestInit).body as string).message).toContain("The Lab Torsdag");
  });

  it("publicerar ALDRIG ett nytt inlägg", async () => {
    // Den viktigaste regeln: ett evenemang som aldrig delats får inte
    // plötsligt dyka upp på sidan för att någon rättade en stavning.
    const f = vi.fn();
    const r = await syncListingPost(
      admin({ ...LISTING, facebook_event_id: null }, CONN),
      "l1",
      "https://usha.se",
      f as never
    );
    expect(r.status).toBe("hoppades_över");
    expect(f).not.toHaveBeenCalled();
  });

  it("rör inte avpublicerade evenemang", async () => {
    const f = vi.fn();
    const r = await syncListingPost(
      admin({ ...LISTING, is_active: false }, CONN),
      "l1",
      "https://usha.se",
      f as never
    );
    expect(r.status).toBe("hoppades_över");
    expect(f).not.toHaveBeenCalled();
  });

  it("gör ingenting utan ansluten Facebook-sida", async () => {
    const f = vi.fn();
    const r = await syncListingPost(
      admin(LISTING, { facebook_page_access_token: null }),
      "l1",
      "https://usha.se",
      f as never
    );
    expect(r.status).toBe("hoppades_över");
    expect(f).not.toHaveBeenCalled();
  });

  it("returnerar fel i stället för att kasta när Facebook nekar", async () => {
    // Anroparen är mitt i en sparning — ett kastat fel hade rullat tillbaka
    // något användaren redan fått veta gick bra.
    const f = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "Invalid OAuth access token" } }),
    });
    const r = await syncListingPost(admin(LISTING, CONN), "l1", "https://usha.se", f as never);
    expect(r.status).toBe("fel");
    expect(r.skäl).toContain("Invalid OAuth");
  });

  it("överlever ett nätverksfel", async () => {
    const f = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const r = await syncListingPost(admin(LISTING, CONN), "l1", "https://usha.se", f as never);
    expect(r.status).toBe("fel");
    expect(r.skäl).toBe("ECONNRESET");
  });
});
