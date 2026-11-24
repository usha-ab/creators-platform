import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
import { buildVenueDirectory } from "../directory";

const bacchi = { id: "b", full_name: "Bacchi Syre", company_name: "Syre bar och event AB", slug: "bacchisyre", avatar_url: null, location: "Stockholm" };
const tom = { id: "t", full_name: "Tom lokal", company_name: null, slug: null, avatar_url: null, location: null };
const namnlos = { id: "n", full_name: " ", company_name: null, slug: null, avatar_url: null, location: null };

const ev = (id: string, title: string, date: string | null, user_id: string, venue: string | null, confirmed: boolean) => ({
  id, title, event_date: date, user_id, venue_profile_id: venue, venue_confirmed_at: confirmed ? "2026-11-01" : null,
});

describe("buildVenueDirectory", () => {
  const today = "2026-11-24";
  const listings = [
    ev("1", "The Lab Torsdag", "2026-11-26", "pablo", "b", true),
    ev("2", "Brazilian Zouk Tisdag", "2026-12-01", "pablo", "b", true),
    ev("3", "INSTÄLLT: The Lab", "2026-12-03", "pablo", "b", true),
    ev("4", "Obekräftad kväll", "2026-12-04", "x", "t", false),
    ev("5", "Kväll", "2026-12-05", "n", null, false),
  ];

  it("visar lokaler med kommande program och räknar bort inställda", () => {
    const out = buildVenueDirectory([bacchi, tom, namnlos], listings, today);
    expect(out).toEqual([
      { id: "b", name: "Bacchi Syre", href: "/creators/bacchisyre", avatarUrl: null, city: "Stockholm", upcoming: 2 },
    ]);
  });

  it("räknar inte en obekräftad koppling", () => {
    expect(buildVenueDirectory([tom], listings, today)).toEqual([]);
  });

  it("räknar lokalens egna kvällar", () => {
    const out = buildVenueDirectory([tom], [ev("6", "Egen kväll", "2026-12-06", "t", null, false)], today);
    expect(out[0]).toMatchObject({ id: "t", href: "/creators/t", upcoming: 1 });
  });
});
