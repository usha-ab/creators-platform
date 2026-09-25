import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Music, ShieldCheck, Wallet, Calendar, GraduationCap, MapPin } from "lucide-react";
import { SiteNav } from "@/components/landing/site-nav";
import { Footer } from "@/components/landing/footer";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("taxidansarePage");
  return {
    title: t("meta.title"),
    description: t("meta.description"),
    alternates: { canonical: "/taxidansare" },
    openGraph: {
      title: t("meta.ogTitle"),
      description: t("meta.ogDescription"),
      url: "https://usha.se/taxidansare",
      type: "website",
      siteName: "Usha Platform",
    },
  };
}

export default async function TaxiDancerLandingPage() {
  const t = await getTranslations("taxidansarePage");

  return (
    <div className="min-h-screen bg-[var(--usha-black)]">
      <SiteNav />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-[var(--usha-border)]">
        <div className="mx-auto max-w-5xl px-6 pb-20 pt-28 text-center sm:pb-28 sm:pt-32">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--usha-gold)]/20 to-[var(--usha-accent)]/20">
            <Music size={28} className="text-[var(--usha-gold)]" />
          </div>
          <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
            {t("hero.titleLead")} <span className="text-gradient">{t("hero.titleHighlight")}</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-[var(--usha-muted)] sm:text-lg">
            {t("hero.body")}
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/app/search?subcategory=taxi_dancer"
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-8 py-3 text-sm font-bold text-black transition hover:opacity-90"
            >
              {t("hero.ctaFind")}
            </Link>
            <Link
              href="/signup"
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[var(--usha-border)] px-8 py-3 text-sm font-medium text-[var(--usha-white)] transition hover:border-[var(--usha-gold)]/40"
            >
              {t("hero.ctaBecome")}
            </Link>
          </div>
          <p className="mt-4 text-xs text-[var(--usha-muted)]">
            {t("hero.note")}
          </p>
        </div>
      </section>

      {/* Value props */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-center text-2xl font-bold sm:text-3xl">
          {t("value.heading")}
        </h2>
        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          <ValueCard
            icon={<Wallet size={24} className="text-[var(--usha-gold)]" />}
            title={t("value.paidTitle")}
            description={t("value.paidBody")}
          />
          <ValueCard
            icon={<ShieldCheck size={24} className="text-[var(--usha-gold)]" />}
            title={t("value.bankidTitle")}
            description={t("value.bankidBody")}
          />
          <ValueCard
            icon={<GraduationCap size={24} className="text-[var(--usha-gold)]" />}
            title={t("value.packagesTitle")}
            description={t("value.packagesBody")}
          />
        </div>
      </section>

      {/* Two paths */}
      <section className="border-t border-[var(--usha-border)] bg-[var(--usha-card)]/30">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">{t("how.heading")}</h2>

          <div className="mt-12 grid gap-8 lg:grid-cols-2">
            <div className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-8">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[var(--usha-gold)]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[var(--usha-gold)]">
                {t("how.customersBadge")}
              </div>
              <h3 className="text-xl font-bold">{t("how.customersTitle")}</h3>
              <ol className="mt-4 space-y-3 text-sm text-[var(--usha-muted)]">
                <li>
                  <span className="font-semibold text-[var(--usha-white)]">1.</span> {t("how.customersStep1")}
                </li>
                <li>
                  <span className="font-semibold text-[var(--usha-white)]">2.</span>{" "}
                  {t.rich("how.customersStep2", { em: (chunks) => <em>{chunks}</em> })}
                </li>
                <li>
                  <span className="font-semibold text-[var(--usha-white)]">3.</span> {t("how.customersStep3")}
                </li>
                <li>
                  <span className="font-semibold text-[var(--usha-white)]">4.</span> {t("how.customersStep4")}
                </li>
              </ol>
            </div>

            <div className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-8">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[var(--usha-accent)]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[var(--usha-accent)]">
                {t("how.organizersBadge")}
              </div>
              <h3 className="text-xl font-bold">{t("how.organizersTitle")}</h3>
              <ol className="mt-4 space-y-3 text-sm text-[var(--usha-muted)]">
                <li>
                  <span className="font-semibold text-[var(--usha-white)]">1.</span> {t("how.organizersStep1")}
                </li>
                <li>
                  <span className="font-semibold text-[var(--usha-white)]">2.</span> {t("how.organizersStep2")}
                </li>
                <li>
                  <span className="font-semibold text-[var(--usha-white)]">3.</span> {t("how.organizersStep3")}
                </li>
                <li>
                  <span className="font-semibold text-[var(--usha-white)]">4.</span> {t("how.organizersStep4")}
                </li>
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* For dancers */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-center text-2xl font-bold sm:text-3xl">
          {t("dancers.heading")}
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-[var(--usha-muted)]">
          {t("dancers.body")}
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <FeatureRow
            icon={<Calendar size={18} />}
            title={t("dancers.calendarTitle")}
            description={t("dancers.calendarBody")}
          />
          <FeatureRow
            icon={<MapPin size={18} />}
            title={t("dancers.qrTitle")}
            description={t("dancers.qrBody")}
          />
          <FeatureRow
            icon={<Wallet size={18} />}
            title={t("dancers.commissionTitle")}
            description={t("dancers.commissionBody")}
          />
        </div>

        <div className="mt-10 text-center">
          <Link
            href="/signup"
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-8 py-3 text-sm font-bold text-black transition hover:opacity-90"
          >
            {t("dancers.cta")}
          </Link>
        </div>
      </section>

      {/* Positioning */}
      <section className="border-t border-[var(--usha-border)] bg-[var(--usha-card)]/30">
        <div className="mx-auto max-w-3xl px-6 py-12 text-sm text-[var(--usha-muted)]">
          <h2 className="mb-3 text-base font-semibold text-[var(--usha-white)]">{t("positioning.heading")}</h2>
          <p>{t("positioning.body")}</p>
          <p className="mt-3">
            {t("positioning.readMore")}{" "}
            <Link href="/refund-policy" className="text-[var(--usha-gold)] hover:underline">
              {t("positioning.refundPolicy")}
            </Link>{" "}
            ·{" "}
            <Link href="/terms" className="text-[var(--usha-gold)] hover:underline">
              {t("positioning.terms")}
            </Link>
          </p>
        </div>
      </section>

      <Footer />
    </div>
  );
}

function ValueCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--usha-gold)]/10">
        {icon}
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-[var(--usha-muted)]">{description}</p>
    </div>
  );
}

function FeatureRow({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-5">
      <div className="mb-2 flex items-center gap-2 text-[var(--usha-gold)]">
        {icon}
        <span className="text-sm font-semibold text-[var(--usha-white)]">{title}</span>
      </div>
      <p className="text-xs text-[var(--usha-muted)]">{description}</p>
    </div>
  );
}
