import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findBankIdLoginTarget } from "../login";

function fakeAdmin(profile: { id: string } | null, user: { id: string; email?: string; email_confirmed_at?: string | null } | null) {
  const filters: string[] = [];
  const admin = {
    from: () => ({
      select: () => ({
        eq: (col: string) => {
          filters.push(col);
          return {
            is: (c: string) => {
              filters.push(c);
              return { maybeSingle: async () => ({ data: profile }) };
            },
          };
        },
      }),
    }),
    auth: { admin: { getUserById: async () => ({ data: { user }, error: null }) } },
  } as unknown as SupabaseClient;
  return { admin, filters };
}

describe("findBankIdLoginTarget", () => {
  it("hittar kontot på hashen och hoppar över raderade", async () => {
    const { admin, filters } = fakeAdmin({ id: "u1" }, { id: "u1", email: "a@b.se", email_confirmed_at: "2026-01-01" });
    expect(await findBankIdLoginTarget(admin, "hash")).toEqual({ ok: true, userId: "u1", email: "a@b.se", emailProven: false });
    expect(filters).toEqual(["bankid_personal_number", "deleted_at"]);
  });

  it("inget konto kopplat", async () => {
    const { admin } = fakeAdmin(null, null);
    expect(await findBankIdLoginTarget(admin, "hash")).toEqual({ ok: false, reason: "no_account" });
  });

  it("obekräftad e-post släpps inte in", async () => {
    const { admin } = fakeAdmin({ id: "u1" }, { id: "u1", email: "a@b.se", email_confirmed_at: null });
    expect(await findBankIdLoginTarget(admin, "hash")).toEqual({ ok: false, reason: "email_unconfirmed" });
  });

  it("auth-användaren saknas", async () => {
    const { admin } = fakeAdmin({ id: "u1" }, null);
    expect(await findBankIdLoginTarget(admin, "hash")).toEqual({ ok: false, reason: "no_account" });
  });
});
