"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

export interface FaqItem {
  q: string;
  a: string;
}

/**
 * Frågor och svar som dragspel. Texterna kommer färdigöversatta från
 * serversidan: de publika sidornas klientprovider bär bara ett fåtal
 * namespace (lib/i18n/client-namespaces.ts), och en sidas FAQ ska inte
 * tvinga in hela sin namespace i varje besökares HTML.
 */
export function Faq({ title, titleHighlight, items }: { title: string; titleHighlight?: string; items: FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="relative py-16 px-4 sm:py-24 sm:px-6">
      <div className="relative z-10 mx-auto max-w-3xl">
        <div className="mb-10 text-center sm:mb-14">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">
            {title} {titleHighlight && <span className="text-gradient">{titleHighlight}</span>}
          </h2>
        </div>
        <div className="space-y-3">
          {items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div
                key={i}
                className={`rounded-2xl border bg-[var(--usha-card)] transition-all ${isOpen ? "border-[var(--usha-gold)]/30" : "border-[var(--usha-border)] hover:border-[var(--usha-gold)]/20"}`}
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-4 p-5 text-left"
                >
                  <span className="font-semibold">{item.q}</span>
                  <ChevronDown size={18} className={`shrink-0 text-[var(--usha-muted)] transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && (
                  <p className="border-t border-[var(--usha-border)] px-5 pb-5 pt-4 text-sm leading-relaxed text-[var(--usha-muted)]">
                    {item.a}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
