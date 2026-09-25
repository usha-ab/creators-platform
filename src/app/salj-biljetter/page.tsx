import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Check, Ticket, QrCode, Layers, Users, BellRing, Receipt, ArrowRight } from "lucide-react";
import { SiteNav } from "@/components/landing/site-nav";
import { Footer } from "@/components/landing/footer";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sellTickets");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: { canonical: "/salj-biljetter" },
    openGraph: {
      title: t("ogTitle"),
      description: t("ogDescription"),
      url: "https://usha.se/salj-biljetter",
      type: "website",
      siteName: "Usha Platform",
    },
  };
}

export default async function SellTicketsPage() {
  const t = await getTranslations("sellTickets");

  const features = [
    { icon: Ticket, title: t("f1Title"), body: t("f1Body") },
    { icon: Layers, title: t("f2Title"), body: t("f2Body") },
    { icon: Users, title: t("f3Title"), body: t("f3Body") },
    { icon: QrCode, title: t("f4Title"), body: t("f4Body") },
    { icon: BellRing, title: t("f5Title"), body: t("f5Body") },
    { icon: Receipt, title: t("f6Title"), body: t("f6Body") },
  ];
  const bullets = [t("bullet1"), t("bullet2"), t("bullet3"), t("bullet4")];
  const compare = [
    { label: t("compareServiceFeeLabel"), usha: t("compareServiceFeeUsha"), tickster: t("compareServiceFeeTickster") },
    { label: t("compareFreeLabel"), usha: t("compareFreeUsha"), tickster: t("compareFreeTickster") },
    { label: t("compareWhoLabel"), usha: t("compareWhoUsha"), tickster: t("compareWhoTickster") },
    { label: t("compareMonthlyLabel"), usha: t("compareMonthlyUsha"), tickster: t("compareMonthlyTickster") },
  ];

  return (
    <main className="bg-[var(--usha-black)] text-[var(--usha-white)]">
      <SiteNav />

      {/* Hero */}
      <section className="mx-auto max-w-3xl px-6 pt-24 pb-12 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--usha-gold)]/30 bg-[var(--usha-gold)]/10 px-3 py-1 text-xs font-medium text-[var(--usha-gold)]">
          <Ticket size={13} /> {t("badge")}
        </span>
        <h1 className="mt-5 text-4xl font-bold leading-tight sm:text-5xl">
          {t("heroLead")}<span className="text-[var(--usha-gold)]">{t("heroHighlight")}</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-[var(--usha-muted)]">
          {t.rich("heroBody", {
            b: (chunks) => <strong className="text-[var(--usha-white)]">{chunks}</strong>,
          })}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/app/events/new"
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--usha-gold)] px-5 py-3 text-sm font-semibold text-[var(--usha-black)] transition hover:opacity-90"
          >
            {t("ctaCreate")} <ArrowRight size={16} />
          </Link>
          <Link
            href="/upplevelser"
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--usha-border)] px-5 py-3 text-sm font-medium text-[var(--usha-white)] transition hover:border-[var(--usha-gold)]/40"
          >
            {t("ctaSeeLive")}
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-4xl px-6 py-10">
        <div className="grid gap-4 sm:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-5">
              <f.icon className="h-6 w-6 text-[var(--usha-gold)]" />
              <h3 className="mt-3 text-base font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--usha-muted)]">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing card */}
      <section className="mx-auto max-w-3xl px-6 py-10">
        <div className="rounded-2xl border border-[var(--usha-gold)]/30 bg-gradient-to-b from-[var(--usha-gold)]/10 to-transparent p-8 text-center">
          <p className="text-sm text-[var(--usha-muted)]">{t("pricingLabel")}</p>
          <p className="mt-2 text-5xl font-bold text-[var(--usha-gold)]">3 %</p>
          <p className="mt-2 text-sm text-[var(--usha-muted)]">{t("pricingSub")}</p>
          <ul className="mx-auto mt-6 max-w-sm space-y-2 text-left text-sm">
            {bullets.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--usha-gold)]" />
                <span className="text-[var(--usha-muted)]">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Comparison */}
      <section className="mx-auto max-w-3xl px-6 py-10">
        <h2 className="mb-5 text-center text-2xl font-bold">{t("compareTitle")}</h2>
        <div className="overflow-hidden rounded-2xl border border-[var(--usha-border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--usha-border)] bg-[var(--usha-card)]">
                <th className="px-4 py-3 text-left font-medium text-[var(--usha-muted)]"></th>
                <th className="px-4 py-3 text-left font-semibold text-[var(--usha-gold)]">Usha</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--usha-muted)]">Tickster</th>
              </tr>
            </thead>
            <tbody>
              {compare.map((row, i) => (
                <tr key={row.label} className={i % 2 ? "bg-[var(--usha-card)]/40" : ""}>
                  <td className="px-4 py-3 text-[var(--usha-muted)]">{row.label}</td>
                  <td className="px-4 py-3 font-medium text-[var(--usha-white)]">{row.usha}</td>
                  <td className="px-4 py-3 text-[var(--usha-muted)]">{row.tickster}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-center text-xs text-[var(--usha-muted)]">{t("compareNote")}</p>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-3xl px-6 py-14 text-center">
        <h2 className="text-2xl font-bold">{t("ctaTitle")}</h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-[var(--usha-muted)]">{t("ctaBody")}</p>
        <Link
          href="/signup"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[var(--usha-gold)] px-6 py-3 text-sm font-semibold text-[var(--usha-black)] transition hover:opacity-90"
        >
          {t("ctaButton")} <ArrowRight size={16} />
        </Link>
      </section>

      <Footer />
    </main>
  );
}
