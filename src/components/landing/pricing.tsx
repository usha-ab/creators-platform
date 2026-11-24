"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type PricingRole = "customer" | "creator" | "venue";

interface Card {
  name: string;
  desc: string;
  features: string[];
  cta: string;
}

/**
 * Prislistan är densamma överallt; `role` avgör bara vilken flik som är öppen
 * när sidan laddas, så att besökaren på /for-platser möter lokalens villkor
 * först men fortfarande kan jämföra med de andra rollerna.
 *
 * EN NIVÅ, FÖR ALLA ROLLER. Guld och Premium för kreatörer togs bort
 * 2026-11-13: ingen betalade för dem (sex konton, alla beviljade utan
 * kostnad) och nivåerna låste just det som gör Usha annorlunda — kiosken,
 * statistiken, att låta någon annan skanna. Den som säljer betalar 3,5 % +
 * 3,50 kr per biljett (#586), lokalen enligt sitt eget avtal, publiken
 * ingenting. Publik- och venue-nivåerna
 * avvecklades redan 2026-09-29 (se lib/stripe/config.ts).
 *
 * Sidan får aldrig visa ett pris som inte går att teckna, eller en förmån som
 * inte finns byggd. Står något här ska det finnas i appen.
 */
export function Pricing({ role = "creator" }: { role?: PricingRole } = {}) {
  const t = useTranslations("landing");
  const [activeRole, setActiveRole] = useState<PricingRole>(role);

  const ROLE_TABS: { key: PricingRole; label: string }[] = [
    { key: "customer", label: t("pricing.roleUser") },
    { key: "creator", label: t("pricing.roleCreator") },
    { key: "venue", label: t("pricing.roleExperience") },
  ];

  const CARDS: Record<PricingRole, Card> = {
    customer: {
      name: t("pricing.free"),
      desc: t("pricing.publikFreeDesc"),
      features: [t("pricing.publikFree1"), t("pricing.publikFree2"), t("pricing.publikFree3"), t("pricing.publikFree5")],
      cta: t("pricing.ctaFree"),
    },
    creator: {
      name: t("pricing.free"),
      desc: t("pricing.freeDesc"),
      features: [
        t("pricing.kreatorOne1"),
        t("pricing.kreatorOne2"),
        t("pricing.kreatorOne3"),
        t("pricing.kreatorOne4"),
        t("pricing.kreatorOne5"),
        t("pricing.kreatorOne6"),
        t("pricing.kreatorOne7"),
        t("pricing.kreatorOne8"),
      ],
      cta: t("pricing.ctaFree"),
    },
    venue: {
      name: t("pricing.free"),
      desc: t("pricing.upplevelseFreeDesc"),
      features: [
        t("pricing.upplevelseFree1"),
        t("pricing.upplevelseFree2"),
        t("pricing.upplevelseFree3"),
        t("pricing.upplevelseFree4"),
        t("pricing.upplevelseFree5"),
      ],
      cta: t("pricing.ctaVenue"),
    },
  };

  const card = CARDS[activeRole];

  const SUBTITLE_KEY: Record<PricingRole, string> = {
    customer: "pricing.subtitleCustomer",
    creator: "pricing.subtitle",
    venue: "pricing.subtitleVenue",
  };

  return (
    <section id="pricing" className="relative py-16 px-4 sm:py-28 sm:px-6">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="h-[400px] w-[600px] rounded-full bg-[var(--usha-accent)] opacity-[0.03] blur-[150px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-5xl">
        <div className="mb-8 text-center sm:mb-10">
          <h2 className="mb-3 text-2xl font-bold tracking-tight sm:mb-4 sm:text-3xl md:text-4xl">
            {t("pricing.title")}
          </h2>
          <p className="mx-auto max-w-xl text-sm text-[var(--usha-muted)] sm:text-base">
            {t(SUBTITLE_KEY[activeRole])}
          </p>
        </div>

        {/* Role tabs */}
        <div className="mb-8 flex justify-center sm:mb-12">
          <div className="inline-flex rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-1">
            {ROLE_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveRole(tab.key)}
                className={`rounded-lg px-3.5 py-2 text-xs font-medium transition sm:px-6 sm:py-2.5 sm:text-sm ${
                  activeRole === tab.key
                    ? "bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] text-black"
                    : "text-[var(--usha-muted)] hover:text-[var(--usha-white)]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* En ensam ruta, aldrig sträckt över tre spalter. */}
        <div className="mx-auto max-w-md">
          <div className="relative rounded-2xl border border-[var(--usha-gold)]/40 bg-[var(--usha-card)] p-5 glow-gold sm:p-8">
            <h3 className="text-xl font-bold">{card.name}</h3>
            <p className="mt-1 text-sm text-[var(--usha-muted)]">{card.desc}</p>

            <div className="my-6 flex items-baseline gap-1">
              <span className="text-4xl font-extrabold">0</span>
              <span className="text-[var(--usha-muted)]">{t("pricing.sekForever")}</span>
            </div>

            <ul className="mb-8 space-y-3">
              {card.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 text-[var(--usha-gold)]">&#10003;</span>
                  <span className="text-[var(--usha-muted)]">{f}</span>
                </li>
              ))}
            </ul>

            <a
              href="/signup"
              className="block w-full rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] py-3 text-center text-sm font-semibold text-black transition hover:opacity-90"
            >
              {card.cta}
            </a>
          </div>
        </div>

        {/* Vad rollen faktiskt betalar, i klartext under rutan. */}
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-[var(--usha-muted)]">
          {t(`pricing.footnote${activeRole === "customer" ? "Customer" : activeRole === "venue" ? "Venue" : "Creator"}`)}
        </p>
      </div>
    </section>
  );
}
