import { describe, it, expect } from "vitest";
import { isSupabaseAuthCookie, expiredCookieVariants, authCookieNamesFrom, expiredSetCookieHeader } from "../auth-cookies";

describe("auth-cookies", () => {
  it("känner igen sessionen, chunkar och PKCE-verifieraren", () => {
    expect(isSupabaseAuthCookie("sb-hiurrvorwqfihtdfhbhv-auth-token")).toBe(true);
    expect(isSupabaseAuthCookie("sb-hiurrvorwqfihtdfhbhv-auth-token.0")).toBe(true);
    expect(isSupabaseAuthCookie("sb-hiurrvorwqfihtdfhbhv-auth-token.12")).toBe(true);
    expect(isSupabaseAuthCookie("sb-hiurrvorwqfihtdfhbhv-auth-token-code-verifier")).toBe(true);
  });

  it("rör inte andra cookies", () => {
    expect(isSupabaseAuthCookie("usha-theme")).toBe(false);
    expect(isSupabaseAuthCookie("NEXT_LOCALE")).toBe(false);
    expect(isSupabaseAuthCookie("sb-something-else")).toBe(false);
  });

  // Detta är hela buggen: samma namn två gånger, med olika domän. Den gamla
  // host-only-cookien skuggade den nya och gick inte att radera med domän satt.
  it("slår ihop dubbletter så båda varianterna raderas en gång var", () => {
    const names = authCookieNamesFrom(
      "sb-x-auth-token=OLD; usha-theme=dark; sb-x-auth-token=NEW; sb-x-auth-token.0=chunk"
    );
    expect(names).toEqual(["sb-x-auth-token", "sb-x-auth-token.0"]);
  });

  it("skriver ut en cookie både utan och med domän när domän är konfigurerad", () => {
    expect(expiredCookieVariants("sb-x-auth-token", ".usha.se")).toEqual([
      { name: "sb-x-auth-token" },
      { name: "sb-x-auth-token", domain: ".usha.se" },
    ]);
  });

  it("nöjer sig med host-only när ingen domän är konfigurerad", () => {
    expect(expiredCookieVariants("sb-x-auth-token", undefined)).toEqual([{ name: "sb-x-auth-token" }]);
  });

  it("serialiserar en raderande Set-Cookie-rad med och utan domän", () => {
    expect(expiredSetCookieHeader("sb-x-auth-token")).toBe("sb-x-auth-token=; Path=/; Max-Age=0; SameSite=Lax");
    expect(expiredSetCookieHeader("sb-x-auth-token", ".usha.se")).toBe(
      "sb-x-auth-token=; Path=/; Max-Age=0; SameSite=Lax; Domain=.usha.se"
    );
  });
});
