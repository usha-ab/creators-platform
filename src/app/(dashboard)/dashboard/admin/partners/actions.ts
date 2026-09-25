"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertAdmin } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyPendingRewards, runAffiliatePayouts } from "@/lib/affiliate/settle";

const PATH = "/dashboard/admin/partners";

/** Kör det dagliga jobbet nu (kredit, premium, godkännande, utgången premium). */
export async function runDailyNow() {
  await assertAdmin("partners");
  const r = await applyPendingRewards(createAdminClient());
  revalidatePath(PATH);
  redirect(`${PATH}?notice=daily&n=${r.credited + r.premiumApplied + r.approved + r.expired}`);
}

/** Kvartalsutbetalningen. Torrkörning tills SETTLEMENT_PAYOUTS_ENABLED=true. */
export async function runPayoutNow() {
  await assertAdmin("partners");
  const r = await runAffiliatePayouts(createAdminClient());
  revalidatePath(PATH);
  redirect(`${PATH}?notice=${r.live ? "payout" : "dryrun"}&n=${r.transferred + r.credited + r.dryRun}`);
}

/** Återkalla en belöning som inte betalats ut (t.ex. missbruk). */
export async function voidReward(formData: FormData) {
  await assertAdmin("partners");
  const id = (formData.get("id") as string)?.trim();
  if (id) {
    await createAdminClient()
      .from("affiliate_rewards")
      .update({ status: "void", note: "Återkallad av admin" })
      .eq("id", id)
      .in("status", ["pending", "approved"]);
  }
  revalidatePath(PATH);
  redirect(`${PATH}?notice=void`);
}

/** Godkänn en andel före ångerfönstrets slut. */
export async function approveReward(formData: FormData) {
  await assertAdmin("partners");
  const id = (formData.get("id") as string)?.trim();
  if (id) {
    await createAdminClient().from("affiliate_rewards").update({ status: "approved" }).eq("id", id).eq("status", "pending");
  }
  revalidatePath(PATH);
  redirect(`${PATH}?notice=approved`);
}
