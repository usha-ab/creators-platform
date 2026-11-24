import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { MapPin, Calendar, Search } from "lucide-react";
import { SiteNav } from "@/components/landing/site-nav";
import { SeoFooter } from "@/components/seo-footer";
import { loadVenueDirectory } from "@/lib/venues/directory";
import { stockholmDay } from "@/lib/tickets/event-day";

export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platserPage");
  return {
    title: t("meta.title"),
    description: t("meta.description"),
    alternates: { canonical: "/platser" },
    openGraph: {
      title: t("meta.ogTitle"),
      description: t("meta.ogDescription"),
      url: "https://usha.se/platser",
      type: "website",
      siteName: "Usha Platform",
    },
  };
}

interface SearchParams {
  q?: string;
}

function matches(q: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = q.toLocaleLowerCase("sv");
  return fields.some((f) => f?.toLocaleLowerCase("sv").includes(needle));
}

export default async function PlatserPage(
  props: {
    searchParams: Promise<SearchParams>;
  }
) {
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const t = await getTranslations("platserPage");
  const q = (searchParams.q ?? "").replace(/[,()\\]/g, " ").trim();
  const today = stockholmDay(new Date());

  // 1. Lokalerna som har konto och program hos oss (Bacchi Syre m.fl.).
  const accounts = (await loadVenueDirectory()).filter((v) => !q || matches(q, v.name, v.city));

  // 2. Platsregistret: adresser som evenemang taggats med. Bara de som har
  //    kommande kvällar visas — en tom post säger bara att inget händer.
  let query = supabase
    .from("venues")
    .select("id, name, city, place_id, image_url")
    .order("name", { ascending: true });
  if (q) query = query.or(`name.ilike.%${q}%,city.ilike.%${q}%`);
  const { data: registry } = await query;

  const placeIds = (registry || []).map((v) => v.place_id).filter(Boolean) as string[];
  const eventCounts: Record<string, number> = {};
  if (placeIds.length > 0) {
    const { data: listings } = await supabase
      .from("listings")
      .select("event_place_id")
      .eq("is_active", true)
      .eq("is_public", true)
      .gte("event_date", today)
      .in("event_place_id", placeIds);
    (listings || []).forEach((l) => {
      if (l.event_place_id) eventCounts[l.event_place_id] = (eventCounts[l.event_place_id] || 0) + 1;
    });
  }
  const places = (registry || []).filter((v) => v.place_id && (eventCounts[v.place_id] || 0) > 0);

  const empty = accounts.length === 0 && places.length === 0;

  return (
    <div className="min-h-screen bg-[var(--usha-black)]">
      <SiteNav />

      <main className="mx-auto max-w-5xl px-4 pb-8 pt-24">
        <h1 className="text-2xl font-bold md:text-3xl">{t("title")}</h1>
        <p className="mt-1 text-sm text-[var(--usha-muted)]">{t("subtitle")}</p>

        <form className="mt-6">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--usha-muted)]" />
            <input
              name="q"
              type="text"
              defaultValue={q}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
              className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-[var(--usha-gold)]/40 sm:max-w-md"
            />
          </div>
        </form>

        {accounts.length > 0 && (
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((venue) => (
              <Link
                key={venue.id}
                href={venue.href}
                className="group overflow-hidden rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] transition hover:border-[var(--usha-gold)]/30"
              >
                <div className="flex aspect-[2/1] items-center justify-center bg-[var(--usha-gold)]/5">
                  {venue.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={venue.avatarUrl} alt={venue.name} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <MapPin size={28} className="text-[var(--usha-gold)]/20" />
                  )}
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-semibold">{venue.name}</p>
                  {venue.city && (
                    <p className="mt-0.5 flex items-center gap-0.5 text-xs text-[var(--usha-muted)]">
                      <MapPin size={10} /> {venue.city}
                    </p>
                  )}
                  <p className="mt-1 flex items-center gap-0.5 text-xs text-[var(--usha-gold)]">
                    <Calendar size={10} /> {t("upcomingCount", { count: venue.upcoming })}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}

        {places.length > 0 && (
          <>
            <h2 className="mt-10 text-lg font-semibold">{t("registryHeading")}</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {places.map((venue) => (
                <Link
                  key={venue.id}
                  href={`/platser/${venue.id}`}
                  className="group overflow-hidden rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-3 transition hover:border-[var(--usha-gold)]/30"
                >
                  <p className="truncate text-sm font-semibold">{venue.name}</p>
                  {venue.city && (
                    <p className="mt-0.5 flex items-center gap-0.5 text-xs text-[var(--usha-muted)]">
                      <MapPin size={10} /> {venue.city}
                    </p>
                  )}
                  <p className="mt-1 flex items-center gap-0.5 text-xs text-[var(--usha-gold)]">
                    <Calendar size={10} /> {t("upcomingCount", { count: eventCounts[venue.place_id!] })}
                  </p>
                </Link>
              ))}
            </div>
          </>
        )}

        {empty && (
          <div className="mt-12 text-center">
            <p className="text-sm text-[var(--usha-muted)]">{q ? t("emptySearch") : t("empty")}</p>
          </div>
        )}
      </main>

      <SeoFooter />
    </div>
  );
}
