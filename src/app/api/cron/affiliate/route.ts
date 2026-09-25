import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyPendingRewards, runAffiliatePayouts } from "@/lib/affiliate/settle";

/**
 * Cron: partnerprogrammets dagliga jobb (kredit, premium-tid, godkännande,
 * utgångna premiumperioder). Med ?task=payout körs kvartalsutbetalningen –
 * dry_run tills SETTLEMENT_PAYOUTS_ENABLED=true, som avräkningen.
 */
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  try {
    if (req.nextUrl.searchParams.get("task") === "payout") {
      const result = await runAffiliatePayouts(admin);
      console.log(`[affiliate] payout ${result.period} live=${result.live} transfer=${result.transferred} credit=${result.credited} dry=${result.dryRun} failed=${result.failed.length} sum=${(result.totalOre / 100).toFixed(2)} kr`);
      return NextResponse.json(result);
    }
    const result = await applyPendingRewards(admin);
    console.log(`[affiliate] daily credited=${result.credited} premium=${result.premiumApplied} approved=${result.approved} expired=${result.expired}`);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[affiliate] körningen kraschade:", error);
    return NextResponse.json({ error: "Affiliate run failed" }, { status: 500 });
  }
}
