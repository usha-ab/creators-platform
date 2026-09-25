import { createClient } from "@/lib/supabase/server";
import { getFeedPosts } from "@/app/app/feed/queries";
import { Feed } from "@/components/feed/feed";
import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { indexable } from "@/lib/seo/metadata";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("flodePage");
  return {
    ...indexable("/flode"),
    title: t("metaTitle"),
    description: t("metaDescription"),
    openGraph: {
      title: t("metaTitle"),
      description: t("metaDescription"),
      url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://usha.se"}/flode`,
    },
  };
}

export default async function FlodePage() {
  const t = await getTranslations("flodePage");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const feedPosts = await getFeedPosts(user?.id);

  return (
    <div className="min-h-screen bg-[var(--usha-black)]">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-[var(--usha-border)] bg-[var(--usha-black)]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
          <Link href="/" className="text-lg font-bold text-gradient">
            {t("brand")}
          </Link>
          {user ? (
            <Link
              href="/app"
              className="rounded-lg bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-4 py-1.5 text-xs font-bold text-black transition hover:opacity-90"
            >
              {t("myPage")}
            </Link>
          ) : (
            <Link
              href="/signup"
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--usha-muted)] transition hover:text-[var(--usha-white)]"
            >
              {t("createProfile")}
            </Link>
          )}
        </div>
      </header>

      {/* Feed */}
      <main className="mx-auto max-w-lg">
        <div className="px-4 pb-2 pt-4">
          <h1 className="text-lg font-bold">{t("title")}</h1>
          <p className="text-xs text-[var(--usha-muted)]">{t("subtitle")}</p>
        </div>

        <Feed
          initialPosts={feedPosts}
          isLoggedIn={!!user}
          currentUserId={user?.id}
        />
      </main>
    </div>
  );
}
