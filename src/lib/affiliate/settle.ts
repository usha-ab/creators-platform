import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripe } from "@/lib/stripe/client";
import { payoutBlockedReason, payoutsEnabled } from "@/lib/settlements/payout";

/**
 * Partnerprogram, del B: från ledgerrad till något man har.
 *
 * - Kredit: pending → credit_ledger (+) → paid. Direkt.
 * - Premium-tid: pending → premium_grants + profiles.tier = premium → paid. Direkt.
 *   Återställs av expirePremiumGrants när tiden gått ut (om inget abonnemang).
 * - Andel av intäkt: pending → approved efter ångerfönstret (14 dagar) →
 *   kvartalsvis utbetalning: Stripe-transfer till bolag från 200 kr, annars
 *   kredit. Under SETTLEMENT_PAYOUTS_ENABLED=false skrivs dry_run i stället.
 */
export const APPROVAL_DELAY_DAYS = 14;
export const PAYOUT_MIN_ORE = 20000;

const DAY_MS = 86_400_000;

export function quarterLabel(d: Date): string {
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

/** Föregående kvartal – det som betalas ut. */
export function previousQuarterLabel(now: Date): string {
  const q = Math.floor(now.getUTCMonth() / 3);
  return q === 0 ? `${now.getUTCFullYear() - 1}-Q4` : `${now.getUTCFullYear()}-Q${q}`;
}

export type PayoutRoute = "transfer" | "credit";

/** Kontant bara till bolag med fungerande Stripe-konto och över gränsen. */
export function payoutRouteFor(input: {
  sumOre: number;
  profile: { id?: string; company_verified_at: string | null; stripe_account_id: string | null; stripe_charges_enabled: boolean | null } | null;
}): PayoutRoute {
  if (input.sumOre < PAYOUT_MIN_ORE) return "credit";
  const p = input.profile ? { id: input.profile.id ?? "", ...input.profile } : null;
  return payoutBlockedReason(p) ? "credit" : "transfer";
}

export interface SettleResult {
  credited: number;
  premiumApplied: number;
  approved: number;
  expired: number;
}

export async function applyPendingRewards(admin: SupabaseClient, now: Date = new Date()): Promise<SettleResult> {
  const r: SettleResult = { credited: 0, premiumApplied: 0, approved: 0, expired: 0 };
  const { data: pending } = await admin
    .from("affiliate_rewards")
    .select("id, profile_id, kind, amount_ore, premium_days, ref, created_at")
    .eq("status", "pending")
    .limit(500);

  for (const rw of pending ?? []) {
    if (rw.kind === "credit" && rw.amount_ore > 0) {
      const { error } = await admin
        .from("credit_ledger")
        .upsert({ profile_id: rw.profile_id, delta_ore: rw.amount_ore, reason: "affiliate", ref: rw.ref }, { onConflict: "ref", ignoreDuplicates: true });
      if (!error) {
        await admin.from("affiliate_rewards").update({ status: "paid", paid_at: now.toISOString(), payout_ref: "credit_ledger" }).eq("id", rw.id);
        r.credited++;
      }
    } else if (rw.kind === "premium_days" && rw.premium_days > 0) {
      const { data: profile } = await admin.from("profiles").select("tier").eq("id", rw.profile_id).maybeSingle();
      const ends = new Date(now.getTime() + rw.premium_days * DAY_MS).toISOString();
      const { error } = await admin
        .from("premium_grants")
        .upsert(
          { profile_id: rw.profile_id, days: rw.premium_days, source: "affiliate", ref: rw.ref, starts_at: now.toISOString(), ends_at: ends, tier_before: profile?.tier ?? "gratis" },
          { onConflict: "ref", ignoreDuplicates: true }
        );
      if (!error) {
        if (profile?.tier !== "premium") await admin.from("profiles").update({ tier: "premium" }).eq("id", rw.profile_id);
        await admin.from("affiliate_rewards").update({ status: "paid", paid_at: now.toISOString(), payout_ref: "premium_grant" }).eq("id", rw.id);
        r.premiumApplied++;
      }
    } else if (rw.kind === "commission_share") {
      if (now.getTime() - new Date(rw.created_at).getTime() >= APPROVAL_DELAY_DAYS * DAY_MS) {
        await admin.from("affiliate_rewards").update({ status: "approved" }).eq("id", rw.id).eq("status", "pending");
        r.approved++;
      }
    }
  }

  // Premium som gått ut: tillbaka till nivån innan, om inget abonnemang tagit över.
  const { data: expiredGrants } = await admin
    .from("premium_grants")
    .select("id, profile_id, tier_before")
    .is("reverted_at", null)
    .lt("ends_at", now.toISOString())
    .limit(200);
  for (const g of expiredGrants ?? []) {
    const { data: stillActive } = await admin
      .from("premium_grants")
      .select("id")
      .eq("profile_id", g.profile_id)
      .is("reverted_at", null)
      .gte("ends_at", now.toISOString())
      .limit(1);
    const { data: sub } = await admin
      .from("subscriptions")
      .select("id")
      .eq("user_id", g.profile_id)
      .in("status", ["active", "trialing"])
      .limit(1);
    if (!(stillActive ?? []).length && !(sub ?? []).length) {
      await admin.from("profiles").update({ tier: g.tier_before ?? "gratis" }).eq("id", g.profile_id);
    }
    await admin.from("premium_grants").update({ reverted_at: now.toISOString() }).eq("id", g.id);
    r.expired++;
  }
  return r;
}

export interface PayoutRunResult {
  period: string;
  live: boolean;
  transferred: number;
  credited: number;
  dryRun: number;
  failed: { profileId: string; error: string }[];
  totalOre: number;
}

/**
 * Kvartalsvis utbetalning av godkända andelar. En rad per partner och period
 * skrivs FÖRE överföringen (unik nyckel = dubbelbetalningslåset), samma mönster
 * som event_settlement_payouts.
 */
export async function runAffiliatePayouts(admin: SupabaseClient, now: Date = new Date()): Promise<PayoutRunResult> {
  const period = previousQuarterLabel(now);
  const live = payoutsEnabled();
  const result: PayoutRunResult = { period, live, transferred: 0, credited: 0, dryRun: 0, failed: [], totalOre: 0 };

  const { data: approved } = await admin
    .from("affiliate_rewards")
    .select("id, profile_id, amount_ore")
    .eq("status", "approved")
    .eq("kind", "commission_share");
  const byProfile = new Map<string, { sum: number; ids: string[] }>();
  for (const rw of approved ?? []) {
    const e = byProfile.get(rw.profile_id) ?? { sum: 0, ids: [] };
    e.sum += rw.amount_ore; e.ids.push(rw.id);
    byProfile.set(rw.profile_id, e);
  }

  for (const [profileId, { sum, ids }] of byProfile) {
    if (sum <= 0) continue;
    const { data: profile } = await admin
      .from("profiles")
      .select("company_verified_at, stripe_account_id, stripe_charges_enabled")
      .eq("id", profileId)
      .maybeSingle();
    const route = payoutRouteFor({ sumOre: sum, profile: profile ?? null });
    const payoutRef = `affiliate_payout:${period}:${profileId}`;

    if (route === "credit") {
      const { error } = await admin
        .from("credit_ledger")
        .upsert({ profile_id: profileId, delta_ore: sum, reason: "affiliate_payout", ref: payoutRef }, { onConflict: "ref", ignoreDuplicates: true });
      if (error) { result.failed.push({ profileId, error: error.message }); continue; }
      await admin.from("affiliate_payouts").upsert({ profile_id: profileId, period, amount_ore: sum, status: "credited", paid_at: now.toISOString() }, { onConflict: "profile_id,period", ignoreDuplicates: true });
      await admin.from("affiliate_rewards").update({ status: "paid", paid_at: now.toISOString(), payout_ref: payoutRef }).in("id", ids);
      result.credited++; result.totalOre += sum;
      continue;
    }

    const { error: insErr } = await admin
      .from("affiliate_payouts")
      .insert({ profile_id: profileId, period, amount_ore: sum, status: live ? "paid" : "dry_run" });
    if (insErr) {
      if (insErr.code !== "23505") result.failed.push({ profileId, error: insErr.message });
      continue;
    }
    if (!live) { result.dryRun++; result.totalOre += sum; continue; }

    try {
      const stripe = getStripe();
      const group = `affiliate_${period}_${profileId}`;
      const prior = await stripe.transfers.list({ transfer_group: group, limit: 1 });
      const transfer =
        prior.data[0] ??
        (await stripe.transfers.create(
          { amount: sum, currency: "sek", destination: profile!.stripe_account_id!, transfer_group: group, description: `Usha Partner ${period}`, metadata: { period, profile_id: profileId } },
          { idempotencyKey: group }
        ));
      await admin.from("affiliate_payouts").update({ stripe_transfer_id: transfer.id, paid_at: now.toISOString() }).eq("profile_id", profileId).eq("period", period);
      await admin.from("affiliate_rewards").update({ status: "paid", paid_at: now.toISOString(), payout_ref: transfer.id }).in("id", ids);
      result.transferred++; result.totalOre += sum;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await admin.from("affiliate_payouts").update({ status: "failed", error: msg }).eq("profile_id", profileId).eq("period", period);
      result.failed.push({ profileId, error: msg });
    }
  }
  return result;
}
