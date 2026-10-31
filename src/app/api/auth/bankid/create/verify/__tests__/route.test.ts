import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const existingProfile = vi.fn();
const createUser = vi.fn();
const updateUserById = vi.fn(async () => ({ error: null }));
const apply = vi.fn();
const signIn = vi.fn();
const finish = vi.fn();
const claim = vi.fn();
const check = vi.fn();

const bankid = {
  name: "Anna Andersson", firstName: "Anna", lastName: "Andersson", dateOfBirth: "1990-05-01",
  hashedNin: "hash", verifiedAt: "2026-11-01T00:00:00Z", role: "customer", subcategory: "general",
};

vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ allowed: true }), getRateLimitKey: () => "k" }));
vi.mock("@/lib/signicat/crypto", () => ({ verifyCookieValue: (v: string) => (v === "good" ? bankid : null) }));
vi.mock("@/lib/bankid/email-code", () => ({ EMAIL_CODE_COOKIE: "bankid_email_code", checkEmailCode: (...a: unknown[]) => check(...a) }));
vi.mock("@/lib/bankid/apply-verification", () => ({ applyBankIdVerification: (...a: unknown[]) => apply(...a) }));
vi.mock("@/lib/bankid/session", () => ({
  signInServerSide: (...a: unknown[]) => signIn(...a),
  finishSignIn: (...a: unknown[]) => finish(...a),
}));
vi.mock("@/lib/affiliate/attribution", () => ({ REF_COOKIE: "usha_ref", claimReferral: (...a: unknown[]) => claim(...a) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ is: () => ({ maybeSingle: existingProfile }) }) }) }),
    auth: { admin: { createUser, updateUserById } },
  }),
}));

import { POST } from "../route";

function req(body: object, cookies = "bankid_verified=good; bankid_email_code=c") {
  return new NextRequest("https://usha.se/api/auth/bankid/create/verify", {
    method: "POST",
    headers: { cookie: cookies, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/bankid/create/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    check.mockReturnValue({ ok: true, email: "a@b.se" });
    existingProfile.mockResolvedValue({ data: null });
    createUser.mockResolvedValue({ data: { user: { id: "new", created_at: "2026-11-01T00:00:00Z" } }, error: null });
    apply.mockResolvedValue({ ok: true });
  });

  it("utan BankID-identifiering: 401", async () => {
    const res = await POST(req({ code: "123456" }, "bankid_email_code=c"));
    expect(res.status).toBe(401);
  });

  it("fel kod: inget konto skapas", async () => {
    check.mockReturnValue({ ok: false, reason: "wrong" });
    const res = await POST(req({ code: "000000" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("code_wrong");
    expect(createUser).not.toHaveBeenCalled();
  });

  it("ny adress: skapar konto med BankID-namnet, kopplar BankID och loggar in", async () => {
    const res = await POST(req({ code: "123456", marketingConsent: true, locale: "en", next: "/app/events" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: "/app/events", created: true });
    const arg = createUser.mock.calls[0][0];
    expect(arg).toMatchObject({ email: "a@b.se", email_confirm: true, app_metadata: { email_proven: "a@b.se" } });
    expect(arg.user_metadata).toMatchObject({ full_name: "Anna Andersson", role: "customer", marketing_consent: "true", locale: "en" });
    expect(apply).toHaveBeenCalledWith(expect.anything(), "new", bankid, { subcategory: "general" });
    expect(claim).toHaveBeenCalled();
    expect(signIn).toHaveBeenCalledWith(expect.anything(), "a@b.se");
  });

  it("befintligt konto: loggas in och får BankID, rollen rörs inte", async () => {
    existingProfile.mockResolvedValue({ data: { id: "old", bankid_personal_number: null } });
    const res = await POST(req({ code: "123456" }));
    expect((await res.json()).created).toBe(false);
    expect(createUser).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledWith(expect.anything(), "old", bankid, { subcategory: undefined });
    expect(claim).not.toHaveBeenCalled();
    expect(updateUserById).toHaveBeenCalledWith("old", { app_metadata: { email_proven: "a@b.se" } });
    expect(finish).toHaveBeenCalledWith(expect.anything(), expect.anything(), { id: "old", email: "a@b.se", emailProven: true });
  });

  it("befintligt konto med någon annans BankID: nekas", async () => {
    existingProfile.mockResolvedValue({ data: { id: "old", bankid_personal_number: "other" } });
    const res = await POST(req({ code: "123456" }));
    expect(res.status).toBe(409);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("next utanför sajten ignoreras", async () => {
    const res = await POST(req({ code: "123456", next: "//evil.com" }));
    expect((await res.json()).next).toBe("/app");
  });
});
