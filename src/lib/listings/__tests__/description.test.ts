import { describe, it, expect } from "vitest";
import {
  splitBilingualDescription,
  stripDecorativeLead,
  buildPreviewDescription,
} from "../description";

describe("splitBilingualDescription", () => {
  it("delar på en separatorrad och namnger språket", () => {
    const r = splitBilingualDescription("Svensk text\n\n— English —\n\nEnglish text");
    expect(r.primary).toBe("Svensk text");
    expect(r.secondary).toBe("English text");
    expect(r.secondaryLabel).toBe("English below");
  });

  it("klarar olika streck och versaler", () => {
    for (const sep of ["--- ENGLISH ---", "English", "—english—", "== English =="]) {
      const r = splitBilingualDescription(`A\n${sep}\nB`);
      expect(r.secondary).toBe("B");
    }
  });

  it("rör inte en text utan separator", () => {
    const text = "Bara svenska.\n\nMed flera stycken.";
    expect(splitBilingualDescription(text)).toEqual({
      primary: text,
      secondary: null,
      secondaryLabel: null,
    });
  });

  it("delar inte när ena sidan är tom — då är raden en rubrik", () => {
    const r = splitBilingualDescription("English\n\nOnly one language here");
    expect(r.secondary).toBeNull();
  });

  it("hanterar tom och saknad text", () => {
    expect(splitBilingualDescription(null).primary).toBe("");
    expect(splitBilingualDescription("").secondary).toBeNull();
  });

  it("delar på första separatorn när flera finns", () => {
    const r = splitBilingualDescription("SV\n— English —\nEN\n— Svenska —\nmer");
    expect(r.primary).toBe("SV");
    expect(r.secondaryLabel).toBe("English below");
  });
});

describe("stripDecorativeLead", () => {
  it("tar bort en stiliserad inledningsrad", () => {
    const r = stripDecorativeLead("∏H∑ L∆B ≈ t∆rr∆x◊ & UK\n\nVARJE MÅNDAG\n\nmer text");
    expect(r.startsWith("VARJE MÅNDAG")).toBe(true);
  });

  it("rör inte en text som börjar läsbart", () => {
    expect(stripDecorativeLead("Varje måndag\n\nmer")).toBe("Varje måndag\n\nmer");
  });

  it("behåller svenska tecken som läsbara", () => {
    expect(stripDecorativeLead("Åäö är bokstäver")).toBe("Åäö är bokstäver");
  });

  it("ger tillbaka texten när allt är dekorativt", () => {
    expect(stripDecorativeLead("••• ≈≈≈")).toBe("••• ≈≈≈");
  });
});

describe("buildPreviewDescription", () => {
  const beskrivning = "∏H∑ L∆B ≈ t∆rr∆x◊ & UK\n\nVARJE MÅNDAG\n\n• AW Practica kl. 17–19\n\n— English —\n\nEVERY MONDAY";

  it("sätter fakta först och hoppar över dekorationen", () => {
    const r = buildPreviewDescription(
      ["måndag 14 september", "17:00 – 23:00", "Bacchi Syre"],
      beskrivning
    );
    expect(r.startsWith("måndag 14 september · 17:00 – 23:00 · Bacchi Syre")).toBe(true);
    expect(r).toContain("VARJE MÅNDAG");
  });

  it("tar aldrig med den engelska halvan", () => {
    expect(buildPreviewDescription([], beskrivning)).not.toContain("EVERY MONDAY");
  });

  it("hoppar över tomma fakta", () => {
    expect(buildPreviewDescription([null, "Stockholm", ""], null)).toBe("Stockholm");
  });

  it("klipper vid ordgräns", () => {
    const r = buildPreviewDescription([], "ett ord ".repeat(60), 40);
    expect(r.length).toBeLessThanOrEqual(41);
    expect(r.endsWith("…")).toBe(true);
    expect(r).not.toMatch(/\wo…$/);
  });
});
