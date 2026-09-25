import { describe, it, expect } from "vitest";
import { buildListingPostMessage } from "../listing-post";

const base = { id: "l-1", title: "The Lab", description: "Varje måndag", slug: "the-lab", price: 50 };

describe("buildListingPostMessage", () => {
  // Texten kopieras vidare för hand in i Facebook-evenemang. Tecken utanför
  // BMP (emoji) överlevde inte den resan och blev ersättningstecken i ett
  // publicerat evenemang, så inget sådant får smyga sig in igen.
  it("innehåller inga tecken utanför BMP", () => {
    const msg = buildListingPostMessage(base, "https://usha.se");
    const outside = [...msg].filter((c) => (c.codePointAt(0) ?? 0) > 0xffff);
    expect(outside).toEqual([]);
  });

  it("tar med pris, beskrivning och länk till eventsidan", () => {
    const msg = buildListingPostMessage(base, "https://usha.se");
    expect(msg).toContain("Varje måndag");
    expect(msg).toContain("Price: 50 SEK");
    expect(msg).toContain("https://usha.se/event/the-lab");
  });

  it("säger gratis i stället för pris när priset saknas", () => {
    const msg = buildListingPostMessage({ ...base, price: null }, "https://usha.se");
    expect(msg).toContain("Free entry");
    expect(msg).not.toContain("Price:");
  });

  it("faller tillbaka på listing-id när slug saknas", () => {
    const msg = buildListingPostMessage({ ...base, slug: null }, "https://usha.se");
    expect(msg).toContain("https://usha.se/listing/l-1");
  });
});
