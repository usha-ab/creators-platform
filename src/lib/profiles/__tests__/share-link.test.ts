import { describe, it, expect } from "vitest";
import {
  shareTokenMatches,
  readShareToken,
  buildShareUrl,
  SHARE_TOKEN_PARAM,
  profileShareUrl,
  mayRenderQr,
} from "@/lib/profiles/share-link";

const TOKEN = "3f2b8c1a-9d4e-4f7a-b2c1-5e6d7a8b9c0d";

describe("shareTokenMatches", () => {
  it("släpper igenom rätt token", () => {
    expect(shareTokenMatches(TOKEN, TOKEN)).toBe(true);
  });

  it("är skiftlägesokänslig — uuid skrivs i båda formerna", () => {
    expect(shareTokenMatches(TOKEN.toUpperCase(), TOKEN)).toBe(true);
    expect(shareTokenMatches(TOKEN, TOKEN.toUpperCase())).toBe(true);
  });

  it("tål omgivande blanksteg från en klistrad länk", () => {
    expect(shareTokenMatches(TOKEN, `  ${TOKEN} `)).toBe(true);
  });

  it("nekar fel token", () => {
    expect(shareTokenMatches(TOKEN, "00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(shareTokenMatches(TOKEN, TOKEN.slice(0, -1))).toBe(false);
  });

  it("öppnar ALDRIG en profil utan aktiv delning", () => {
    // Den farliga varianten: saknas token på profilen får en länk utan
    // parameter inte råka matcha.
    expect(shareTokenMatches(null, null)).toBe(false);
    expect(shareTokenMatches(null, TOKEN)).toBe(false);
    expect(shareTokenMatches(TOKEN, null)).toBe(false);
    expect(shareTokenMatches(undefined, undefined)).toBe(false);
    expect(shareTokenMatches("", "")).toBe(false);
    expect(shareTokenMatches("   ", "   ")).toBe(false);
  });
});

describe("readShareToken", () => {
  it("läser parametern", () => {
    expect(readShareToken({ [SHARE_TOKEN_PARAM]: TOKEN })).toBe(TOKEN);
  });

  it("tar första värdet när parametern upprepas", () => {
    expect(readShareToken({ [SHARE_TOKEN_PARAM]: [TOKEN, "annat"] })).toBe(TOKEN);
  });

  it("ger null när den saknas", () => {
    expect(readShareToken({})).toBeNull();
    expect(readShareToken(undefined)).toBeNull();
    expect(readShareToken({ [SHARE_TOKEN_PARAM]: [] })).toBeNull();
  });
});

describe("buildShareUrl", () => {
  it("bygger länken", () => {
    expect(buildShareUrl("https://usha.se", "pablo", TOKEN)).toBe(
      `https://usha.se/creators/pablo?k=${TOKEN}`
    );
  });

  it("dubblar inte snedstrecket", () => {
    expect(buildShareUrl("https://usha.se/", "pablo", TOKEN)).toBe(
      `https://usha.se/creators/pablo?k=${TOKEN}`
    );
  });
});

describe("profileShareUrl", () => {
  it("lämnar en publik profil på sin rena adress", () => {
    expect(
      profileShareUrl("https://usha.se", "pablo", { isPublic: true, shareToken: TOKEN })
    ).toBe("https://usha.se/creators/pablo");
  });

  it("hänger på token när profilen är dold", () => {
    expect(
      profileShareUrl("https://usha.se", "pablo", { isPublic: false, shareToken: TOKEN })
    ).toBe(`https://usha.se/creators/pablo?k=${TOKEN}`);
  });

  it("ger den rena adressen när dold profil saknar token", () => {
    expect(
      profileShareUrl("https://usha.se", "pablo", { isPublic: false, shareToken: null })
    ).toBe("https://usha.se/creators/pablo");
  });
});

describe("mayRenderQr", () => {
  it("tillåter QR för publik profil", () => {
    expect(mayRenderQr({ isPublic: true, shareToken: null })).toBe(true);
  });

  it("nekar QR för dold profil — även med token", () => {
    // En QR-kod sätts upp på väggar. Bär den en hemlig nyckel är den ingen
    // hemlighet längre, så token får ALDRIG göra QR:en tillåten.
    expect(mayRenderQr({ isPublic: false, shareToken: TOKEN })).toBe(false);
    expect(mayRenderQr({ isPublic: false, shareToken: null })).toBe(false);
  });
});
