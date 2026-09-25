import { createClient } from "@/lib/supabase/server";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/categories";
import { safeJsonLd } from "@/lib/json-ld";
import type { Metadata } from "next";
import Link from "next/link";
import { MapPin, ArrowLeft } from "lucide-react";
import { SeoFooter } from "@/components/seo-footer";
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

  // Don't index a city page with no public creators yet.
  const supabase = await createClient();
  const { count } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("is_public", true)
    .ilike("location", `%${city}%`);

  return {
    title: `Kreatörer i ${city} – Usha Platform`,
    description: `Hitta kreatörer i ${city}. Dansinstruktörer, musiker, fotografer och mer.`,
    ...(!count ? { robots: { index: false } } : {}),
    ...indexable(`/creators/stad/${params.location}`),
    openGraph: {
      title: `Kreatörer i ${city} – Usha Platform`,
      description: `Hitta kreativa talanger i ${city}.`,
      url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://usha.se"}/creators/stad/${params.location}`,
    },
  };
}

export default async function CreatorLocationPage(props: Props) {
  const params = await props.params;
  const city = capitalize(decodeURIComponent(params.location));
  const supabase = await createClient();

  const { data: creators } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, bio, category, location, hourly_rate, categories, slug")
    .eq("is_public", true)
    .ilike("location", `%${city}%`)
    .order("created_at", { ascending: false })
    .limit(50);

  // Category counts for this city
  const categoryCounts: Record<string, number> = {};
  (creators || []).forEach((c) => {
    const cats = c.categories?.length ? c.categories : c.category ? [c.category] : [];
    cats.forEach((cat: string) => {
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });
  });

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `Kreatörer i ${city}`,
    description: `Kreativa talanger i ${city}`,
    url: `https://usha.se/creators/stad/${encodeURIComponent(city.toLowerCase())}`,
  };

  return (
    <div className="min-h-screen bg-[var(--usha-black)]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />

      <header className="sticky top-0 z-30 border-b border-[var(--usha-border)] bg-[var(--usha-black)]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="text-lg font-bold text-gradient">Usha Platform</Link>
          <nav className="flex items-center gap-4">
            <Link href="/flode" className="text-sm text-[var(--usha-muted)] hover:text-[var(--usha-white)]">Flöde</Link>
            <Link href="/upplevelser" className="text-sm text-[var(--usha-muted)] hover:text-[var(--usha-white)]">Upplevelser</Link>
            <Link href="/marketplace" className="text-sm text-[var(--usha-muted)] hover:text-[var(--usha-white)]">Marketplace</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <Link href="/marketplace" className="mb-4 flex items-center gap-1 text-sm text-[var(--usha-muted)] hover:text-[var(--usha-white)]">
          <ArrowLeft size={14} /> Marketplace
        </Link>

        <h1 className="text-2xl font-bold md:text-3xl">Kreatörer i {city}</h1>
        <p className="mt-1 text-sm text-[var(--usha-muted)]">{creators?.length || 0} kreatörer hittade</p>

        {/* Category filter */}
        {Object.keys(categoryCounts).length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {CATEGORIES.filter((c) => categoryCounts[c.value]).map((cat) => (
              <Link
                key={cat.value}
                href={`/creators/stad/${encodeURIComponent(city.toLowerCase())}/${cat.value}`}
                className="rounded-lg border border-[var(--usha-border)] px-3 py-1.5 text-xs transition hover:border-[var(--usha-gold)]/30 hover:text-[var(--usha-white)]"
              >
                {cat.label} ({categoryCounts[cat.value]})
              </Link>
            ))}
          </div>
        )}

        {/* Creators grid */}
        {creators && creators.length > 0 ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {creators.map((creator) => {
              const cats = creator.categories?.length ? creator.categories : creator.category ? [creator.category] : [];
              return (
                <Link
                  key={creator.id}
                  href={`/creators/${creator.slug || creator.id}`}
                  className="flex gap-3 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4 transition hover:border-[var(--usha-gold)]/30"
                >
                  {creator.avatar_url ? (
                    <img src={creator.avatar_url} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--usha-gold)]/10">
                      <span className="text-sm font-bold text-[var(--usha-gold)]">{(creator.full_name || "?")[0]}</span>
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{creator.full_name || "Kreatör"}</p>
                    {cats.length > 0 && (
                      <p className="mt-0.5 text-xs text-[var(--usha-muted)]">
                        {cats.map((c: string) => CATEGORY_LABELS[c] || c).join(", ")}
                      </p>
                    )}
                    {creator.location && (
                      <p className="mt-0.5 flex items-center gap-0.5 text-xs text-[var(--usha-muted)]">
                        <MapPin size={10} /> {creator.location.split(",")[0]}
                      </p>
                    )}
                    {creator.hourly_rate && (
                      <p className="mt-1 text-xs font-medium text-[var(--usha-gold)]">Från {creator.hourly_rate} kr</p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="mt-12 text-center">
            <p className="text-sm text-[var(--usha-muted)]">Inga kreatörer hittade i {city} just nu.</p>
            <Link href="/marketplace" className="mt-2 inline-block text-sm text-[var(--usha-gold)] hover:underline">Se alla kreatörer</Link>
          </div>
        )}
      </main>

      <SeoFooter />
    </div>
  );
}
