import { describe, it, expect } from "vitest";
import { readUtmFromParams, hasUtm, serializeUtm, parseUtm, utmMetadata, utmBookingFields } from "../utm";

const params = (q: string) => new URLSearchParams(q);

describe("läsa utm ur adressen", () => {
  it("plockar ut de fyra fälten och normaliserar till gemener", () => {
    const utm = readUtmFromParams(params("utm_source=Instagram&utm_medium=Social&utm_campaign=TheLab&utm_content=story"));
    expect(utm).toEqual({ source: "instagram", medium: "social", campaign: "thelab", content: "story" });
  });

  it("struntar i tomma och ogiltiga värden", () => {
    expect(readUtmFromParams(params("utm_source=&utm_medium=<script>"))).toEqual({});
    expect(hasUtm({})).toBe(false);
  });

  it("kapar långa värden i stället för att spara dem", () => {
    const long = "a".repeat(200);
    expect(readUtmFromParams(params(`utm_campaign=${long}`)).campaign).toHaveLength(64);
  });
});

describe("cookie fram och tillbaka", () => {
  it("överlever serialisering", () => {
    const utm = { source: "instagram", medium: "social", campaign: "thelab" };
    expect(parseUtm(serializeUtm(utm))).toEqual(utm);
  });

  it("tål skräp i cookien utan att kasta", () => {
    expect(parseUtm("trasig|:|source:instagram")).toEqual({ source: "instagram" });
    expect(parseUtm(null)).toEqual({});
  });
});

describe("vidare till Stripe och bokningen", () => {
  it("skickar bara det som finns", () => {
    expect(utmMetadata({ source: "instagram", campaign: "thelab" })).toEqual({
      utm_source: "instagram",
      utm_campaign: "thelab",
    });
  });

  it("ger bokningskolumner när metadata bär en kampanj", () => {
    expect(utmBookingFields({ utm_source: "instagram", utm_medium: "social" })).toEqual({
      utm_source: "instagram",
      utm_medium: "social",
      utm_campaign: null,
      utm_content: null,
    });
  });

  it("ger inga kolumner alls när kampanj saknas — en bokning utan kanal ska vara null, inte tom sträng", () => {
    expect(utmBookingFields({})).toEqual({});
    expect(utmBookingFields(null)).toEqual({});
  });
});
