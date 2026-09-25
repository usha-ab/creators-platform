import { createClient } from "@/lib/supabase/server";
import { BROWSABLE_TYPES } from "@/lib/listings/browse";
import { CATEGORIES } from "@/lib/categories";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { MapPin, Calendar, ArrowRight, SlidersHorizontal } from "lucide-react";
import { SeoFooter } from "@/components/seo-footer";
import { SeriesCard } from "@/components/series-card";
import { groupBySeries } from "@/lib/listings/group-series";
import { getBookingCounts, sortWithPromoted, isActivelyPromoted } from "@/lib/listings/popularity";
import { GeoLocationDetector } from "@/components/geo-location";
import { EventCarousel } from "@/components/event-carousel";
import { upcomingOrUndated, pastOnly } from "@/lib/listings/time-window";
import { indexable } from "@/lib/seo/metadata";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return {
    ...indexable("/upplevelser"),
    title: t("experiences.metaTitle"),
    description: t("experiences.metaDescription"),
    openGraph: {
      title: t("experiences.metaTitle"),
      description: t("experiences.ogDescription"),
      url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://usha.se"}/upplevelser`,
    },
  };
}

interface SearchParams {
  category?: string;
  when?: string;
  location?: string;
  sort?: string;
  page?: string;
}

const PAGE_SIZE = 20;

const SORT_OPTIONS = [
  { value: "date", labelKey: "experiences.sortDate" },
  { value: "price_asc", labelKey: "experiences.sortPriceAsc" },
  { value: "price_desc", labelKey: "experiences.sortPriceDesc" },
  { value: "newest", labelKey: "experiences.sortNewest" },
] as const;

export default async function UpplevelserPage(
  props: {
    searchParams: Promise<SearchParams>;
  }
) {
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const t = await getTranslations();
  const { category, location, sort, when, page: pageParam } = searchParams;

  // Ett passerat event ska inte ligga först när någon klickar sig in från en
  // story. Kommande är default; de gamla finns kvar men bakom ?when=past, så
  // biblioteket är intakt och bara nedprioriterat.
  const showPast = when === "past";
  const timeFilter = showPast ? pastOnly() : upcomingOrUndated();
  const currentPage = Math.max(1, parseInt(pageParam || "1", 10) || 1);
  const offset = (currentPage - 1) * PAGE_SIZE;

  // ── Build filtered listings query ──
  let query = supabase
    .from("listings")
    .select("id, title, price, event_date, event_location, event_city, event_venue, category, image_url, listing_type, created_at, is_promoted, promoted_until, series_id, ticket_types(price)", { count: "exact" })
    .eq("is_active", true).eq("is_public", true)
    .or(BROWSABLE_TYPES)
    .or(timeFilter);

  if (category && category !== "all") {
    query = query.eq("category", category);
  }

  // Ett namn, använt av både listan och filterräknarna — annars räknar chipsen
  // hela landet medan listan visar en stad.
  const sanitizedLocation = location
    ? decodeURIComponent(location).replace(/[,()\\]/g, " ").trim()
    : "";
  if (sanitizedLocation) {
    // Filter on the real city, not the raw address (which starts with the venue).
    query = query.ilike("event_city", `%${sanitizedLocation}%`);
  }

  // Sort
  switch (sort) {
    case "date":
      query = query.order("event_date", { ascending: true, nullsFirst: false });
      break;
    case "price_asc":
      query = query.order("price", { ascending: true, nullsFirst: false });
      break;
    case "price_desc":
      query = query.order("price", { ascending: false, nullsFirst: false });
      break;
    case "newest":
      query = query.order("created_at", { ascending: false });
      break;
    default:
      // Närmast i tiden först. Passerade listas nyast först i stället, annars
      // hamnar det äldsta eventet överst i biblioteket.
      query = showPast
        ? query.order("event_date", { ascending: false, nullsFirst: false })
        : query.order("event_date", { ascending: true, nullsFirst: false });
  }

  // Paginate
  query = query.range(offset, offset + PAGE_SIZE - 1);

  const { data: rawListings, count: totalCount } = await query;
  const totalPages = Math.ceil((totalCount || 0) / PAGE_SIZE);

  // Fetch booking counts for badges
  const listingIds = (rawListings || []).map((l) => l.id);
  const bookingCounts = await getBookingCounts(supabase, listingIds);

  // Sort promoted first (preserve sort order otherwise)
  const listings = sortWithPromoted(rawListings || []);
  // En serie är ETT kort med datumen bakom en utfällning. Fjorton The
  // Lab-kvällar fyllde annars listan med nästan identiska kort och trängde ut
  // kurser och tjänster, trots att de är egna erbjudanden.
  //
  // Grupperingen sker efter hämtningen, så totalsiffran och sidindelningen
  // räknar fortfarande kvällar. Det är medvetet: annars skulle sida två börja
  // mitt i en serie och samma kväll kunna dyka upp på båda sidorna.
  const grupper = groupBySeries(listings);

  // ── Fetch promoted events for carousel ──
  const { data: promotedEvents } = await supabase
    .from("listings")
    .select("id, slug, title, price, event_date, event_location, image_url, category, is_promoted, promoted_until")
    .eq("is_active", true)
    .eq("is_public", true)
    .or(BROWSABLE_TYPES)
    .eq("is_promoted", true)
    .or(timeFilter)
    .order("created_at", { ascending: false })
    .limit(6);

  const activePromoted = (promotedEvents || []).filter(
    (e) => !e.promoted_until || new Date(e.promoted_until) > new Date()
  );

  // ── Counts for filters + SEO grid (single pass over active listings) ──
  // Drives "show only categories/cities with real content" so the marketplace
  // never advertises an empty filter.
  const { data: countRows } = await supabase
    .from("listings")
    .select("category, event_city")
    .eq("is_active", true).eq("is_public", true)
    .or(BROWSABLE_TYPES)
    .or(timeFilter);

  const categoryCounts: Record<string, number> = {};
  const locationCounts: Record<string, number> = {};
  const cityCatCounts: Record<string, Record<string, number>> = {};
  const locationNeedle = sanitizedLocation.toLowerCase();
  (countRows || []).forEach((l) => {
    // Kategorichipsen räknar det klicket faktiskt ger. Med Stockholm valt stod
    // det "Dans (10)" medan Dans + Stockholm gav nio — den tionde saknar stad.
    const inLocation =
      !locationNeedle || (l.event_city ?? "").toLowerCase().includes(locationNeedle);
    if (l.category && inLocation) categoryCounts[l.category] = (categoryCounts[l.category] || 0) + 1;
    // Real city only — venues never appear under "Alla städer".
    const city = l.event_city?.trim();
    if (city) {
      locationCounts[city] = (locationCounts[city] || 0) + 1;
      if (l.category) {
        (cityCatCounts[city] ??= {})[l.category] = (cityCatCounts[city][l.category] || 0) + 1;
      }
    }
  });
  const topLocations = Object.entries(locationCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  // ── Helper to build filter URLs ──
  function filterUrl(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const merged = { category, location, sort, when, ...overrides };
    Object.entries(merged).forEach(([k, v]) => {
      if (v && v !== "all") params.set(k, v);
    });
    const qs = params.toString();
    return `/upplevelser${qs ? `?${qs}` : ""}`;
  }

  const hasFilters = category || location || sort || when;

  return (
    <div className="min-h-screen bg-[var(--usha-black)]">
      <header className="sticky top-0 z-30 border-b border-[var(--usha-border)] bg-[var(--usha-black)]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="text-lg font-bold text-gradient">Usha Platform</Link>
          <nav className="flex items-center gap-4">
            <Link href="/flode" className="text-sm text-[var(--usha-muted)] hover:text-[var(--usha-white)]">{t("experiences.navFeed")}</Link>
            <Link href="/marketplace" className="text-sm text-[var(--usha-muted)] hover:text-[var(--usha-white)]">{t("experiences.navMarketplace")}</Link>
            <Link href="/signup" className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--usha-muted)] hover:text-[var(--usha-white)]">{t("experiences.navCreateProfile")}</Link>
          </nav>
        </div>
      </header>

      <GeoLocationDetector basePath="/upplevelser" />
      <main className="mx-auto max-w-5xl px-4 py-8">
        {/* Featured carousel */}
        {activePromoted.length > 0 && (
          <EventCarousel events={activePromoted} />
        )}

        <h1 className="text-2xl font-bold md:text-3xl">{t("experiences.title")}</h1>
        <p className="mt-1 text-sm text-[var(--usha-muted)]">
          {sanitizedLocation
            ? t("experiences.countInCity", {
                count: totalCount || 0,
                city: sanitizedLocation.charAt(0).toUpperCase() + sanitizedLocation.slice(1),
              })
            : t("experiences.countInSweden", { count: totalCount || 0 })}
        </p>

        {/* ── Filter bar ── */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <SlidersHorizontal size={14} className="text-[var(--usha-muted)]" />

          {/* Category filter */}
          <Link
            href={filterUrl({ category: undefined, page: undefined })}
            className={`rounded-lg px-3 py-1.5 text-xs transition ${!category ? "bg-[var(--usha-gold)]/15 font-semibold text-[var(--usha-gold)]" : "border border-[var(--usha-border)] text-[var(--usha-muted)] hover:border-[var(--usha-gold)]/30 hover:text-[var(--usha-white)]"}`}
          >
            {t("experiences.filterAll")}
          </Link>
          {/* Only categories with real, published listings — each with its count */}
          {CATEGORIES.filter((c) => c.value !== "other" && (categoryCounts[c.value] || 0) > 0).map((cat) => (
            <Link
              key={cat.value}
              href={filterUrl({ category: cat.value, page: undefined })}
              className={`rounded-lg px-3 py-1.5 text-xs transition ${category === cat.value ? "bg-[var(--usha-gold)]/15 font-semibold text-[var(--usha-gold)]" : "border border-[var(--usha-border)] text-[var(--usha-muted)] hover:border-[var(--usha-gold)]/30 hover:text-[var(--usha-white)]"}`}
            >
              {t(`categories.${cat.value}`)} ({categoryCounts[cat.value]})
            </Link>
          ))}
        </div>

        {/* Location + sort row */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Location pills */}
          {topLocations.length > 0 && (
            <>
              <Link
                href={filterUrl({ location: undefined, page: undefined })}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs transition ${!location ? "bg-[var(--usha-gold)]/15 font-semibold text-[var(--usha-gold)]" : "border border-[var(--usha-border)] text-[var(--usha-muted)] hover:border-[var(--usha-gold)]/30 hover:text-[var(--usha-white)]"}`}
              >
                <MapPin size={10} /> {t("experiences.allCities")}
              </Link>
              {topLocations.slice(0, 8).map(([city]) => (
                <Link
                  key={city}
                  href={filterUrl({ location: city.toLowerCase(), page: undefined })}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs transition ${location?.toLowerCase() === city.toLowerCase() ? "bg-[var(--usha-gold)]/15 font-semibold text-[var(--usha-gold)]" : "border border-[var(--usha-border)] text-[var(--usha-muted)] hover:border-[var(--usha-gold)]/30 hover:text-[var(--usha-white)]"}`}
                >
                  {city}
                </Link>
              ))}
            </>
          )}

          {/* Kommande / Tidigare — biblioteket finns kvar, men är inte det
              första någon möter. */}
          <div className="ml-auto flex items-center gap-1.5">
            <Link
              href={filterUrl({ when: undefined, page: undefined })}
              className={`rounded-lg px-2.5 py-1.5 text-xs transition ${!showPast ? "bg-white/10 font-medium text-[var(--usha-white)]" : "text-[var(--usha-muted)] hover:text-[var(--usha-white)]"}`}
            >
              {t("experiences.whenUpcoming")}
            </Link>
            <Link
              href={filterUrl({ when: "past", page: undefined })}
              className={`rounded-lg px-2.5 py-1.5 text-xs transition ${showPast ? "bg-white/10 font-medium text-[var(--usha-white)]" : "text-[var(--usha-muted)] hover:text-[var(--usha-white)]"}`}
            >
              {t("experiences.whenPast")}
            </Link>
          </div>

          {/* Sort */}
          <div className="flex items-center gap-1.5">
            {SORT_OPTIONS.map((opt) => (
              <Link
                key={opt.value}
                href={filterUrl({ sort: opt.value, page: undefined })}
                className={`rounded-lg px-2.5 py-1.5 text-xs transition ${(sort || "date") === opt.value ? "bg-white/10 font-medium text-[var(--usha-white)]" : "text-[var(--usha-muted)] hover:text-[var(--usha-white)]"}`}
              >
                {t(opt.labelKey)}
              </Link>
            ))}
          </div>
        </div>

        {/* Clear filters */}
        {hasFilters && (
          <div className="mt-3">
            <Link href="/upplevelser" className="text-xs text-[var(--usha-muted)] hover:text-[var(--usha-gold)]">
              {t("experiences.clearFilters")}
            </Link>
          </div>
        )}

        {/* ── Listings grid ── */}
        {listings && listings.length > 0 ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {grupper.map((g) => (
              <SeriesCard
                key={g.forsta.id}
                grupp={g}
                bookingCount={bookingCounts[g.forsta.id] || 0}
                isPromoted={isActivelyPromoted(g.forsta)}
              />
            ))}
          </div>
        ) : (
          <div className="mt-12 flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-[var(--usha-muted)]">{t("experiences.emptyNoMatch")}</p>
            <Link
              href="/for-kreatorer"
              className="rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-5 py-2.5 text-sm font-bold text-black transition hover:opacity-90"
            >
              {t("experiences.emptyCreateFirst")}
            </Link>
            {hasFilters && (
              <Link href="/upplevelser" className="text-sm text-[var(--usha-gold)] hover:underline">
                {t("experiences.clearFilters")}
              </Link>
            )}
          </div>
        )}

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="mt-8 flex items-center justify-center gap-2">
            {currentPage > 1 && (
              <Link
                href={filterUrl({ page: String(currentPage - 1) })}
                className="rounded-lg border border-[var(--usha-border)] px-3 py-1.5 text-xs text-[var(--usha-muted)] transition hover:border-[var(--usha-gold)]/30 hover:text-[var(--usha-white)]"
              >
                {t("experiences.paginationPrevious")}
              </Link>
            )}
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 7) {
                pageNum = i + 1;
              } else if (currentPage <= 4) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 3) {
                pageNum = totalPages - 6 + i;
              } else {
                pageNum = currentPage - 3 + i;
              }
              return (
                <Link
                  key={pageNum}
                  href={filterUrl({ page: String(pageNum) })}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs transition ${pageNum === currentPage ? "bg-[var(--usha-gold)]/15 font-semibold text-[var(--usha-gold)]" : "text-[var(--usha-muted)] hover:text-[var(--usha-white)]"}`}
                >
                  {pageNum}
                </Link>
              );
            })}
            {currentPage < totalPages && (
              <Link
                href={filterUrl({ page: String(currentPage + 1) })}
                className="rounded-lg border border-[var(--usha-border)] px-3 py-1.5 text-xs text-[var(--usha-muted)] transition hover:border-[var(--usha-gold)]/30 hover:text-[var(--usha-white)]"
              >
                {t("experiences.paginationNext")}
              </Link>
            )}
          </div>
        )}

        {/* ── SEO: City + Category grid ── */}
        {topLocations.length > 0 && !hasFilters && (
          <section className="mt-12 border-t border-[var(--usha-border)] pt-8">
            <h2 className="text-lg font-semibold">{t("experiences.seoHeading")}</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
              {topLocations.slice(0, 6).map(([city]) => {
                // Only link city×category combinations that actually have listings,
                // so we never generate (or link to) thin/empty SEO pages.
                const cityCats = CATEGORIES.filter(
                  (c) => c.value !== "other" && (cityCatCounts[city]?.[c.value] || 0) > 0
                );
                if (cityCats.length === 0) return null;
                return (
                  <div key={city}>
                    <h3 className="mb-2 text-sm font-semibold">{city}</h3>
                    <div className="flex flex-col gap-1">
                      {cityCats.map((cat) => (
                        <Link
                          key={`${city}-${cat.value}`}
                          href={`/upplevelser/${encodeURIComponent(city.toLowerCase())}/${cat.value}`}
                          className="flex items-center gap-1 text-xs text-[var(--usha-muted)] transition hover:text-[var(--usha-gold)]"
                        >
                          <ArrowRight size={10} />
                          {t("experiences.seoCategoryInCity", { category: t(`categories.${cat.value}`), city })}
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </main>

      <SeoFooter />
    </div>
  );
}
