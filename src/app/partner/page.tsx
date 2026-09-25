import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Link2, Coins, Crown, Gift, ShieldCheck } from "lucide-react";
import { SiteNav } from "@/components/landing/site-nav";
import { Footer } from "@/components/landing/footer";
import { createClient } from "@/lib/supabase/server";
import { COMMISSION_SHARE, FIRST_PURCHASE_CREDIT_ORE, PREMIUM_DAYS_PER_CREATOR } from "@/lib/affiliate/rewards";
import { indexable } from "@/lib/seo/metadata";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("partnerPublic");
  return {
    ...indexable("/partner"),
    title: t("metaTitle"),
    description: t("metaDescription"),
    openGraph: { title: t("metaTitle"), description: t("metaDescription"), url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://usha.se"}/partner` },
  };
}

/** Publik sida om partnerprogrammet. Inloggade skickas till sin partnersida. */
export default async function PartnerPublicPage() {
  const t = await getTranslations("partnerPublic");
  const { data: { user } } = await (await createClient()).auth.getUser();
  const cta = user ? "/app/partner" : "/signup?next=/app/partner";
  const share = Math.round(COMMISSION_SHARE * 100);
  const credit = FIRST_PURCHASE_CREDIT_ORE / 100;

  const steps = [
    { icon: Link2, title: t("step1Title"), body: t("step1Body") },
    { icon: Coins, title: t("step2Title", { share }), body: t("step2Body") },
    { icon: Crown, title: t("step3Title", { days: PREMIUM_DAYS_PER_CREATOR }), body: t("step3Body", { amount: credit }) },
  ];
  const faq = [
    [t("faq1Q"), t("faq1A")],
    [t("faq2Q"), t("faq2A")],
    [t("faq3Q"), t("faq3A")],
    [t("faq4Q"), t("faq4A")],
  ];

  return (
    <main className="bg-[var(--usha-black)] text-[var(--usha-white)]">
      <SiteNav />
      <section className="mx-auto max-w-3xl px-6 pb-12 pt-28">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--usha-gold)]"><Gift size={14} />{t("eyebrow")}</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl" style={{ textWrap: "balance" }}>{t("title", { share })}</h1>
        <p className="mt-4 max-w-2xl text-lg text-[var(--usha-muted)]">{t("intro")}</p>
        <Link href={cta} className="mt-8 inline-block rounded-2xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-8 py-4 text-base font-bold text-black transition hover:opacity-90">
          {user ? t("ctaLoggedIn") : t("cta")}
        </Link>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-6 pb-16 sm:grid-cols-3">
        {steps.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6">
            <Icon size={20} className="text-[var(--usha-gold)]" />
            <h2 className="mt-3 text-lg font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--usha-muted)]">{body}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-16">
        <h2 className="flex items-center gap-2 text-xl font-semibold"><ShieldCheck size={18} className="text-[var(--usha-gold)]" />{t("rulesHeading")}</h2>
        <ul className="mt-4 space-y-2 text-sm text-[var(--usha-muted)]">
          <li>• {t("rule1")}</li>
          <li>• {t("rule2")}</li>
          <li>• {t("rule3")}</li>
          <li>• {t("rule4")}</li>
        </ul>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-20">
        <h2 className="text-xl font-semibold">{t("faqHeading")}</h2>
        <dl className="mt-4 divide-y divide-[var(--usha-border)]">
          {faq.map(([q, a]) => (
            <div key={q} className="py-4">
              <dt className="font-medium">{q}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-[var(--usha-muted)]">{a}</dd>
            </div>
          ))}
        </dl>
        <Link href={cta} className="mt-8 inline-block rounded-2xl border border-[var(--usha-gold)]/40 px-6 py-3 text-sm font-semibold text-[var(--usha-gold)] transition hover:bg-[var(--usha-gold)]/10">
          {user ? t("ctaLoggedIn") : t("cta")}
        </Link>
      </section>
      <Footer />
    </main>
  );
}
