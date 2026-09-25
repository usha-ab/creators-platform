import type { Metadata } from "next";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getTranslations } from "next-intl/server";
import { Gift, MousePointerClick, UserPlus, Ticket, Coins, Crown } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureReferralCode } from "@/lib/affiliate/attribution";
import { summarizeRewards, COMMISSION_SHARE, FIRST_PURCHASE_CREDIT_ORE, PREMIUM_DAYS_PER_CREATOR } from "@/lib/affiliate/rewards";
import { PartnerLinkCard } from "./partner-link-card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("partner");
  return { title: t("metaTitle") };
}

// Partnersidan: din länk, vad den gett, och vad programmet lovar. Länken
// fungerar på alla sidor (middleware sätter cookien), så den som delar The Lab
// delar samtidigt sin partnerkod.
export default async function PartnerPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/app/partner");

  const t = await getTranslations("partner");
  const admin = createAdminClient();
  const code = await ensureReferralCode(admin, user.id);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://usha.se";
  const link = code ? `${appUrl}/?ref=${code}` : appUrl;
  const exampleLink = code ? `${appUrl}/event/the-lab-tarraxo-urban-kizomba?ref=${code}` : null;

  const [{ data: clicks }, { count: signups }, { count: purchases }, { data: rewards }] = await Promise.all([
    code ? admin.from("referral_clicks").select("count").eq("code", code) : Promise.resolve({ data: [] as { count: number }[] }),
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("referred_by", user.id),
    admin.from("bookings").select("id", { count: "exact", head: true }).eq("referred_by", user.id),
    admin
      .from("affiliate_rewards")
      .select("id, kind, amount_ore, premium_days, status, note, created_at")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const clickCount = (clicks ?? []).reduce((a, r) => a + (r.count ?? 0), 0);
  const sum = summarizeRewards(rewards ?? []);
  const qr = await QRCode.toDataURL(link, { width: 220, margin: 1, color: { dark: "#0a0a0b", light: "#ffffff" } });
  const kr = (ore: number) => Math.round(ore / 100);

  const stats = [
    { icon: MousePointerClick, label: t("statClicks"), value: String(clickCount) },
    { icon: UserPlus, label: t("statSignups"), value: String(signups ?? 0) },
    { icon: Ticket, label: t("statPurchases"), value: String(purchases ?? 0) },
    { icon: Coins, label: t("statEarned"), value: t("kr", { amount: kr(sum.earnedOre) }) },
    { icon: Coins, label: t("statPaid"), value: t("kr", { amount: kr(sum.paidOre) }) },
    { icon: Crown, label: t("statPremium"), value: t("days", { count: sum.premiumDays }) },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="flex items-center gap-2 text-2xl font-bold">
        <Gift size={22} className="text-[var(--usha-gold)]" />
        {t("title")}
      </h1>
      <p className="mt-1 text-sm text-[var(--usha-muted)]">{t("intro", { share: Math.round(COMMISSION_SHARE * 100) })}</p>

      <section className="mt-6 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--usha-muted)]">{t("yourLink")}</h2>
        <div className="mt-3">
          <PartnerLinkCard
            link={link}
            labels={{ copy: t("copy"), copied: t("copied"), share: t("share"), shareTitle: t("shareTitle"), shareText: t("shareText") }}
          />
        </div>
        <p className="mt-3 text-xs text-[var(--usha-muted)]">{t("linkHint")}</p>
        {exampleLink && <p className="mt-1 break-all text-xs text-[var(--usha-muted)]">{exampleLink}</p>}
        <div className="mt-4 flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="" width={110} height={110} className="rounded-lg bg-white p-1" />
          <p className="text-xs text-[var(--usha-muted)]">{t("qrHint")}</p>
        </div>
      </section>

      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4">
            <div className="flex items-center gap-2 text-xs text-[var(--usha-muted)]"><Icon size={13} />{label}</div>
            <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
          </div>
        ))}
      </section>

      <section className="mt-6 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--usha-muted)]">{t("termsHeading")}</h2>
        <ul className="mt-3 space-y-2 text-sm">
          <li>• {t("terms1", { share: Math.round(COMMISSION_SHARE * 100) })}</li>
          <li>• {t("terms2", { days: PREMIUM_DAYS_PER_CREATOR })}</li>
          <li>• {t("terms3", { amount: kr(FIRST_PURCHASE_CREDIT_ORE) })}</li>
          <li>• {t("terms4")}</li>
          <li>• {t("terms5")}</li>
        </ul>
        <p className="mt-3 text-xs text-[var(--usha-muted)]">{t("payoutNote")}</p>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--usha-muted)]">{t("rewardsHeading")}</h2>
        {(rewards ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-[var(--usha-muted)]">{t("rewardsEmpty")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--usha-border)] rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)]">
            {(rewards ?? []).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{t(`kind.${r.kind}`)}</p>
                  <p className="truncate text-xs text-[var(--usha-muted)]">
                    {new Date(r.created_at).toLocaleDateString("sv-SE")} · {t(`status.${r.status}`)}
                  </p>
                </div>
                <p className="shrink-0 font-semibold tabular-nums">
                  {r.kind === "premium_days" ? t("days", { count: r.premium_days }) : t("kr", { amount: kr(r.amount_ore) })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
