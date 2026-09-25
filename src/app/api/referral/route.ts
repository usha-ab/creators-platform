import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { REF_COOKIE, claimReferral, ensureReferralCode } from "@/lib/affiliate/attribution";

/**
 * POST /api/referral — called once after signup to:
 * 1. Generate a referral_code if missing
 * 2. Process referred_by_code from signup metadata
 * 3. (Välkomstpromon är borttagen – den värvade får välkomstavdraget.)
 */
export async function POST(req: NextRequest) {
  const { rateLimit, getRateLimitKey } = await import("@/lib/rate-limit");
  const rl = rateLimit(getRateLimitKey(req, "referral-process"), 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "För många försök. Försök igen senare." }, { status: 429 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Ej inloggad" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("id, referral_code, referred_by")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Profil hittades inte" }, { status: 404 });
  }

  // Koden mintas lat, som förut.
  const generatedCode = profile.referral_code ? null : await ensureReferralCode(admin, user.id);

  // Attribuering: cookien från partnerlänken (satt av middleware på vilken sida
  // som helst) eller, i andra hand, koden från registreringsformuläret. Bara
  // inom minuterna efter att kontot skapades – en senare omskrivning av
  // user_metadata ska inte kunna knyta ett gammalt konto till en partner.
  // Den värvade får det vanliga välkomstavdraget (account_credits); den gamla
  // VÄLKOMMEN-promon gick ändå inte att lösa in i biljettkassan.
  const claimedReferredBy = profile.referred_by
    ? null
    : await claimReferral(admin, {
        userId: user.id,
        code: req.cookies.get(REF_COOKIE)?.value ?? user.user_metadata?.referred_by_code,
        createdAt: user.created_at,
      });

  return NextResponse.json({
    referralCode: profile.referral_code || generatedCode,
    referredBy: profile.referred_by || claimedReferredBy || null,
  });
}


/**
 * GET /api/referral — get current user's referral info
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Ej inloggad" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("referral_code, referred_by")
    .eq("id", user.id)
    .single();

  // Count referrals
  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("referred_by", user.id);

  return NextResponse.json({
    referralCode: profile?.referral_code || null,
    referralCount: count || 0,
    referralLink: profile?.referral_code
      ? `https://usha.se/?ref=${profile.referral_code}`
      : null,
  });
}
