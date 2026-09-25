import { createClient } from "@/lib/supabase/server";
import { todayStockholm } from "@/lib/listings/time-window";
import { SELLER_ROLE_VALUES } from "@/lib/roles";
import type { MetadataRoute } from "next";
import { languageAlternates } from "@/lib/seo/metadata";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://usha.se";
  const supabase = await createClient();

  // Static pages — only real, content-rich, indexable pages.
  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: `${baseUrl}/for-kreatorer`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },
    { url: `${baseUrl}/for-platser`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },
    { url: `${baseUrl}/for-publik`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },
    { url: `${baseUrl}/upplevelser`, lastModified: new Date(), changeFrequency: "daily", priority: 0.8 },
    { url: `${baseUrl}/marketplace`, lastModified: new Date(), changeFrequency: "daily", priority: 0.8 },
    { url: `${baseUrl}/flode`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.7 },
    { url: `${baseUrl}/kalender`, lastModified: new Date(), changeFrequency: "daily", priority: 0.8 },
    { url: `${baseUrl}/platser`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.6 },
    { url: `${baseUrl}/salj-biljetter`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/partner`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/guide`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/om`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/refund-policy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${baseUrl}/signup`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${baseUrl}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${baseUrl}/cookies`, changeFrequency: "yearly", priority: 0.2 },
  ];

  // Public creator profiles
  // Bara säljarroller, och bara profiler med något att visa. /creators sätter
  // noindex på en tunn profil (ingen bio och inga aktiva listningar), och att
  // skicka in en noindex-URL i sitemapen ger "Submitted URL marked noindex" i
  // Search Console. Samma rollfilter som marknadsplatsen använder.
  const { data: creators } = await supabase
    .from("profiles")
    .select("id, slug, updated_at, bio")
    .in("role", SELLER_ROLE_VALUES)
    .eq("is_public", true)
    .order("updated_at", { ascending: false })
    .limit(500);

  // Aktiva listningar. Ett daterat evenemang bor på /event/[slug] sedan #326 —
  // /listing omdirigerar dit. Att lista omdirigeringar i en sitemap är att be
  // Google indexera en vidarekoppling i stället för sidan, så vi pekar direkt.
  // Tjänster och klippkort saknar datum och bor kvar på /listing.
  const { data: listings } = await supabase
    .from("listings")
    .select("id, slug, updated_at, event_date, series_slug, user_id")
    .eq("is_active", true)
    .eq("is_public", true)
    .order("updated_at", { ascending: false })
    .limit(1000);

  const listingPages: MetadataRoute.Sitemap = (listings || []).map((l) => ({
    url: `${baseUrl}/${l.event_date ? "event" : "listing"}/${l.slug || l.id}`,
    lastModified: l.updated_at ? new Date(l.updated_at) : new Date(),
    changeFrequency: "weekly" as const,
    // Ett passerat evenemang finns kvar som bibliotek men är inte det vi vill
    // att någon landar på från en sökning.
    priority: l.event_date && l.event_date < todayStockholm() ? 0.3 : 0.6,
  }));

  // Profiler med något att visa. /creators sätter noindex på en tunn profil
  // (ingen bio OCH inga aktiva listningar); sitemapen följer samma regel, så
  // vi inte skickar in en URL vi själva ber Google låta bli.
  const medInnehall = new Set((listings || []).map((l) => l.user_id));
  const creatorPages: MetadataRoute.Sitemap = (creators || [])
    .filter((c) => (c.bio && c.bio.trim()) || medInnehall.has(c.id))
    .map((c) => ({
      url: `${baseUrl}/creators/${c.slug || c.id}`,
      lastModified: c.updated_at ? new Date(c.updated_at) : new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));

  // Serierna. En serie samlar alla kommande tillfällen på en adress som inte
  // åldras när en kväll passerat — ofta den bättre träffen för en sökning på
  // återkommande arrangemang, och den fanns inte i sitemapen alls.
  const seriesSlugs = Array.from(
    new Set((listings || []).map((l) => l.series_slug).filter((x): x is string => !!x))
  );
  const seriesPages: MetadataRoute.Sitemap = seriesSlugs.map((slug) => ({
    url: `${baseUrl}/series/${slug}`,
    lastModified: new Date(),
    changeFrequency: "daily" as const,
    priority: 0.7,
  }));

  // Lokalsidor.
  const { data: venues } = await supabase.from("venues").select("id, name").limit(500);
  const venuePages: MetadataRoute.Sitemap = (venues || []).map((v) => ({
    url: `${baseUrl}/platser/${v.id}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.5,
  }));

  // City landing pages — only cities that actually have content, derived from
  // the real city column (not the raw address, which starts with the venue).
  const { data: listingCities } = await supabase
    .from("listings")
    .select("event_city")
    .eq("is_active", true)
    .eq("is_public", true)
    .not("event_city", "is", null);

  const upplevelserCitySet = new Set<string>();
  (listingCities || []).forEach((l) => {
    const c = l.event_city?.trim().toLowerCase();
    if (c) upplevelserCitySet.add(c);
  });

  const { data: creatorCities } = await supabase
    .from("profiles")
    .select("location")
    .eq("is_public", true)
    .not("location", "is", null);

  const creatorCitySet = new Set<string>();
  (creatorCities || []).forEach((p) => {
    const c = p.location?.trim().toLowerCase();
    if (c) creatorCitySet.add(c);
  });

  const cityPages: MetadataRoute.Sitemap = [
    ...Array.from(upplevelserCitySet).map((city) => ({
      url: `${baseUrl}/upplevelser/${encodeURIComponent(city)}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...Array.from(creatorCitySet).map((city) => ({
      url: `${baseUrl}/creators/stad/${encodeURIComponent(city)}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];

  const all = [...staticPages, ...creatorPages, ...listingPages, ...seriesPages, ...venuePages, ...cityPages];

  // Språkvarianterna med i sitemapen. Sajten byter språk på cookie, så utan
  // ?lang= finns det bara en adress per sida och de andra två språken kan
  // aldrig hittas av en sökmotor. Samma uppsättning som sidornas egna
  // hreflang-taggar, så de två källorna säger samma sak.
  return all.map((entry) => ({
    ...entry,
    alternates: { languages: languageAlternates(entry.url.replace(baseUrl, "") || "/") },
  }));
}
