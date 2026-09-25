import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Ticket } from "lucide-react";
import { safeJsonLd } from "@/lib/json-ld";
import { LandingStats } from "@/components/landing-stats";
import { LandingInstall } from "@/components/landing-install";
import { InstallPrompt } from "@/components/install-prompt";
import { SiteNav } from "@/components/landing/site-nav";
import { WhatsOn } from "@/components/landing/whats-on";
import { Ecosystem } from "@/components/landing/ecosystem";
import { Trust } from "@/components/landing/trust";
import { Footer } from "@/components/landing/footer";
import { AudienceDoors } from "@/components/landing/audience-doors";
import { RedirectIfAuthed } from "@/components/landing/redirect-if-authed";

const OG_LOCALE: Record<string, string> = { sv: "sv_SE", en: "en_US", es: "es_ES" };

// The home page leads with the ecosystem/cycle idea (not the event tooling,
// which now lives on /for-kreatorer). Title/description follow the visitor's
// resolved locale — an English body must not ship a Swedish <title>.
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations("landing.meta");
  const title = t("title");
  const description = t("description");
  const ogDescription = t("ogDescription");

  return {
    title,
    description,
    alternates: { canonical: "/" },
    openGraph: {
      title,
      description: ogDescription,
      url: "https://usha.se",
      type: "website",
      locale: OG_LOCALE[locale] ?? "sv_SE",
      siteName: "Usha Platform",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: ogDescription,
    },
  };
}

// Organization structured data (company Usha AB, product Usha Platform).
// Organisationen och sajten i ett graf-objekt. WebSite med SearchAction är det
// som kan ge en sökruta direkt i Googles resultat; utan den kan en sökande bara
// klicka in på startsidan och leta vidare själv.
const ORGANIZATION_JSONLD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://usha.se/#organization",
      name: "Usha Platform",
      legalName: "Usha AB",
      url: "https://usha.se",
      logo: "https://usha.se/icon-192.png",
      description:
        "Kuraterad, BankID-verifierad marknadsplats som förenar kreatörer, platser och publik.",
      sameAs: ["https://www.facebook.com/438136616060981"],
    },
    {
      "@type": "WebSite",
      "@id": "https://usha.se/#website",
      url: "https://usha.se",
      name: "Usha Platform",
      publisher: { "@id": "https://usha.se/#organization" },
      inLanguage: ["sv", "en", "es"],
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: "https://usha.se/upplevelser?location={search_term_string}",
        },
        "query-input": "required name=search_term_string",
      },
    },
  ],
};

/* ─────────────── HERO (the cycle) ─────────────── */
function Hero() {
  const t = useTranslations("landing");

  return (
    // Inte längre min-h-screen. Hero tog en hel skärm, så det första en
    // besökare mötte var en pitch — och svaret på "vad händer" låg utanför
    // bild. Nu tar sektionen den höjd innehållet kräver, och listan med
    // kommande kvällar börjar synas direkt under.
    <section className="relative flex flex-col items-center justify-center overflow-hidden px-4 pt-24 pb-14 sm:px-6 sm:pt-28 sm:pb-16">
      <div className="pointer-events-none absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="h-[600px] w-[900px] rounded-full bg-[var(--usha-gold)] opacity-[0.05] blur-[180px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-4xl text-center">
        <div className="animate-fade-up mb-8 inline-flex items-center gap-2 rounded-full border border-[var(--usha-gold)]/20 bg-[var(--usha-card)] px-5 py-2 text-xs">
          <span className="text-[var(--usha-muted)]">{t("hero.badge")}</span>
        </div>

        <h1
          className="animate-fade-up delay-100 mb-6 text-3xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl md:text-6xl lg:text-7xl"
          style={{ opacity: 0 }}
        >
          {t("hero.headlinePart1")}{" "}
          <br className="hidden sm:block" />
          <span className="text-gradient">{t("hero.headlinePart2")}</span>
        </h1>

        {/* Hero video */}
        <div
          className="animate-fade-up delay-150 mx-auto mb-8 max-w-3xl overflow-hidden rounded-xl border border-[var(--usha-border)] sm:mb-10 sm:rounded-2xl"
          style={{ opacity: 0 }}
        >
          {/* Höjdtaket gäller även på desktop. Utan det växte videon med
              skärmen och tryckte ned allt konkret under vikningen. */}
          <video
            autoPlay
            loop
            muted
            playsInline
            className="w-full max-h-[38vh] object-cover sm:max-h-[44vh]"
            suppressHydrationWarning
          >
            <source src="/hero-video.mp4" type="video/mp4" />
          </video>
        </div>

        <p
          className="animate-fade-up delay-200 mx-auto mb-10 max-w-2xl text-base leading-relaxed text-[var(--usha-muted)] sm:mb-12 sm:text-lg"
          style={{ opacity: 0 }}
        >
          {t("hero.description")}
        </p>

        {/* Primary CTA — straight to the live events */}
        <div className="animate-fade-up delay-250 mb-10 flex justify-center sm:mb-12" style={{ opacity: 0 }}>
          <a
            href="/upplevelser"
            className="glow-gold inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-7 py-3.5 text-base font-bold text-black transition hover:opacity-90"
          >
            <Ticket size={18} />
            {t("hero.eventsCta")}
          </a>
        </div>

      </div>

    </section>
  );
}

/* ─────────────── AVSLUTNINGEN: var hör du hemma, och hur går du med ─────────────── */
/**
 * Sidan ställer besökarens frågor i tur och ordning: vad är det här (hero),
 * finns det något på riktigt (Vad händer), hur hänger det ihop (Kretsloppet),
 * går det att lita på (Trust). Först HÄR kommer "var hör jag hemma" och "hur
 * går jag med" — när allt annat är besvarat.
 *
 * Dörrarna låg tidigare på två ställen på samma sida. När samma val visas
 * dubbelt känns ingen av gångerna som huvudsaken, så de står nu en enda gång
 * och får vara stora i stället.
 */
function HomeCta() {
  const t = useTranslations("landing");

  return (
    <section className="relative overflow-hidden py-16 px-4 sm:py-28 sm:px-6">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/2 left-1/2 h-[400px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--usha-gold)] opacity-[0.06] blur-[150px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-4xl text-center">
        <h2 className="mb-3 text-2xl font-bold sm:text-3xl md:text-4xl">{t("homeCta.title")}</h2>
        <p className="mb-10 text-base text-[var(--usha-muted)] sm:mb-12 sm:text-lg">
          {t("homeCta.description")}
        </p>

        <AudienceDoors size="large" />

        {/* Kontot, med eget avsnitt i stället för en knapp i ett hörn. Den som
            läst hela vägen hit har fått svaren och ska inte behöva leta. */}
        <div className="mt-12 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-8 sm:mt-16 sm:p-10">
          <h3 className="mb-2 text-xl font-bold sm:text-2xl">{t("signupCta.title")}</h3>
          <p className="mx-auto mb-7 max-w-md text-sm text-[var(--usha-muted)] sm:text-base">
            {t("signupCta.description")}
          </p>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="/signup"
              className="glow-gold inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-7 py-3.5 text-base font-bold text-black transition hover:opacity-90 sm:w-auto"
            >
              {t("nav.getStarted")}
            </a>
            <a
              href="/upplevelser"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--usha-border)] px-7 py-3.5 text-base font-semibold transition hover:border-[var(--usha-gold)]/40 sm:w-auto"
            >
              <Ticket size={18} />
              {t("hero.eventsCta")}
            </a>
          </div>
        </div>

        <div className="mt-10 border-t border-[var(--usha-border)] pt-10">
          <LandingInstall />
        </div>
      </div>
    </section>
  );
}

/* ─────────────── PAGE (Server Component) ─────────────── */
export default function Home() {
  return (
    // overflow-x-clip: decorative blur glows are wider than a phone screen; without
    // clipping they overflow horizontally, which widens the layout viewport and
    // pushes the fixed nav's hamburger button off-screen on mobile.
    <main className="overflow-x-clip">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(ORGANIZATION_JSONLD) }}
      />
      {/* Non-blocking: logged-in users go to /app after render; anonymous
          visitors and crawlers always get the full landing HTML. */}
      <RedirectIfAuthed />
      <SiteNav />
      <Hero />
      {/* Svaret på "vad händer" högst upp, före pitchen om ekosystemet. Den
          som vill förstå plattformen skrollar vidare; den som bara undrar när
          nästa kväll är behöver inte göra det. */}
      <WhatsOn />
      <LandingStats />
      <Ecosystem />
      <Trust />
      <HomeCta />
      <Footer />
      {/* Floating, opportunistic install nudge — only renders on installable
          browsers (Android/Chrome) when beforeinstallprompt fires, hidden in
          standalone mode, and dismissible. Complements the bottom-of-page CTA. */}
      <InstallPrompt />
    </main>
  );
}
