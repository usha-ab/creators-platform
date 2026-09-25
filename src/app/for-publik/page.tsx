import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SiteNav } from "@/components/landing/site-nav";
import { PerspectiveHero } from "@/components/landing/perspective-hero";
import { LoopSection } from "@/components/landing/loop-section";
import { Pricing } from "@/components/landing/pricing";
import { AudienceFeatures } from "@/components/landing/audience-features";
import { PerspectiveLinks } from "@/components/landing/perspective-links";
import { Trust } from "@/components/landing/trust";
import { Footer } from "@/components/landing/footer";
import { RedirectIfAuthed } from "@/components/landing/redirect-if-authed";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("forAudience");
  const title = t("meta.title");
  const description = t("meta.description");
  return {
    title,
    description,
    alternates: { canonical: "/for-publik" },
    openGraph: { title, description, url: "https://usha.se/for-publik", type: "website", locale: "sv_SE", siteName: "Usha Platform" },
  };
}

export default function ForAudiencePage() {
  return (
    <main>
      <RedirectIfAuthed />
      <SiteNav />
      {/* Primary CTA leads into the functional browse page; the no-account
          ticket wedge sits just beneath it as lighter-weight reassurance. */}
      <PerspectiveHero ns="forAudience" ctaHref="/upplevelser" wedge />
      <LoopSection ns="forAudience" />
      <AudienceFeatures />
      <Pricing role="customer" />
      <PerspectiveLinks exclude="audience" />
      <Trust />
      <Footer />
    </main>
  );
}
