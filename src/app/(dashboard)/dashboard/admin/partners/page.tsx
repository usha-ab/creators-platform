import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminNav } from "@/components/admin/admin-nav";
import { adminDestinationsFor } from "@/lib/navigation/registry";
import { payoutsEnabled } from "@/lib/settlements/payout";
import { runDailyNow, runPayoutNow, voidReward, approveReward } from "./actions";

/**
 * Admin: partnerprogrammet i siffror – vem som värvat vad, vad som väntar,
 * vad som betalats. Knappar för att köra jobben nu och återkalla missbruk.
 */
export default async function AdminPartnersPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; n?: string }>;
}) {
  const { notice, n } = await searchParams;
  const access = await requireAdmin("partners");
  const t = await getTranslations("adminPartners");
  const admin = createAdminClient();

  const [{ data: rewards }, { data: payouts }, { data: referred }] = await Promise.all([
    admin
      .from("affiliate_rewards")
      .select("id, profile_id, referred_profile_id, kind, amount_ore, premium_days, status, note, created_at, partner:profiles!profile_id(full_name, email)")
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("affiliate_payouts")
      .select("id, profile_id, period, amount_ore, status, stripe_transfer_id, error, created_at, partner:profiles!profile_id(full_name, email)")
      .order("created_at", { ascending: false })
      .limit(30),
    admin.from("profiles").select("referred_by").not("referred_by", "is", null),
  ]);

  type Row = NonNullable<typeof rewards>[number] & { partner: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null };
  const name = (p: Row["partner"]) => {
    const x = Array.isArray(p) ? p[0] : p;
    return x?.full_name || x?.email || "–";
  };
  const kr = (ore: number) => `${Math.round(ore / 100)} kr`;

  const totals = { pending: 0, approved: 0, paid: 0, void: 0, premiumDays: 0 };
  const perPartner = new Map<string, { name: string; earned: number; count: number }>();
  for (const r of (rewards ?? []) as Row[]) {
    if (r.kind === "premium_days") totals.premiumDays += r.premium_days;
    else if (r.status in totals) (totals as Record<string, number>)[r.status] += r.amount_ore;
    const e = perPartner.get(r.profile_id) ?? { name: name(r.partner), earned: 0, count: 0 };
    if (r.status !== "void" && r.kind !== "premium_days") e.earned += r.amount_ore;
    e.count++;
    perPartner.set(r.profile_id, e);
  }
  const referredCount = new Map<string, number>();
  for (const p of referred ?? []) referredCount.set(p.referred_by, (referredCount.get(p.referred_by) ?? 0) + 1);
  const top = [...perPartner.entries()].sort((a, b) => b[1].earned - a[1].earned).slice(0, 10);

  const notices: Record<string, string> = {
    daily: t("noticeDaily", { n: n ?? "0" }),
    payout: t("noticePayout", { n: n ?? "0" }),
    dryrun: t("noticeDryRun", { n: n ?? "0" }),
    void: t("noticeVoid"),
    approved: t("noticeApproved"),
  };

  return (
    <>
      <AdminNav paths={adminDestinationsFor(access).map((d) => d.path)} />
      <div className="mb-8">
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-[var(--usha-muted)]">{t("intro")}</p>
      </div>

      {notice && notices[notice] && (
        <div className="mb-6 rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm font-medium text-green-400">{notices[notice]}</div>
      )}

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          [t("pending"), kr(totals.pending)],
          [t("approved"), kr(totals.approved)],
          [t("paid"), kr(totals.paid)],
          [t("void"), kr(totals.void)],
          [t("premiumDays"), String(totals.premiumDays)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4">
            <p className="text-xs text-[var(--usha-muted)]">{label}</p>
            <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <div className="mb-8 flex flex-wrap gap-2">
        <form action={runDailyNow}><button className="rounded-xl border border-[var(--usha-border)] px-4 py-2 text-sm font-medium hover:border-[var(--usha-gold)]/40">{t("runDaily")}</button></form>
        <form action={runPayoutNow}><button className="rounded-xl border border-[var(--usha-border)] px-4 py-2 text-sm font-medium hover:border-[var(--usha-gold)]/40">{payoutsEnabled() ? t("runPayout") : t("runPayoutDry")}</button></form>
      </div>

      <h2 className="mb-3 text-lg font-semibold">{t("topPartners")}</h2>
      <div className="mb-8 overflow-x-auto rounded-xl border border-[var(--usha-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--usha-card)] text-left text-xs uppercase tracking-wider text-[var(--usha-muted)]">
            <tr><th className="px-4 py-2">{t("colPartner")}</th><th className="px-4 py-2">{t("colReferred")}</th><th className="px-4 py-2">{t("colRewards")}</th><th className="px-4 py-2 text-right">{t("colEarned")}</th></tr>
          </thead>
          <tbody>
            {top.length === 0 && <tr><td className="px-4 py-3 text-[var(--usha-muted)]" colSpan={4}>{t("empty")}</td></tr>}
            {top.map(([id, e]) => (
              <tr key={id} className="border-t border-[var(--usha-border)]">
                <td className="px-4 py-2">{e.name}</td>
                <td className="px-4 py-2 tabular-nums">{referredCount.get(id) ?? 0}</td>
                <td className="px-4 py-2 tabular-nums">{e.count}</td>
                <td className="px-4 py-2 text-right tabular-nums">{kr(e.earned)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-3 text-lg font-semibold">{t("latestRewards")}</h2>
      <div className="mb-8 overflow-x-auto rounded-xl border border-[var(--usha-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--usha-card)] text-left text-xs uppercase tracking-wider text-[var(--usha-muted)]">
            <tr><th className="px-4 py-2">{t("colDate")}</th><th className="px-4 py-2">{t("colPartner")}</th><th className="px-4 py-2">{t("colKind")}</th><th className="px-4 py-2 text-right">{t("colAmount")}</th><th className="px-4 py-2">{t("colStatus")}</th><th className="px-4 py-2"></th></tr>
          </thead>
          <tbody>
            {(rewards ?? []).length === 0 && <tr><td className="px-4 py-3 text-[var(--usha-muted)]" colSpan={6}>{t("empty")}</td></tr>}
            {((rewards ?? []) as Row[]).map((r) => (
              <tr key={r.id} className="border-t border-[var(--usha-border)]">
                <td className="px-4 py-2 whitespace-nowrap">{new Date(r.created_at).toLocaleDateString("sv-SE")}</td>
                <td className="px-4 py-2">{name(r.partner)}</td>
                <td className="px-4 py-2">{t(`kind_${r.kind}`)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.kind === "premium_days" ? `${r.premium_days} d` : kr(r.amount_ore)}</td>
                <td className="px-4 py-2">{t(`status_${r.status}`)}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {r.status === "pending" && r.kind === "commission_share" && (
                    <form action={approveReward} className="inline"><input type="hidden" name="id" value={r.id} /><button className="mr-2 text-xs text-[var(--usha-gold)] underline">{t("approve")}</button></form>
                  )}
                  {(r.status === "pending" || r.status === "approved") && (
                    <form action={voidReward} className="inline"><input type="hidden" name="id" value={r.id} /><button className="text-xs text-red-400 underline">{t("voidAction")}</button></form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-3 text-lg font-semibold">{t("payouts")}</h2>
      <div className="overflow-x-auto rounded-xl border border-[var(--usha-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--usha-card)] text-left text-xs uppercase tracking-wider text-[var(--usha-muted)]">
            <tr><th className="px-4 py-2">{t("colPeriod")}</th><th className="px-4 py-2">{t("colPartner")}</th><th className="px-4 py-2 text-right">{t("colAmount")}</th><th className="px-4 py-2">{t("colStatus")}</th><th className="px-4 py-2">{t("colStripe")}</th></tr>
          </thead>
          <tbody>
            {(payouts ?? []).length === 0 && <tr><td className="px-4 py-3 text-[var(--usha-muted)]" colSpan={5}>{t("empty")}</td></tr>}
            {((payouts ?? []) as unknown as (Row & { period: string; stripe_transfer_id: string | null; error: string | null })[]).map((p) => (
              <tr key={p.id} className="border-t border-[var(--usha-border)]">
                <td className="px-4 py-2">{p.period}</td>
                <td className="px-4 py-2">{name(p.partner)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{kr(p.amount_ore)}</td>
                <td className="px-4 py-2">{t(`payoutStatus_${p.status}`)}{p.error ? ` – ${p.error}` : ""}</td>
                <td className="px-4 py-2 text-xs text-[var(--usha-muted)]">{p.stripe_transfer_id ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
