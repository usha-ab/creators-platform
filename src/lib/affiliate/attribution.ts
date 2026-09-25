import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Attribuering i partnerprogrammet.
 *
 * Länken `usha.se/…?ref=KOD` sätter en cookie (middleware). Vid registrering
 * knyts kontot till partnern – en gång, server-side, bara inom minuterna efter
 * att kontot skapades (samma skydd som pending_role). Köp knyts till partnern
 * via kontot (12 månader från värvningen) eller, för gäster, via cookien.
 */
export const REF_COOKIE = "usha_ref";
export const REF_COOKIE_MAX_AGE = 90 * 24 * 60 * 60;
export const ATTRIBUTION_WINDOW_DAYS = 365;
const FRESH_SIGNUP_MS = 10 * 60_000;

export function normalizeRefCode(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(v) ? v : null;
}

/** Kontot skapades nyss – bara då får en klientstyrd cookie påverka det. */
export function isFreshSignup(createdAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) && now.getTime() - t < FRESH_SIGNUP_MS;
}

/** Ligger köpet inom partnerns fönster räknat från värvningen? */
export function withinAttributionWindow(referredAt: string | null | undefined, at: Date = new Date()): boolean {
  if (!referredAt) return false;
  const t = new Date(referredAt).getTime();
  return Number.isFinite(t) && at.getTime() - t <= ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

export async function findAffiliateByCode(admin: SupabaseClient, code: string): Promise<string | null> {
  const norm = normalizeRefCode(code);
  if (!norm) return null;
  const { data } = await admin.from("profiles").select("id").eq("referral_code", norm).maybeSingle();
  return data?.id ?? null;
}

/**
 * Knyter ett nyskapat konto till partnern. Atomiskt (bara raden där
 * referred_by är null vinner), aldrig till sig själv, bara vid färsk registrering.
 */
export async function claimReferral(
  admin: SupabaseClient,
  input: { userId: string; code: string | null | undefined; createdAt: string | null | undefined }
): Promise<string | null> {
  if (!input.code || !isFreshSignup(input.createdAt)) return null;
  const affiliateId = await findAffiliateByCode(admin, input.code);
  if (!affiliateId || affiliateId === input.userId) return null;
  const { data } = await admin
    .from("profiles")
    .update({ referred_by: affiliateId, referred_at: new Date().toISOString() })
    .eq("id", input.userId)
    .is("referred_by", null)
    .select("id")
    .maybeSingle();
  return data ? affiliateId : null;
}

/**
 * Partnern bakom ett köp: kontots värvare inom fönstret, annars cookien
 * (gäster). En partner får aldrig andel på sina egna köp.
 */
export async function affiliateForPurchase(
  admin: SupabaseClient,
  input: { userId: string | null; refCookie: string | null | undefined; now?: Date }
): Promise<string | null> {
  if (input.userId) {
    const { data } = await admin
      .from("profiles")
      .select("referred_by, referred_at")
      .eq("id", input.userId)
      .maybeSingle();
    if (data?.referred_by && withinAttributionWindow(data.referred_at, input.now)) return data.referred_by;
  }
  const code = normalizeRefCode(input.refCookie);
  if (!code) return null;
  const affiliateId = await findAffiliateByCode(admin, code);
  return affiliateId && affiliateId !== input.userId ? affiliateId : null;
}

/** Ser till att profilen har en kod (mintas lat, som förut). */
export async function ensureReferralCode(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await admin.from("profiles").select("referral_code").eq("id", userId).maybeSingle();
  if (data?.referral_code) return data.referral_code;
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 5; attempt++) {
    let code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    const { error } = await admin.from("profiles").update({ referral_code: code }).eq("id", userId);
    if (!error) return code;
  }
  return null;
}
