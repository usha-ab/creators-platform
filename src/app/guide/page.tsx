import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import PrintButton from "./print-button";
import { indexable } from "@/lib/seo/metadata";

/**
 * Kom igång-guide för kreatörer och lokaler.
 *
 * Publik med flit: den ska gå att skicka till någon som ännu inte har konto,
 * och till en lokal som funderar. Ligger utanför /app och därför utanför
 * navigationsregistrets täckningstest — den nås via länk och från Hjälp.
 *
 * Utskriftsvänlig, eftersom guider skickas vidare som PDF. Print-reglerna
 * kastar mörkt tema och hindrar att ett steg delas av en sidbrytning.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("guide.meta");
  return { title: t("title"), description: t("description"), ...indexable("/guide") };
}

export default async function GuidePage() {
  const t = await getTranslations("guide");

  const Section = ({
    id,
    title,
    children,
  }: {
    id: string;
    title: string;
    children: React.ReactNode;
  }) => (
    <section id={id} className="mt-12 break-inside-avoid print:mt-8">
      <h2 className="mb-4 border-t border-[var(--usha-border)] pt-6 text-2xl font-bold print:border-neutral-300 print:pt-4 print:text-xl">
        {title}
      </h2>
      <div className="space-y-5">{children}</div>
    </section>
  );

  const Block = ({ title, children }: { title?: string; children: React.ReactNode }) => (
    <div className="break-inside-avoid rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-5 print:rounded-none print:border-neutral-300 print:bg-white print:p-4">
      {title && <h3 className="mb-1.5 font-semibold">{title}</h3>}
      <div className="space-y-2 text-sm leading-relaxed text-[var(--usha-muted)] print:text-neutral-700">
        {children}
      </div>
    </div>
  );

  return (
    <main className="min-h-screen bg-[var(--usha-black)] text-[var(--usha-white)] print:bg-white print:text-black">
      {/* @page och de regler Tailwind inte uttrycker. */}
      <style>{`@media print{@page{margin:18mm 16mm}html,body{background:#fff!important}}`}</style>

      <div className="mx-auto max-w-2xl px-4 py-10 print:max-w-none print:px-0 print:py-0">
        <header className="mb-10 print:mb-6">
          <h1 className="mb-3 text-3xl font-bold leading-tight print:text-2xl">{t("title")}</h1>
          <p className="text-[var(--usha-muted)] print:text-neutral-700">{t("intro")}</p>
          <div className="mt-5 print:hidden">
            <PrintButton label={t("print")} />
          </div>
        </header>

        <Section id="konto" title={t("s1.title")}>
          <p className="text-sm leading-relaxed text-[var(--usha-muted)] print:text-neutral-700">
            {t("s1.p1")}
          </p>
          <Block title={t("s1.roleTitle")}>
            <p>{t("s1.roleBody")}</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>{t("s1.creator")}</li>
              <li>{t("s1.venue")}</li>
              <li>{t("s1.customer")}</li>
            </ul>
            <p className="border-l-2 border-[var(--usha-gold)]/40 pl-3 print:border-neutral-400">
              {t("s1.roleNote")}
            </p>
          </Block>
          <Block title={t("s1.companyTitle")}>
            <p>{t("s1.companyBody")}</p>
          </Block>
        </Section>

        <Section id="verifiering" title={t("s2.title")}>
          <p className="text-sm leading-relaxed text-[var(--usha-muted)] print:text-neutral-700">{t("s2.p1")}</p>
          <p className="text-sm leading-relaxed text-[var(--usha-muted)] print:text-neutral-700">{t("s2.p2")}</p>
          <Block title={t("s2.companyTitle")}>
            <p>{t("s2.companyBody")}</p>
          </Block>
        </Section>

        <Section id="kreatorer" title={t("creators.title")}>
          <Block title={t("creators.profileTitle")}><p>{t("creators.profileBody")}</p></Block>
          <Block title={t("creators.servicesTitle")}><p>{t("creators.servicesBody")}</p></Block>
          <Block title={t("creators.calendarTitle")}><p>{t("creators.calendarBody")}</p></Block>
          <Block title={t("creators.eventsTitle")}><p>{t("creators.eventsBody")}</p></Block>
        </Section>

        <Section id="lokaler" title={t("venues.title")}>
          <Block title={t("venues.pageTitle")}><p>{t("venues.pageBody")}</p></Block>
          <Block title={t("venues.eventsTitle")}><p>{t("venues.eventsBody")}</p></Block>
          <Block title={t("venues.requestsTitle")}><p>{t("venues.requestsBody")}</p></Block>
          <Block title={t("venues.teamTitle")}>
            <p>{t("venues.teamBody")}</p>
            <p className="border-l-2 border-[var(--usha-gold)]/40 pl-3 print:border-neutral-400">
              {t("venues.teamNote")}
            </p>
          </Block>
        </Section>

        <Section id="pengar" title={t("money.title")}>
          <Block title={t("money.stripeTitle")}><p>{t("money.stripeBody")}</p></Block>
          <Block title={t("money.commissionTitle")}>
            <p>{t("money.commissionBody")}</p>
            <p className="font-medium text-[var(--usha-gold)] print:text-neutral-900">{t("money.betaNote")}</p>
          </Block>
          <Block title={t("money.payoutTitle")}><p>{t("money.payoutBody")}</p></Block>
        </Section>

        <Section id="fragor" title={t("faq.title")}>
          <dl className="space-y-4">
            {["1", "2", "3", "4", "5"].map((n) => (
              <div key={n} className="break-inside-avoid">
                <dt className="text-sm font-semibold">{t(`faq.q${n}`)}</dt>
                <dd className="mt-0.5 text-sm text-[var(--usha-muted)] print:text-neutral-700">
                  {t(`faq.a${n}`)}
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        <div className="mt-12 break-inside-avoid rounded-2xl border border-[var(--usha-gold)]/25 bg-[var(--usha-gold)]/5 p-5 print:rounded-none print:border-neutral-300 print:bg-white">
          <h3 className="mb-1.5 font-semibold">{t("help.title")}</h3>
          <p className="text-sm text-[var(--usha-muted)] print:text-neutral-700">{t("help.body")}</p>
        </div>

        <div className="mt-10 print:hidden">
          <Link
            href="/"
            className="text-sm text-[var(--usha-muted)] underline underline-offset-2 hover:text-[var(--usha-white)]"
          >
            usha.se
          </Link>
        </div>
      </div>
    </main>
  );
}
