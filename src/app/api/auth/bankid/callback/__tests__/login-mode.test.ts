import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const findTarget = vi.fn();
const generateLink = vi.fn();
const verifyOtp = vi.fn();
const adopt = vi.fn();

vi.mock("@/lib/signicat/client", () => ({
  getBankIdSessionResult: async () => ({
    status: "SUCCESS",
    subject: { firstName: "A", lastName: "B", name: "A B", dateOfBirth: "1990-01-01", nin: { value: "199001011234" } },
  }),
}));
vi.mock("@/lib/signicat/crypto", () => ({
  verifyCookieValue: () => ({ sessionId: "s1", role: null, subcategory: "general", mode: "login", next: "/app/events" }),
  signCookieValue: () => "signed",
  hashPersonalNumber: () => "hash",
}));
vi.mock("@/lib/bankid/login", () => ({ findBankIdLoginTarget: (...a: unknown[]) => findTarget(...a) }));
vi.mock("@/lib/bookings/adopt-guest", () => ({ adoptGuestBookings: (...a: unknown[]) => adopt(...a) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { generateLink } },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { locale: "en" } }) }) }) }),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { verifyOtp } }) }));

import { GET } from "../route";

function req() {
  return new NextRequest("https://usha.se/api/auth/bankid/callback?status=success", {
    headers: { cookie: "bankid_session=x" },
  });
}

describe("BankID-callback, inloggning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://usha.se";
  });

  it("loggar in kontot och går vidare till next", async () => {
    findTarget.mockResolvedValue({ ok: true, userId: "u1", email: "a@b.se" });
    generateLink.mockResolvedValue({ data: { properties: { hashed_token: "th" } }, error: null });
    verifyOtp.mockResolvedValue({ error: null });
    const res = await GET(req());
    expect(generateLink).toHaveBeenCalledWith({ type: "magiclink", email: "a@b.se" });
    expect(verifyOtp).toHaveBeenCalledWith({ type: "magiclink", token_hash: "th" });
    expect(adopt).toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://usha.se/app/events");
    expect(res.headers.get("location")).not.toContain("th");
  });

  it("går vidare till att skapa konto när inget konto finns", async () => {
    findTarget.mockResolvedValue({ ok: false, reason: "no_account" });
    const res = await GET(req());
    expect(res.headers.get("location")).toBe("https://usha.se/signup/bankid?next=%2Fapp%2Fevents");
    expect(res.cookies.get("bankid_verified")?.value).toBe("signed");
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("obekräftad e-post skickas tillbaka till /login", async () => {
    findTarget.mockResolvedValue({ ok: false, reason: "email_unconfirmed" });
    const res = await GET(req());
    expect(res.headers.get("location")).toBe("https://usha.se/login?bankid=email_unconfirmed");
  });

  it("felar säkert om sessionen inte kan skapas", async () => {
    findTarget.mockResolvedValue({ ok: true, userId: "u1", email: "a@b.se" });
    generateLink.mockResolvedValue({ data: { properties: { hashed_token: "th" } }, error: null });
    verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(req());
    expect(res.headers.get("location")).toBe("https://usha.se/login?bankid=error");
  });
});
