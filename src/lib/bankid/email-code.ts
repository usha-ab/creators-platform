import crypto from "crypto";
import { signCookieValue, verifyCookieValue } from "@/lib/signicat/crypto";

/**
 * Sexsiffrig kod som bevisar att den som skapar ett konto med BankID äger
 * e-postadressen. Koden skickas med vårt eget mejl (Supabases utskick tillåter
 * bara två mejl i timmen för hela projektet) och lagras inte någonstans: den
 * signerade cookien bär bara en hash av kod + adress och en utgångstid.
 * Gissningar begränsas av rate limit per IP i verify-routen.
 */
export const EMAIL_CODE_COOKIE = "bankid_email_code";
export const EMAIL_CODE_TTL_MS = 10 * 60_000;

interface EmailCodePayload {
  email: string;
  codeHash: string;
  exp: number;
}

function hashCode(email: string, code: string): string {
  return crypto.createHash("sha256").update(`${email}:${code}`).digest("base64url");
}

export function normalizeEmail(raw: unknown): string | null {
  const email = String(raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

export function createEmailCode(email: string, now = Date.now()): { code: string; cookie: string } {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const payload: EmailCodePayload = { email, codeHash: hashCode(email, code), exp: now + EMAIL_CODE_TTL_MS };
  return { code, cookie: signCookieValue(payload) };
}

export type EmailCodeCheck = { ok: true; email: string } | { ok: false; reason: "missing" | "expired" | "wrong" };

export function checkEmailCode(cookie: string | undefined, code: unknown, now = Date.now()): EmailCodeCheck {
  const payload = cookie ? verifyCookieValue<EmailCodePayload>(cookie) : null;
  if (!payload) return { ok: false, reason: "missing" };
  if (now > payload.exp) return { ok: false, reason: "expired" };
  const given = String(code ?? "").replace(/\D/g, "");
  const a = Buffer.from(hashCode(payload.email, given));
  const b = Buffer.from(payload.codeHash);
  if (given.length !== 6 || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "wrong" };
  }
  return { ok: true, email: payload.email };
}
