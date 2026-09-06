import { describe, it, expect } from "vitest";
import { normalizeEmail } from "../normalize";

describe("normalizeEmail", () => {
  it("gör versaler till gemener", () => {
    // Telefonens tangentbord storbokstaverar gärna första tecknet.
    expect(normalizeEmail("Nicolas.Asenjo@Gmail.com")).toBe("nicolas.asenjo@gmail.com");
  });

  it("tar bort blanksteg runt adressen", () => {
    expect(normalizeEmail("  anna@exempel.se ")).toBe("anna@exempel.se");
  });

  it("ger null för tomt, blanktecken och saknat värde", () => {
    // Tom sträng ska inte bli en identitet som allt annat tomt matchar mot.
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });

  it("lämnar en redan normal adress orörd", () => {
    expect(normalizeEmail("a@b.se")).toBe("a@b.se");
  });
});

describe("överlagringen", () => {
  it("en garanterat given adress ger en sträng, inte null", () => {
    // Anropare som redan validerat adressen (t.ex. väntelistan) ska slippa
    // hantera ett null som aldrig kan inträffa.
    const s: string = normalizeEmail("A@B.se");
    expect(s).toBe("a@b.se");
  });

  it("men en tom sträng ger fortfarande null i praktiken", () => {
    // Överlagringen är ett löfte till typsystemet, inte till körningen —
    // skickar någon in "" är null rätt svar och testet dokumenterar det.
    expect(normalizeEmail("" as string)).toBeNull();
  });
});
