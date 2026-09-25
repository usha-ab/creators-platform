import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { indexable } from "@/lib/seo/metadata";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("about");
  return {
    ...indexable("/om"),
    title: t("metaTitle"),
    description: t("metaDescription"),
    openGraph: {
      title: t("metaTitle"),
      description: t("metaDescription"),
      url: "https://usha.se/om",
      type: "website",
    },
  };
}

export default async function AboutPage() {
  const t = await getTranslations("about");

  return (
    <main className="min-h-screen bg-[var(--usha-black)] text-[var(--usha-white)]">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="mb-8 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--usha-muted)] transition-colors hover:text-[var(--usha-white)]"
          >
            <ArrowLeft size={14} />
            {t("back")}
          </Link>
          <LanguageSwitcher />
        </div>

        <h1 className="mb-4 text-4xl font-bold">{t("title")}</h1>
        <p className="mb-10 text-lg font-medium text-[var(--usha-white)]">{t("lead")}</p>

        <div className="space-y-6 text-sm leading-relaxed text-[var(--usha-muted)]">
          <p>{t("p1")}</p>
          <p>{t("p2")}</p>

          <section className="pt-2">
            <h2 className="mb-3 text-lg font-semibold text-[var(--usha-white)]">{t("roadmapTitle")}</h2>
            <p>
              {t("p3")}{" "}
              <Link href="/upplevelser" className="text-[var(--usha-gold)] hover:underline">
                {t("p3Link")}
              </Link>
            </p>
          </section>

          <p className="text-[var(--usha-white)]">{t("closing")}</p>

          <p className="pt-4 text-sm italic text-[var(--usha-gold)]">{t("tagline")}</p>
        </div>
      </div>
    </main>
  );
}
