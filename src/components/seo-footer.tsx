import Link from "next/link";
import { FollowUs } from "@/components/follow-us";
import { CATEGORIES } from "@/lib/categories";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";

const FALLBACK_CITIES = [
  "Stockholm", "Göteborg", "Malmö", "Uppsala", "Linköping", "Örebro",
  "Västerås", "Helsingborg", "Norrköping", "Jönköping", "Umeå", "Lund",
];

export async function SeoFooter() {
  const t = await getTranslations();
  let cities: string[] = FALLBACK_CITIES;

  try {
    const supabase = await createClient();

    // event_city, inte event_location. Adressen inleds med lokalen, så
    // split(",")[0] gav "Bacchi Syre" — en länk till /upplevelser/bacchi-syre,
    // som filtrerar på stad och alltid svarade "0 upplevelser hittade".
    const { data: listingLocations } = await supabase
      .from("listings")
      .select("event_city")
      .eq("is_active", true)
      .eq("is_public", true)
      .not("event_city", "is", null);

    // Get top cities from public profiles
    const { data: profileLocations } = await supabase
      .from("profiles")
      .select("location")
      .eq("is_public", true)
      .not("location", "is", null);

    const cityCounts: Record<string, number> = {};
    [...(listingLocations || []), ...(profileLocations || [])].forEach((item) => {
      const raw = (item as any).event_city || (item as any).location;
      // Profilernas location är fortfarande fritext och kan bära hela adressen.
      const city = raw?.split(",")[0]?.trim();
      if (city && city.length > 1) {
        cityCounts[city] = (cityCounts[city] || 0) + 1;
      }
    });

    const sorted = Object.entries(cityCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([city]) => city);

    // Finns det ens en stad med riktigt innehåll är den bättre än tolv
    // påhittade. Fallbacklistan gäller bara en helt tom databas.
    if (sorted.length > 0) cities = sorted;
  } catch {}

  return (
    <footer className="border-t border-[var(--usha-border)] bg-[var(--usha-black)]">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-3">
          {/* Upplevelser per stad */}
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--usha-muted)]">
              {t("seoFooter.experiencesHeading")}
            </h3>
            <div className="flex flex-col gap-1.5">
              {cities.slice(0, 10).map((city) => (
                <Link
                  key={city}
                  href={`/upplevelser/${encodeURIComponent(city.toLowerCase())}`}
                  className="text-xs text-[var(--usha-muted)] transition hover:text-[var(--usha-gold)]"
                >
                  {t("seoFooter.experiencesInCity", { city })}
                </Link>
              ))}
            </div>
          </div>

          {/* Kreatörer per stad */}
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--usha-muted)]">
              {t("seoFooter.creatorsHeading")}
            </h3>
            <div className="flex flex-col gap-1.5">
              {cities.slice(0, 10).map((city) => (
                <Link
                  key={city}
                  href={`/creators/stad/${encodeURIComponent(city.toLowerCase())}`}
                  className="text-xs text-[var(--usha-muted)] transition hover:text-[var(--usha-gold)]"
                >
                  {t("seoFooter.creatorsInCity", { city })}
                </Link>
              ))}
            </div>
          </div>

          {/* Populära kategorier */}
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--usha-muted)]">
              {t("seoFooter.categoriesHeading")}
            </h3>
            <div className="flex flex-col gap-1.5">
              {CATEGORIES.filter((c) => c.value !== "other").map((cat) => (
                <Link
                  key={cat.value}
                  href={`/upplevelser?category=${cat.value}`}
                  className="text-xs text-[var(--usha-muted)] transition hover:text-[var(--usha-gold)]"
                >
                  {t(`categories.${cat.value}`)}
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Cross-links: city + category combos */}
        <div className="mt-8 border-t border-[var(--usha-border)] pt-6">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {cities.slice(0, 6).flatMap((city) =>
              CATEGORIES.filter((c) => c.value !== "other")
                .slice(0, 4)
                .map((cat) => (
                  <Link
                    key={`${city}-${cat.value}`}
                    href={`/upplevelser/${encodeURIComponent(city.toLowerCase())}/${cat.value}`}
                    className="text-[10px] text-[var(--usha-muted)]/60 transition hover:text-[var(--usha-gold)]"
                  >
                    {t("experiences.seoCategoryInCity", { category: t(`categories.${cat.value}`), city })}
                  </Link>
                ))
            )}
          </div>
        </div>

        {/* Bottom */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--usha-border)] pt-6">
          <Link href="/" className="text-sm font-bold text-gradient">Usha Platform</Link>
          <FollowUs />
          <div className="flex gap-4">
            <Link href="/platser" className="text-[10px] text-[var(--usha-muted)] hover:text-[var(--usha-white)]">{t("seoFooter.places")}</Link>
            <Link href="/partner" className="text-[10px] text-[var(--usha-muted)] hover:text-[var(--usha-white)]">{t("seoFooter.partner")}</Link>
            <Link href="/privacy" className="text-[10px] text-[var(--usha-muted)] hover:text-[var(--usha-white)]">{t("seoFooter.privacyPolicy")}</Link>
            <Link href="/terms" className="text-[10px] text-[var(--usha-muted)] hover:text-[var(--usha-white)]">{t("seoFooter.terms")}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
