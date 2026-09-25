import { describe, it, expect } from "vitest";
import { canonicalSeriesSlug, SERIES_ALIASES } from "../series-aliases";

describe("canonicalSeriesSlug", () => {
  it("översätter en gammal nyckel till den nya", () => {
    expect(canonicalSeriesSlug("the-lab-tarraxo-urban-kizomba")).toBe("the-lab-mandag");
    expect(canonicalSeriesSlug("the-lab-torsdag-tarraxo-urban-kizomba")).toBe("the-lab-torsdag");
  });

  it("lämnar en okänd nyckel orörd", () => {
    expect(canonicalSeriesSlug("brazilian-zouk-tisdag")).toBe("brazilian-zouk-tisdag");
    expect(canonicalSeriesSlug("nagot-helt-annat")).toBe("nagot-helt-annat");
  });

  it("pekar aldrig ett alias på sig självt", () => {
    for (const [gammal, ny] of Object.entries(SERIES_ALIASES)) {
      expect(gammal).not.toBe(ny);
      expect(SERIES_ALIASES[ny]).toBeUndefined();
    }
  });
});
