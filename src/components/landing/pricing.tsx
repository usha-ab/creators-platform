"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { BETA_MODE, BETA_END_MS } from "@/lib/beta";

type PricingRole = "customer" | "creator" | "venue";

/**
 * Prislistan är densamma överallt; `role` avgör bara vilken flik som är öppen
 * när sidan laddas, så att besökaren på /for-platser möter venue-priserna
 * först men fortfarande kan jämföra med de andra rollerna.
 */
export function Pricing({ role = "creator" }: { role?: PricingRole } = {}) {
  const t = useTranslations("landing");
  const locale = useLocale();
  const [activeRole, setActiveRole] = useState<PricingRole>(role);

  const betaEndLabel = Number.isNaN(BETA_END_MS)
    ? null
    : new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "sv-SE", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date(BETA_END_MS));

  const ROLE_TABS: { key: PricingRole; label: string }[] = [
    { key: "customer", label: t("pricing.roleUser") },
    { key: "creator", label: t("pricing.roleCreator") },
    { key: "venue", label: t("pricing.roleExperience") },
  ];

  const PRICING_DATA: Record<string, { gratis: { features: string[] }; guld: { price: number; features: string[]; popular: boolean }; premium: { price: number; features: string[]; popular: boolean } }> = {
    customer: {
      gratis: {
        features: [
          t("pricing.publikFree1"),
          t("pricing.publikFree2"),
          t("pricing.publikFree3"),
        ],
      },
      guld: {
        price: 199,
        popular: true,
        features: [
          t("pricing.publikGold1"),
          t("pricing.publikGold2"),
          t("pricing.publikGold3"),
          t("pricing.publikGold4"),
        ],
      },
      premium: {
        price: 499,
        popular: false,
        features: [
          t("pricing.publikPremium1"),
          t("pricing.publikPremium2"),
          t("pricing.publikPremium3"),
          t("pricing.publikPremium4"),
        ],
      },
    },
    creator: {
      gratis: {
        features: [
          t("pricing.kreatorFree1"),
          t("pricing.kreatorFree2"),
          t("pricing.kreatorFree3"),
        ],
      },
      guld: {
        price: 299,
        popular: true,
        features: [
          t("pricing.kreatorGold1"),
          t("pricing.kreatorGold2"),
          t("pricing.kreatorGold3"),
          t("pricing.kreatorGold4"),
          t("pricing.kreatorGold5"),
        ],
      },
      premium: {
        price: 599,
        popular: false,
        features: [
          t("pricing.kreatorPremium1"),
          t("pricing.kreatorPremium2"),
          t("pricing.kreatorPremium3"),
          t("pricing.kreatorPremium4"),
          t("pricing.kreatorPremium5"),
        ],
      },
    },
    venue: {
      gratis: {
        features: [
          t("pricing.upplevelseFree1"),
          t("pricing.upplevelseFree2"),
          t("pricing.upplevelseFree3"),
        ],
      },
      guld: {
        price: 299,
        popular: true,
        features: [
          t("pricing.upplevelseGold1"),
          t("pricing.upplevelseGold2"),
          t("pricing.upplevelseGold3"),
          t("pricing.upplevelseGold4"),
        ],
      },
      premium: {
        price: 599,
        popular: false,
        features: [
          t("pricing.upplevelsePremium1"),
          t("pricing.upplevelsePremium2"),
          t("pricing.upplevelsePremium3"),
          t("pricing.upplevelsePremium4"),
          t("pricing.upplevelsePremium5"),
        ],
      },
    },
  };

  const data = PRICING_DATA[activeRole];

  // Säljarna vill veta vad de kan bygga, publiken vad de får ut av kvällen.
  const SUBTITLE_KEY: Record<PricingRole, string> = {
    customer: "pricing.subtitleCustomer",
    creator: "pricing.subtitle",
    venue: "pricing.subtitleVenue",
  };

  const isAudience = activeRole === "customer";
  const tierDesc = {
    free: isAudience ? t("pricing.publikFreeDesc") : t("pricing.freeDesc"),
    gold: isAudience ? t("pricing.publikGoldDesc") : t("pricing.goldDesc"),
    premium: isAudience ? t("pricing.publikPremiumDesc") : t("pricing.premiumDesc"),
  };

  const tiers = [
    { name: t("pricing.free"), price: 0, desc: tierDesc.free, features: data.gratis.features, cta: t("pricing.ctaFree"), popular: false },
    { name: t("pricing.gold"), price: data.guld.price, desc: tierDesc.gold, features: data.guld.features, cta: t("pricing.ctaGold"), popular: data.guld.popular },
    { name: t("pricing.premium"), price: data.premium.price, desc: tierDesc.premium, features: data.premium.features, cta: t("pricing.ctaPremium"), popular: data.premium.popular },
  ];

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
          {BETA_MODE && (
            <p className="mx-auto mt-3 max-w-lg text-sm text-[var(--usha-muted)]">
              {t("pricing.betaNotice")} <span className="font-semibold text-[var(--usha-gold)]">{t("pricing.betaHighlight")}</span>{" "}
              {betaEndLabel ? t("pricing.betaUntil", { date: betaEndLabel }) : t("pricing.betaSuffix")}
            </p>
          )}
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

        <div className="grid gap-6 lg:grid-cols-3">
          {tiers.map((plan) => (
            <div
              key={plan.name}
              className={`relative rounded-2xl border p-5 transition-all sm:p-8 ${
                plan.popular
                  ? "border-[var(--usha-gold)]/40 bg-[var(--usha-card)] glow-gold scale-[1.02]"
                  : "border-[var(--usha-border)] bg-[var(--usha-card)] hover:border-[var(--usha-gold)]/20"
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-4 py-1 text-xs font-bold text-black">
                  {t("pricing.mostPopular")}
                </div>
              )}

              <h3 className="text-xl font-bold">{plan.name}</h3>
              <p className="mt-1 text-sm text-[var(--usha-muted)]">
                {plan.desc}
              </p>

              <div className="my-6">
                {plan.price > 0 ? (
                  BETA_MODE ? (
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-extrabold text-[var(--usha-gold)]">0</span>
                      <span className="text-[var(--usha-muted)]">{t("pricing.sekMonth")}</span>
                      <span className="text-lg text-[var(--usha-muted)] line-through decoration-[var(--usha-muted)]/50">
                        {plan.price} SEK
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-extrabold">{plan.price}</span>
                      <span className="text-[var(--usha-muted)]">{t("pricing.sekMonth")}</span>
                    </div>
                  )
                ) : (
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-extrabold">0</span>
                    <span className="text-[var(--usha-muted)]">{t("pricing.sekForever")}</span>
                  </div>
                )}
                {plan.price > 0 && BETA_MODE && (
                  <p className="mt-1 text-xs text-[var(--usha-gold)]">{t("pricing.freeDuringBeta")}</p>
                )}
              </div>

              <ul className="mb-8 space-y-3">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 text-[var(--usha-gold)]">&#10003;</span>
                    <span className="text-[var(--usha-muted)]">{f}</span>
                  </li>
                ))}
              </ul>

              <a
                href="/signup"
                className={`block w-full rounded-xl py-3 text-center text-sm font-semibold transition ${
                  plan.popular
                    ? "bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] text-black hover:opacity-90"
                    : "border border-[var(--usha-border)] text-[var(--usha-white)] hover:border-[var(--usha-gold)]/30"
                }`}
              >
                {plan.cta}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
