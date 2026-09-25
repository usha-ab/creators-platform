import { createClient } from "@/lib/supabase/server";
import { BROWSABLE_TYPES } from "@/lib/listings/browse";
import { upcomingOrUndated } from "@/lib/listings/time-window";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/categories";
import { safeJsonLd } from "@/lib/json-ld";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SeoFooter } from "@/components/seo-footer";
import { ListingCard } from "@/components/listing-card";
import { getBookingCounts, sortWithPromoted, isActivelyPromoted } from "@/lib/listings/popularity";
import { indexable } from "@/lib/seo/metadata";

interface Props {
  params: Promise<{ location: string; category: string }>;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const city = capitalize(decodeURIComponent(params.location));
  const categoryLabel = CATEGORY_LABELS[params.category] || capitalize(params.category);

  // Don't let empty city×category combinations get indexed (thin pages).
  const supabase = await createClient();
  const { count } = await supabase
    .from("listings")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true)
    .eq("is_public", true)
    .or(BROWSABLE_TYPES)
    .eq("category", params.category)
    .ilike("event_city", `%${city}%`)
    .or(upcomingOrUndated());

  return {
    title: `${categoryLabel} i ${city} – Usha Platform`,
    description: `Hitta ${categoryLabel.toLowerCase()} events och upplevelser i ${city}. Boka direkt på Usha Platform.`,
    ...(!count ? { robots: { index: false } } : {}),
    ...indexable(`/upplevelser/${params.location}/${params.category}`),
    openGraph: {
      title: `${categoryLabel} i ${city} – Usha Platform`,
      description: `${categoryLabel} events och upplevelser i ${city}.`,
      url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://usha.se"}/upplevelser/${params.location}/${params.category}`,
    },
  };
}

export default async function LocationCategoryPage(props: Props) {
  const params = await props.params;
  const city = capitalize(decodeURIComponent(params.location));
  const categoryLabel = CATEGORY_LABELS[params.category] || capitalize(params.category);
  const supabase = await createClient();

  const { data: rawListings } = await supabase
    .from("listings")
    .select("id, title, description, price, event_date, event_location, event_city, event_venue, category, image_url, listing_type, is_promoted, promoted_until, ticket_types(price)")
    .eq("is_active", true)
    .eq("is_public", true)
    .or(BROWSABLE_TYPES)
    .eq("category", params.category)
    .ilike("event_city", `%${city}%`)
    .or(upcomingOrUndated())
    .order("event_date", { ascending: true, nullsFirst: false })
    .limit(50);

  const listingIds = (rawListings || []).map((l) => l.id);
  const bookingCounts = await getBookingCounts(supabase, listingIds);
  const listings = sortWithPromoted(rawListings || []);

  // Categories that actually have listings in this city — only cross-link those.
  const { data: cityCatRows } = await supabase
    .from("listings")
    .select("category")
    .eq("is_active", true)
    .eq("is_public", true)
    .or(BROWSABLE_TYPES)
    .ilike("event_city", `%${city}%`)
    .or(upcomingOrUndated());
  const cityCats = new Set((cityCatRows || []).map((r) => r.category).filter(Boolean));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${categoryLabel} i ${city}`,
    description: `${categoryLabel} events och upplevelser i ${city}`,
    url: `https://usha.se/upplevelser/${encodeURIComponent(city.toLowerCase())}/${params.category}`,
  };

  return (
    <div className="min-h-screen bg-[var(--usha-black)]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
      />

      <header className="sticky top-0 z-30 border-b border-[var(--usha-border)] bg-[var(--usha-black)]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="text-lg font-bold text-gradient">Usha Platform</Link>
          <nav className="flex items-center gap-4">
            <Link href="/flode" className="text-sm text-[var(--usha-muted)] hover:text-[var(--usha-white)]">Flöde</Link>
            <Link href="/upplevelser" className="text-sm text-[var(--usha-muted)] hover:text-[var(--usha-white)]">Upplevelser</Link>
            <Link
              href="/signup"
              className="rounded-lg bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-4 py-1.5 text-xs font-bold text-black"
            >
              Skapa konto
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <Link
          href={`/upplevelser/${encodeURIComponent(city.toLowerCase())}`}
          className="mb-4 flex items-center gap-1 text-sm text-[var(--usha-muted)] hover:text-[var(--usha-white)]"
        >
          <ArrowLeft size={14} /> Alla i {city}
        </Link>

        <h1 className="text-2xl font-bold md:text-3xl">{categoryLabel} i {city}</h1>
        <p className="mt-1 text-sm text-[var(--usha-muted)]">
          {listings?.length || 0} upplevelser hittade
        </p>

        {/* Other categories in this city */}
        <div className="mt-4 flex flex-wrap gap-2">
          {CATEGORIES.filter((c) => c.value !== "other" && c.value !== params.category && cityCats.has(c.value)).map((cat) => (
            <Link
              key={cat.value}
              href={`/upplevelser/${encodeURIComponent(city.toLowerCase())}/${cat.value}`}
              className="rounded-lg border border-[var(--usha-border)] px-3 py-1.5 text-xs transition hover:border-[var(--usha-gold)]/30 hover:text-[var(--usha-white)]"
            >
              {cat.label}
            </Link>
          ))}
        </div>

        {/* Listings grid */}
        {listings && listings.length > 0 ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                bookingCount={bookingCounts[listing.id] || 0}
                isPromoted={isActivelyPromoted(listing)}
              />
            ))}
          </div>
        ) : (
          <div className="mt-12 flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-[var(--usha-muted)]">
              Inga {categoryLabel.toLowerCase()} upplevelser i {city} ännu – är du kreatör? Skapa den första.
            </p>
            <Link
              href="/for-kreatorer"
              className="rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-5 py-2.5 text-sm font-bold text-black transition hover:opacity-90"
            >
              Skapa den första
            </Link>
            <Link
              href={`/upplevelser/${encodeURIComponent(city.toLowerCase())}`}
              className="text-sm text-[var(--usha-gold)] hover:underline"
            >
              Se alla upplevelser i {city}
            </Link>
          </div>
        )}
      </main>

      <SeoFooter />
    </div>
  );
}
