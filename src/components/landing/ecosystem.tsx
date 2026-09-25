"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Palette,
  Globe,
  Search,
  Star,
  BarChart3,
  Ticket,
  Store,
  Heart,
  Users,
  CalendarCheck,
  CreditCard,
  ChevronDown,
  KeyRound,
} from "lucide-react";

export function Ecosystem() {
  const t = useTranslations("landing");
  const [openPillar, setOpenPillar] = useState<number | null>(null);

  const ECOSYSTEM_PILLARS = [
    {
      icon: Palette,
      title: t("ecosystem.creators.title"),
      desc: t("ecosystem.creators.desc"),
      details: [
        { icon: Palette, text: t("ecosystem.creators.detail1") },
        { icon: Ticket, text: t("ecosystem.creators.detail2") },
        { icon: Globe, text: t("ecosystem.creators.detail3") },
        { icon: BarChart3, text: t("ecosystem.creators.detail4") },
      ],
    },
    {
      icon: Store,
      title: t("ecosystem.experiences.title"),
      desc: t("ecosystem.experiences.desc"),
      details: [
        { icon: Ticket, text: t("ecosystem.experiences.detail1") },
        { icon: Search, text: t("ecosystem.experiences.detail2") },
        { icon: Users, text: t("ecosystem.experiences.detail3") },
        { icon: Globe, text: t("ecosystem.experiences.detail4") },
        { icon: KeyRound, text: t("ecosystem.experiences.detail5") },
      ],
    },
    {
      icon: Heart,
      title: t("ecosystem.customers.title"),
      desc: t("ecosystem.customers.desc"),
      details: [
        { icon: Search, text: t("ecosystem.customers.detail1") },
        { icon: CalendarCheck, text: t("ecosystem.customers.detail2") },
        { icon: CreditCard, text: t("ecosystem.customers.detail3") },
        { icon: Star, text: t("ecosystem.customers.detail4") },
      ],
    },
  ];

  return (
    <section id="ecosystem" className="relative py-16 px-4 sm:py-28 sm:px-6">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="h-[500px] w-[700px] rounded-full bg-[var(--usha-gold)] opacity-[0.03] blur-[180px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-4xl">
        <div className="mb-10 text-center sm:mb-16">
          <h2 className="mb-3 text-2xl font-bold tracking-tight sm:mb-4 sm:text-3xl md:text-4xl">
            {t("ecosystem.title")} <span className="text-gradient">{t("ecosystem.titleHighlight")}</span>
          </h2>
          <p className="mx-auto max-w-xl text-[var(--usha-muted)]">
            {t("ecosystem.subtitle")}
          </p>
        </div>

        <div className="space-y-4">
          {ECOSYSTEM_PILLARS.map((pillar, i) => {
            const isOpen = openPillar === i;
            return (
              <div key={pillar.title} className={`rounded-2xl border bg-[var(--usha-card)] transition-all ${isOpen ? "border-[var(--usha-gold)]/30" : "border-[var(--usha-border)] hover:border-[var(--usha-gold)]/20"}`}>
                <button
                  onClick={() => setOpenPillar(isOpen ? null : i)}
                  className="flex w-full items-center gap-4 p-6 text-left"
                >
                  {/* Samma ikonbricka som dörrarna och trygghetskorten. Pelarna
                      hade tidigare var sin mättade gradient med svart ikon, och
                      den tredje var blå — en färg som inte fanns någon
                      annanstans på sidan. */}
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--usha-gold)]/20 to-[var(--usha-accent)]/20">
                    <pillar.icon size={18} className="text-[var(--usha-gold)]" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold">{pillar.title}</h3>
                    <p className="mt-1 text-sm text-[var(--usha-muted)]">{pillar.desc}</p>
                  </div>
                  <ChevronDown
                    size={18}
                    className={`shrink-0 text-[var(--usha-muted)] transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {isOpen && (
                  <div className="border-t border-[var(--usha-border)] px-6 pb-6 pt-4">
                    <ul className="grid gap-3 sm:grid-cols-2">
                      {pillar.details.map((detail) => (
                        <li key={detail.text} className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--usha-gold)]/10">
                            <detail.icon size={14} className="text-[var(--usha-gold)]" />
                          </div>
                          <span className="text-sm text-[var(--usha-muted)]">{detail.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Loop message */}
        <p className="mt-8 text-center text-sm text-[var(--usha-muted)]">
          {t("ecosystem.loopMessage")}
        </p>
      </div>
    </section>
  );
}
