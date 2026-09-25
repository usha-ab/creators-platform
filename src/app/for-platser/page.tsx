import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import { ShieldCheck, CalendarCheck, SlidersHorizontal } from "lucide-react";
import { SiteNav } from "@/components/landing/site-nav";
import { PerspectiveHero } from "@/components/landing/perspective-hero";
import { LoopSection } from "@/components/landing/loop-section";
import { Pricing } from "@/components/landing/pricing";
import { PerspectiveLinks } from "@/components/landing/perspective-links";
import { Trust } from "@/components/landing/trust";
import { Footer } from "@/components/landing/footer";
import { RedirectIfAuthed } from "@/components/landing/redirect-if-authed";

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

function VenueValues() {
  const t = useTranslations("forVenues.values");
  const items = [
    { icon: ShieldCheck, title: t("one"), desc: t("oneDesc") },
    { icon: SlidersHorizontal, title: t("two"), desc: t("twoDesc") },
    { icon: CalendarCheck, title: t("three"), desc: t("threeDesc") },
  ];
  return (
    <section className="relative py-12 px-4 sm:py-16 sm:px-6">
      <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-3">
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

export default function ForVenuesPage() {
  return (
    <main>
      <RedirectIfAuthed />
      <SiteNav />
      <PerspectiveHero ns="forVenues" ctaHref="/signup?role=venue" />
      <VenueValues />
      <LoopSection ns="forVenues" />
      <Pricing role="venue" />
      <PerspectiveLinks exclude="venues" />
      <Trust />
      <Footer />
    </main>
  );
}
