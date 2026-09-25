import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notIndexable } from "@/lib/seo/metadata";

const OG_LOCALE: Record<string, string> = { sv: "sv_SE", en: "en_US", es: "es_ES" };

// The page itself is a Client Component and can't export metadata, so the
// route's own title/description/openGraph live in this layout. Without it the
// page inherits the root layout's openGraph, i.e. og:url = the start page.
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations("auth.meta");
  const title = t("loginTitle");
  const description = t("loginDescription");

  return {
    ...notIndexable(),
    title,
    description,
    alternates: { canonical: "/login" },
    openGraph: {
      title,
      description,
      url: "https://usha.se/login",
      type: "website",
      locale: OG_LOCALE[locale] ?? "sv_SE",
      siteName: "Usha Platform",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
