import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import {
  ShieldCheck,
  CalendarCheck,
  SlidersHorizontal,
  Inbox,
  Users,
  Store,
  Mail,
  FileSignature,
  ArrowRight,
  BookOpen,
} from "lucide-react";
import { SiteNav } from "@/components/landing/site-nav";
import { PerspectiveHero } from "@/components/landing/perspective-hero";
import { LoopSection } from "@/components/landing/loop-section";
import { PerspectiveLinks } from "@/components/landing/perspective-links";
import { Trust } from "@/components/landing/trust";
import { Footer } from "@/components/landing/footer";
import { Faq } from "@/components/landing/faq";
import { RedirectIfAuthed } from "@/components/landing/redirect-if-authed";

/**
 * Sidan för lokaler. Den ska svara på det en lokal undrar innan den hör av
 * sig: hur det går till, vad lokalen själv bestämmer över, vad det kostar och
 * vem som gjort det förut.
 *
 * Bara det som finns byggt står här. Bokning av tider, övernattning och
 * agenturen hör inte till det en lokal får, och nämns därför inte.
 *
 * KOSTNADEN finns i en enda version: profilen är gratis, den som säljer
 * betalar 3,5 % + 3,50 kr per biljett. Lokalens del i övrigt står i avtalet
 * med varje lokal (beslut Pablo 2026-11-24) — ingen standardandel.
 *
 * UTBETALNINGEN: settlement-payouts körs en gång per dygn med
 * payout_delay_days = 1, och överföringarna är skarpa (rader med status paid
 * i event_settlement_payouts). Ändras det ska texten payout ändras med.
 */

const CONTACT_EMAIL = "pablo.acosta@usha.se";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("forVenues");
  const title = t("meta.title");
  const description = t("meta.description");
  return {
    title,
    description,
    alternates: { canonical: "/for-platser" },
    openGraph: { title, description, url: "https://usha.se/for-platser", type: "website", locale: "sv_SE", siteName: "Usha Platform" },
  };
}

function SectionHeading({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-8 text-center sm:mb-10">
      <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
      {sub && <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-[var(--usha-muted)] sm:text-base">{sub}</p>}
    </div>
  );
}

function VenueValues() {
  const t = useTranslations("forVenues.values");
  const items = [
    { icon: ShieldCheck, title: t("one"), desc: t("oneDesc") },
    { icon: SlidersHorizontal, title: t("two"), desc: t("twoDesc") },
    { icon: CalendarCheck, title: t("three"), desc: t("threeDesc") },
  ];
  return (
    <section className="relative py-12 px-4 sm:py-16 sm:px-6">
      <div className="mx-auto grid grid-cols-1 max-w-4xl gap-6 sm:grid-cols-3">
        {items.map((it) => (
          <div key={it.title} className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--usha-gold)]/20 to-[var(--usha-accent)]/20">
              <it.icon size={20} className="text-[var(--usha-gold)]" />
            </div>
            <h3 className="mb-2 font-semibold">{it.title}</h3>
            <p className="text-sm leading-relaxed text-[var(--usha-muted)]">{it.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const t = useTranslations("forVenues.steps");
  const steps = [1, 2, 3, 4, 5];
  return (
    <section className="relative py-12 px-4 sm:py-16 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <SectionHeading title={t("title")} />
        <ol className="space-y-4">
          {steps.map((n) => (
            <li key={n} className="flex gap-4 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--usha-gold)]/15 text-sm font-bold text-[var(--usha-gold)]">
                {n}
              </span>
              <div>
                <h3 className="font-semibold">{t(`s${n}Title`)}</h3>
                <p className="mt-1 text-sm leading-relaxed text-[var(--usha-muted)]">{t(`s${n}Body`)}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Control() {
  const t = useTranslations("forVenues.control");
  const items = [
    { icon: Inbox, key: "approval" },
    { icon: Users, key: "team" },
    { icon: Store, key: "page" },
    { icon: Mail, key: "followers" },
  ];
  return (
    <section className="relative py-12 px-4 sm:py-16 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <SectionHeading title={t("title")} sub={t("sub")} />
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {items.map((it) => (
            <div key={it.key} className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--usha-gold)]/20 to-[var(--usha-accent)]/20">
                <it.icon size={20} className="text-[var(--usha-gold)]" />
              </div>
              <h3 className="mb-2 font-semibold">{t(`${it.key}Title`)}</h3>
              <p className="text-sm leading-relaxed text-[var(--usha-muted)]">{t(`${it.key}Body`)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CostAndAgreement() {
  const t = useTranslations("forVenues.cost");
  return (
    <section className="relative py-12 px-4 sm:py-16 sm:px-6">
      <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-[var(--usha-gold)]/30 bg-[var(--usha-card)] p-6">
          <h2 className="mb-3 text-xl font-bold">{t("title")}</h2>
          <p className="text-3xl font-extrabold text-[var(--usha-gold)]">{t("free")}</p>
          <p className="mt-1 text-sm text-[var(--usha-muted)]">{t("freeSub")}</p>
          <p className="mt-4 text-sm leading-relaxed">{t("fee")}</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--usha-muted)]">{t("freeEvents")}</p>
        </div>
        <div className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6">
          <div className="mb-3 flex items-center gap-2">
            <FileSignature size={18} className="text-[var(--usha-gold)]" />
            <h2 className="text-xl font-bold">{t("agreementTitle")}</h2>
          </div>
          <p className="text-sm leading-relaxed">{t("agreementBody")}</p>
          <p className="mt-3 text-sm leading-relaxed text-[var(--usha-muted)]">{t("payout")}</p>
          <p className="mt-3 text-sm leading-relaxed text-[var(--usha-muted)]">{t("payee")}</p>
        </div>
      </div>
    </section>
  );
}

function Example() {
  const t = useTranslations("forVenues.example");
  return (
    <section className="relative py-12 px-4 sm:py-16 sm:px-6">
      <div className="mx-auto max-w-3xl rounded-2xl border border-[var(--usha-border)] bg-gradient-to-br from-[var(--usha-gold)]/5 to-[var(--usha-accent)]/5 p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--usha-gold)]">{t("eyebrow")}</p>
        <h2 className="mt-2 text-2xl font-bold">{t("title")}</h2>
        <p className="mt-3 text-sm leading-relaxed text-[var(--usha-muted)] sm:text-base">{t("body")}</p>
        <a
          href="/creators/bacchisyre"
          className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--usha-gold)] hover:underline"
        >
          {t("cta")} <ArrowRight size={14} />
        </a>
      </div>
    </section>
  );
}

function Contact() {
  const t = useTranslations("forVenues.contact");
  return (
    <section className="relative py-12 px-4 sm:py-16 sm:px-6">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("title")}</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-[var(--usha-muted)] sm:text-base">{t("body")}</p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-6 py-3 text-sm font-bold text-black transition hover:opacity-90"
          >
            <Mail size={16} /> {CONTACT_EMAIL}
          </a>
          <a
            href="/guide#lokaler"
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--usha-border)] px-6 py-3 text-sm font-semibold transition hover:border-[var(--usha-gold)]/40"
          >
            <BookOpen size={16} /> {t("guide")}
          </a>
        </div>
      </div>
    </section>
  );
}

const FAQ_COUNT = 6;

export default async function ForVenuesPage() {
  const tf = await getTranslations("forVenues.faq");
  const faqItems = Array.from({ length: FAQ_COUNT }, (_, i) => ({ q: tf(`q${i + 1}`), a: tf(`a${i + 1}`) }));
  return (
    <main>
      <RedirectIfAuthed />
      <SiteNav />
      <PerspectiveHero ns="forVenues" ctaHref="/signup?role=venue" />
      <VenueValues />
      <HowItWorks />
      <Control />
      <CostAndAgreement />
      <Example />
      <LoopSection ns="forVenues" />
      <Faq title={tf("title")} titleHighlight={tf("titleHighlight")} items={faqItems} />
      <Contact />
      <PerspectiveLinks exclude="venues" />
      <Trust />
      <Footer />
    </main>
  );
}
