import { describe, it, expect } from "vitest";
import type { User } from "@supabase/supabase-js";
import { isEmailProven } from "../email-proven";

const u = (p: Partial<User>) => ({ email: "anna@b.se", app_metadata: {}, identities: [], ...p }) as User;

describe("isEmailProven", () => {
  it("vanlig registrering med lösenord bevisar ingenting", () => {
    expect(isEmailProven(u({ identities: [{ provider: "email", identity_data: { email: "anna@b.se" } } as never] }))).toBe(false);
  });

  it("markerad adress gäller, skiftlägesokänsligt", () => {
    expect(isEmailProven(u({ app_metadata: { email_proven: "Anna@B.se" } }))).toBe(true);
  });

  it("beviset gäller inte en ny adress efter byte", () => {
    expect(isEmailProven(u({ email: "ny@b.se", app_metadata: { email_proven: "anna@b.se" } }))).toBe(false);
  });

  it("Google-verifierad adress gäller", () => {
    const g = { provider: "google", identity_data: { email: "anna@b.se", email_verified: true } } as never;
    expect(isEmailProven(u({ identities: [g] }))).toBe(true);
  });

  it("Facebook eller overifierad Google gäller inte", () => {
    const fb = { provider: "facebook", identity_data: { email: "anna@b.se", email_verified: true } } as never;
    const g = { provider: "google", identity_data: { email: "anna@b.se", email_verified: false } } as never;
    expect(isEmailProven(u({ identities: [fb, g] }))).toBe(false);
  });

  it("ingen användare eller adress", () => {
    expect(isEmailProven(null)).toBe(false);
    expect(isEmailProven(u({ email: undefined }))).toBe(false);
  });
});
