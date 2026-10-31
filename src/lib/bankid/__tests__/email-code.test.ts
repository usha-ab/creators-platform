import { describe, it, expect } from "vitest";
import { createEmailCode, checkEmailCode, normalizeEmail, EMAIL_CODE_TTL_MS } from "../email-code";

describe("e-postkod för konto med BankID", () => {
  it("rätt kod godkänns och bär adressen", () => {
    const { code, cookie } = createEmailCode("a@b.se", 1000);
    expect(code).toMatch(/^\d{6}$/);
    expect(checkEmailCode(cookie, code, 2000)).toEqual({ ok: true, email: "a@b.se" });
  });

  it("fel kod, utgången kod och saknad cookie nekas", () => {
    const { code, cookie } = createEmailCode("a@b.se", 1000);
    const wrong = code === "000000" ? "111111" : "000000";
    expect(checkEmailCode(cookie, wrong, 2000)).toEqual({ ok: false, reason: "wrong" });
    expect(checkEmailCode(cookie, code, 1000 + EMAIL_CODE_TTL_MS + 1)).toEqual({ ok: false, reason: "expired" });
    expect(checkEmailCode(undefined, code)).toEqual({ ok: false, reason: "missing" });
  });

  it("en ändrad cookie godtas inte", () => {
    const { code, cookie } = createEmailCode("a@b.se");
    const [, sig] = cookie.split(".");
    const forged = Buffer.from(JSON.stringify({ email: "x@y.se", codeHash: "h", exp: Date.now() + 1e6 })).toString("base64url");
    expect(checkEmailCode(`${forged}.${sig}`, code)).toEqual({ ok: false, reason: "missing" });
  });

  it("koden ligger inte i klartext i cookien", () => {
    const { code, cookie } = createEmailCode("a@b.se");
    expect(Buffer.from(cookie.split(".")[0], "base64url").toString()).not.toContain(code);
  });

  it("normaliserar adresser", () => {
    expect(normalizeEmail("  A@B.se ")).toBe("a@b.se");
    expect(normalizeEmail("nope")).toBeNull();
  });
});
