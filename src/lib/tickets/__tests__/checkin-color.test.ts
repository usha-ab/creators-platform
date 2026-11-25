import { describe, it, expect, afterEach, vi } from "vitest";
import { CHECKIN_PALETTE, checkinColor, checkinColorWithSecret } from "../checkin-color";

const SECRET = "a".repeat(64);

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe("paletten", () => {
  it("har tolv nyanser med unika nycklar och färger", () => {
    expect(CHECKIN_PALETTE).toHaveLength(12);
    expect(new Set(CHECKIN_PALETTE.map((p) => p.key)).size).toBe(12);
    expect(new Set(CHECKIN_PALETTE.map((p) => p.bg.toLowerCase())).size).toBe(12);
  });
  it("håller kontrast 4.5:1 mellan text och bakgrund i varje nyans", () => {
    for (const p of CHECKIN_PALETTE) expect(contrast(p.bg, p.fg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("checkinColorWithSecret", () => {
  it("är stabil: samma kväll ger samma färg på biljett, kiosk och dörr", () => {
    const a = checkinColorWithSecret(SECRET, "listing-1", "2026-11-26");
    const b = checkinColorWithSecret(SECRET, "listing-1", "2026-11-26T00:00:00");
    expect(a).toEqual(b);
  });
  it("beror på hemligheten — utan den går färgen inte att räkna ut", () => {
    const hits = Array.from({ length: 40 }, (_, i) => `l-${i}`).filter(
      (id) => checkinColorWithSecret(SECRET, id, "2026-11-26").index !== checkinColorWithSecret("b".repeat(64), id, "2026-11-26").index
    );
    expect(hits.length).toBeGreaterThan(20);
  });
  it("byter färg mellan kvällar", () => {
    const colors = new Set(
      Array.from({ length: 30 }, (_, i) => checkinColorWithSecret(SECRET, "listing-1", `2026-12-${String(i + 1).padStart(2, "0")}`).index)
    );
    expect(colors.size).toBeGreaterThan(5);
  });
  it("ger alltid en färg ur paletten", () => {
    for (let i = 0; i < 200; i++) {
      const c = checkinColorWithSecret(SECRET, `x${i}`, "2026-11-26");
      expect(CHECKIN_PALETTE[c.index].bg).toBe(c.bg);
    }
  });
});

describe("checkinColor utan hemlighet", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("visar ingen färg om CHECKIN_COLOR_SECRET saknas", () => {
    vi.stubEnv("CHECKIN_COLOR_SECRET", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(checkinColor("listing-1", "2026-11-26")).toBeNull();
    warn.mockRestore();
  });
  it("behandlar en för kort hemlighet som saknad", () => {
    vi.stubEnv("CHECKIN_COLOR_SECRET", "kort");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(checkinColor("listing-1", "2026-11-26")).toBeNull();
  });
  it("ger färg när hemligheten finns", () => {
    vi.stubEnv("CHECKIN_COLOR_SECRET", SECRET);
    expect(checkinColor("listing-1", "2026-11-26")).toEqual(checkinColorWithSecret(SECRET, "listing-1", "2026-11-26"));
  });
  it("ger ingen färg utan datum", () => {
    vi.stubEnv("CHECKIN_COLOR_SECRET", SECRET);
    expect(checkinColor("listing-1", null)).toBeNull();
  });
});
