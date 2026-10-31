import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyBankIdVerification } from "../apply-verification";
import type { BankIdVerifiedData } from "@/types/bankid";

function fakeAdmin(opts: { subcategory?: string | null; dup?: boolean; updateError?: string }) {
  const updates: Record<string, unknown>[] = [];
  const admin = {
    from: () => ({
      select: (cols: string) =>
        cols === "creator_subcategory"
          ? { eq: () => ({ maybeSingle: async () => ({ data: { creator_subcategory: opts.subcategory ?? null } }) }) }
          : { eq: () => ({ neq: () => ({ maybeSingle: async () => ({ data: opts.dup ? { id: "other" } : null }) }) }) },
      update: (payload: Record<string, unknown>) => {
        updates.push(payload);
        return { eq: async () => ({ error: opts.updateError ? { message: opts.updateError } : null }) };
      },
    }),
  } as unknown as SupabaseClient;
  return { admin, updates };
}

const data: BankIdVerifiedData = {
  name: "Anna Andersson",
  firstName: "Anna",
  lastName: "Andersson",
  dateOfBirth: "1990-05-01",
  hashedNin: "hash",
  verifiedAt: "2026-10-31T12:00:00Z",
  role: "venue",
  subcategory: "taxi_dancer",
};

describe("applyBankIdVerification", () => {
  it("skriver identitet och födelsedatum men aldrig rollen", async () => {
    const { admin, updates } = fakeAdmin({});
    expect(await applyBankIdVerification(admin, "u1", data)).toEqual({ ok: true });
    expect(updates).toEqual([
      {
        bankid_verified_at: data.verifiedAt,
        bankid_personal_number: "hash",
        bankid_name: "Anna Andersson",
        bankid_birth_date: "1990-05-01",
      },
    ]);
  });

  it("sätter underkategorin bara när anroparen ger den", async () => {
    const { admin, updates } = fakeAdmin({});
    await applyBankIdVerification(admin, "u1", data, { subcategory: "taxi_dancer" });
    expect(updates[0].creator_subcategory).toBe("taxi_dancer");
    expect(updates[0]).not.toHaveProperty("role");
  });

  it("nekar en minderårig som blir taxidansare via OAuth-registrering", async () => {
    const { admin, updates } = fakeAdmin({});
    const minor = { ...data, dateOfBirth: "2015-01-01" };
    expect(await applyBankIdVerification(admin, "u1", minor, { subcategory: "taxi_dancer" })).toEqual({
      ok: false,
      reason: "age_restricted",
    });
    expect(updates).toEqual([]);
  });

  it("återställer en minderårig taxidansare till general", async () => {
    const { admin, updates } = fakeAdmin({ subcategory: "taxi_dancer" });
    const minor = { ...data, dateOfBirth: "2015-01-01" };
    expect((await applyBankIdVerification(admin, "u1", minor)).ok).toBe(false);
    expect(updates).toEqual([{ creator_subcategory: "general" }]);
  });

  it("nekar ett personnummer som redan hör till ett annat konto", async () => {
    const { admin, updates } = fakeAdmin({ dup: true });
    expect(await applyBankIdVerification(admin, "u1", data)).toEqual({ ok: false, reason: "duplicate" });
    expect(updates).toEqual([]);
  });

  it("rapporterar när skrivningen misslyckas", async () => {
    const { admin } = fakeAdmin({ updateError: "boom" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await applyBankIdVerification(admin, "u1", data)).toEqual({ ok: false, reason: "update_failed" });
  });
});
