import { describe, it, expect } from "vitest";
import { buildEntryBuyUrl } from "../buy-url";

describe("buildEntryBuyUrl", () => {
  it("pekar på den publika köpsidan med biljetten förvald", () => {
    expect(
      buildEntryBuyUrl({ appUrl: "https://usha.se", slug: "the-lab-2026-09-14", ticketTypeId: "tt-1" })
    ).toBe("https://usha.se/event/the-lab-2026-09-14?tt=tt-1");
  });

  it("klarar sig utan förvald biljettyp", () => {
    expect(buildEntryBuyUrl({ appUrl: "https://usha.se", slug: "the-lab" })).toBe(
      "https://usha.se/event/the-lab"
    );
  });

  it("ger null utan slug — det finns ingen publik sida att skicka gästen till", () => {
    expect(buildEntryBuyUrl({ appUrl: "https://usha.se", slug: null, ticketTypeId: "tt-1" })).toBeNull();
  });

  it("dubblerar inte snedstrecket när appUrl slutar med ett", () => {
    expect(buildEntryBuyUrl({ appUrl: "https://usha.se/", slug: "the-lab" })).toBe(
      "https://usha.se/event/the-lab"
    );
  });

  it("kodar slug och biljett-id så en udda sträng inte bryter länken", () => {
    expect(
      buildEntryBuyUrl({ appUrl: "https://usha.se", slug: "a b", ticketTypeId: "x&y" })
    ).toBe("https://usha.se/event/a%20b?tt=x%26y");
  });
});
