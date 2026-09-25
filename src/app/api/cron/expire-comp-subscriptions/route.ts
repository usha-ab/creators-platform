import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { createClient } from "@supabase/supabase-js";
import { isCompGrant, hasExpired } from "@/lib/subscription/comp";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Nedgradering av gratis nivåer som gått ut.
 *
 * Betanivåer delades ut utan betalning och med slutdatum 2099-12-31. Eftersom
 * raderna bär påhittade Stripe-id kan ingen webhook röra dem — de skulle alltså
 * löpa vidare efter betan utan att någon aktivt valt att betala.
 *
 * Jobbet faller tillbaka på gratis. Det rör ALDRIG ett äkta Stripe-abonnemang:
 * den som själv tecknat Guld eller Premium behåller det, och deras livscykel
 * sköts av webhooken som förut.
 *
 * Idempotent: raden sätts till "expired" och plockas därför inte upp igen.
 */
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = admin();
  const now = new Date();

  // Betans slutdatum bor i app_config så det kan sättas en gång, utan deploy.
  const { data: cfg } = await db
    .from("app_config")
    .select("value")
    .eq("key", "beta_ends_at")
    .maybeSingle();
  const raw = (cfg?.value as { date?: string } | string | null) ?? null;
  const betaRaw = typeof raw === "string" ? raw : raw?.date ?? null;
  const betaEndsAt = betaRaw ? new Date(betaRaw) : null;

  const { data: subs, error } = await db
    .from("subscriptions")
    .select("id, user_id, plan, status, current_period_end, stripe_subscription_id")
    .eq("status", "active");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const attExpirera = (subs ?? []).filter(
    (s) => isCompGrant(s) && hasExpired(s, now, betaEndsAt)
  );

  const nedgraderade: string[] = [];
  for (const s of attExpirera) {
    // Ordningen spelar roll: nivån på profilen är det som styr provision och
    // behörighet. Faller något emellan ska hellre abonnemanget stå kvar som
    // aktivt än att en betald nivå ligger kvar på en profil utan täckning.
    const { error: profErr } = await db
      .from("profiles")
      .update({ tier: "gratis" })
      .eq("id", s.user_id);
    if (profErr) {
      console.error("expire-comp: kunde inte nedgradera profil", s.user_id, profErr);
      continue;
    }
    const { error: subErr } = await db
      .from("subscriptions")
      .update({ status: "expired" })
      .eq("id", s.id);
    if (subErr) {
      console.error("expire-comp: profilen nedgraderad men raden kvar", s.id, subErr);
      continue;
    }
    nedgraderade.push(s.user_id);
  }

  return NextResponse.json({
    ok: true,
    betaEndsAt: betaEndsAt?.toISOString() ?? null,
    granskade: subs?.length ?? 0,
    nedgraderade: nedgraderade.length,
    userIds: nedgraderade,
  });
}
