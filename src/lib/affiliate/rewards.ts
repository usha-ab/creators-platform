import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Partnerprogrammets belöningar. Ren logik här; databasen skrivs av
 * recordBookingRewards. Nivåerna är Pablos beslut 2026-09-11.
 */
export const COMMISSION_SHARE = 0.3;
/** Ushas egna event bär ingen provision – 10 % av biljettpriset räknas som Ushas intäkt. */
export const PRINCIPAL_REVENUE_RATE = 0.1;
export const FIRST_PURCHASE_CREDIT_ORE = 5000;
export const PREMIUM_DAYS_PER_CREATOR = 30;

export type PayeeFlowLike = "third_party" | "usha_principal" | string | null | undefined;

/** Ushas intäkt på ett köp – basen för partnerns andel. */
export function ushaRevenueOre(input: { flow: PayeeFlowLike; platformFeeOre: number; amountOre: number }): number {
  if (input.flow === "usha_principal") return Math.round(Math.max(0, input.amountOre) * PRINCIPAL_REVENUE_RATE);
  return Math.max(0, Math.round(input.platformFeeOre));
}

export interface RewardInput {
  profile_id: string;
  referred_profile_id: string | null;
  booking_id: string;
  kind: "credit" | "commission_share";
  amount_ore: number;
  ref: string;
  note: string;
}

export function rewardsForBooking(input: {
  bookingId: string;
  affiliateId: string;
  referredProfileId: string | null;
  ushaRevenueOre: number;
  isFirstPurchase: boolean;
}): RewardInput[] {
  const out: RewardInput[] = [];
  const share = Math.round(input.ushaRevenueOre * COMMISSION_SHARE);
  if (share > 0) {
    out.push({
      profile_id: input.affiliateId,
      referred_profile_id: input.referredProfileId,
      booking_id: input.bookingId,
      kind: "commission_share",
      amount_ore: share,
      ref: `${input.bookingId}:commission_share`,
      note: "Andel av Ushas intäkt på köpet",
    });
  }
  if (input.isFirstPurchase && input.referredProfileId) {
    out.push({
      profile_id: input.affiliateId,
      referred_profile_id: input.referredProfileId,
      booking_id: input.bookingId,
      kind: "credit",
      amount_ore: FIRST_PURCHASE_CREDIT_ORE,
      ref: `${input.bookingId}:credit`,
      note: "Värvad kund gjorde sitt första köp",
    });
  }
  return out;
}

/** Skriver belöningarna (idempotent på ref) och märker bokningen. */
export async function recordBookingRewards(
  admin: SupabaseClient,
  input: { bookingId: string; affiliateId: string; customerId: string | null; flow: PayeeFlowLike; platformFeeOre: number; amountOre: number }
): Promise<number> {
  let isFirstPurchase = false;
  if (input.customerId) {
    const { count } = await admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", input.customerId)
      .in("status", ["confirmed", "completed"])
      .neq("id", input.bookingId);
    isFirstPurchase = (count ?? 0) === 0;
  }
  const rows = rewardsForBooking({
    bookingId: input.bookingId,
    affiliateId: input.affiliateId,
    referredProfileId: input.customerId,
    ushaRevenueOre: ushaRevenueOre(input),
    isFirstPurchase,
  });
  await admin.from("bookings").update({ referred_by: input.affiliateId }).eq("id", input.bookingId);
  if (rows.length === 0) return 0;
  const { error } = await admin.from("affiliate_rewards").upsert(rows, { onConflict: "ref", ignoreDuplicates: true });
  if (error) console.error("affiliate_rewards insert failed:", error);
  return rows.length;
}

/** Återbetalat köp → belöningarna för bokningen blir void (om inte redan utbetalda). */
export async function voidRewardsForBooking(admin: SupabaseClient, bookingId: string): Promise<void> {
  await admin
    .from("affiliate_rewards")
    .update({ status: "void", note: "Köpet återbetalades" })
    .eq("booking_id", bookingId)
    .in("status", ["pending", "approved"]);
}

/** Summering för partnersidan. */
export function summarizeRewards(rows: { kind: string; amount_ore: number; premium_days: number; status: string }[]) {
  const s = { earnedOre: 0, paidOre: 0, pendingOre: 0, premiumDays: 0, voidOre: 0 };
  for (const r of rows) {
    if (r.status === "void") { s.voidOre += r.amount_ore; continue; }
    if (r.kind === "premium_days") { s.premiumDays += r.premium_days; continue; }
    s.earnedOre += r.amount_ore;
    if (r.status === "paid") s.paidOre += r.amount_ore; else s.pendingOre += r.amount_ore;
  }
  return s;
}
