import { describe, it, expect } from "vitest";
import { emailFollowState, isValidEmail, normalizeEmail } from "../email-follow";

describe("följ via e-post", () => {
  it("normaliserar adressen så samma person inte blir två rader", () => {
    expect(normalizeEmail("  Anna@Example.COM ")).toBe("anna@example.com");
  });

  it("släpper bara igenom riktiga adresser", () => {
    expect(isValidEmail("anna@example.com")).toBe(true);
    expect(isValidEmail("anna@example")).toBe(false);
    expect(isValidEmail("inte en adress")).toBe(false);
  });

  it("räknar tillståndet: ingen rad, väntar, aktiv, avslutad", () => {
    expect(emailFollowState(null)).toBe("none");
    expect(emailFollowState({ confirmed_at: null, unsubscribed_at: null })).toBe("pending");
    expect(emailFollowState({ confirmed_at: "2026-09-10", unsubscribed_at: null })).toBe("active");
    // Avslutad vinner över bekräftad — ett nej efter ett ja är ett nej.
    expect(emailFollowState({ confirmed_at: "2026-09-10", unsubscribed_at: "2026-09-11" })).toBe("unsubscribed");
  });
});
