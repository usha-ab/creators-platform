import { createClient } from "@/lib/supabase/server";
import { BROWSABLE_TYPES } from "@/lib/listings/browse";
import { upcomingOrUndated } from "@/lib/listings/time-window";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/categories";
import { safeJsonLd } from "@/lib/json-ld";
import type { Metadata } from "next";
import Link from "next/link";
import { MapPin, Calendar, ArrowLeft } from "lucide-react";
import { SeoFooter } from "@/components/seo-footer";
import { ListingCard } from "@/components/listing-card";
import { getBookingCounts, sortWithPromoted, isActivelyPromoted } from "@/lib/listings/popularity";
import { indexable } from "@/lib/seo/metadata";

interface Props {
  params: Promise<{ location: string }>;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const city = capitalize(decodeURIComponent(params.location));

  // Don't index a city page with no listings yet.
  const supabase = await createClient();
  const { count } = await supabase
    .from("listings")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true)
    .eq("is_public", true)
    .or(BROWSABLE_TYPES)
    .ilike("event_city", `%${city}%`)
    .or(upcomingOrUndated());

  return {
    title: `Upplevelser i ${city} – Usha Platform`,
    description: `Hitta kreativa events, tjänster och upplevelser i ${city}. Dans, musik, fotografi och mer.`,
    ...(!count ? { robots: { index: false } } : {}),
    ...indexable(`/upplevelser/${params.location}`),
    openGraph: {
      title: `Upplevelser i ${city} – Usha Platform`,
      description: `Hitta kreativa events och upplevelser i ${city}.`,
      url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://usha.se"}/upplevelser/${params.location}`,
    },
  };
}

export default async function LocationPage(props: Props) {
  const params = await props.params;
  const city = capitalize(decodeURIComponent(params.location));
  const supabase = await createClient();

  const { data: rawListings } = await supabase
    .from("listings")
    .select("id, title, description, price, event_date, event_location, event_city, event_venue, category, image_url, listing_type, is_promoted, promoted_until, ticket_types(price)")
    .eq("is_active", true)
    .eq("is_public", true)
    .or(BROWSABLE_TYPES)
    .ilike("event_city", `%${city}%`)
    .or(upcomingOrUndated())
    .order("event_date", { ascending: true, nullsFirst: false })
    .limit(50);

  const listingIds = (rawListings || []).map((l) => l.id);
  const bookingCounts = await getBookingCounts(supabase, listingIds);
  const listings = sortWithPromoted(rawListings || []);

  // Count by category for this location
  const categoryCounts: Record<string, number> = {};
  (listings || []).forEach((l) => {
    if (l.category) {
      categoryCounts[l.category] = (categoryCounts[l.category] || 0) + 1;
    }
  });

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `Upplevelser i ${city}`,
    description: `Kreativa events och upplevelser i ${city}`,
    url: `https://usha.se/upplevelser/${encodeURIComponent(city.toLowerCase())}`,
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
        <Link href="/upplevelser" className="mb-4 flex items-center gap-1 text-sm text-[var(--usha-muted)] hover:text-[var(--usha-white)]">
          <ArrowLeft size={14} /> Alla upplevelser
        </Link>

        <h1 className="text-2xl font-bold md:text-3xl">Upplevelser i {city}</h1>
        <p className="mt-1 text-sm text-[var(--usha-muted)]">
          {listings?.length || 0} upplevelser hittade
        </p>

        {/* Category filter */}
        {Object.keys(categoryCounts).length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {CATEGORIES.filter((c) => categoryCounts[c.value]).map((cat) => (
              <Link
                key={cat.value}
                href={`/upplevelser/${encodeURIComponent(city.toLowerCase())}/${cat.value}`}
                className="rounded-lg border border-[var(--usha-border)] px-3 py-1.5 text-xs transition hover:border-[var(--usha-gold)]/30 hover:text-[var(--usha-white)]"
              >
                {cat.label} ({categoryCounts[cat.value]})
              </Link>
            ))}
          </div>
        )}

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
          <div className="mt-12 text-center">
            <p className="text-sm text-[var(--usha-muted)]">Inga upplevelser hittade i {city} just nu.</p>
            <Link href="/upplevelser" className="mt-2 inline-block text-sm text-[var(--usha-gold)] hover:underline">
              Se alla upplevelser
            </Link>
          </div>
        )}
      </main>

      <SeoFooter />
    </div>
  );
}
