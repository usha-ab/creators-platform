import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { getTranslations, getLocale } from "next-intl/server";
import { ListingCard } from "@/components/listing-card";
import type { SerieGrupp } from "@/lib/listings/group-series";

const DATE_LOCALES: Record<string, string> = { sv: "sv-SE", en: "en-GB", es: "es-ES" };

type Kort = Parameters<typeof ListingCard>[0]["listing"] & {
  series_id?: string | null;
};

/**
 * Ett kort för en hel serie, med resten av datumen bakom en utfällning.
 *
 * The Lab går två kvällar i veckan, så utan det här fyller en enda serie hela
 * listan med nästan identiska kort. Nu representeras serien av sin närmaste
 * kväll, och "fler tillfällen" visar resten — utan att någon behöver lämna
 * sidan för att se om det passar en annan vecka.
 *
 * <details> valt med flit: det fungerar utan JS och går att öppna innan sidan
 * hydrerat, vilket spelar roll på en telefon i en lokal med dålig täckning.
 */
export async function SeriesCard({
  grupp,
  bookingCount = 0,
  isPromoted,
}: {
  grupp: SerieGrupp<Kort>;
  bookingCount?: number;
  isPromoted?: boolean;
}) {
  const t = await getTranslations("seriesCard");
  const dateLocale = DATE_LOCALES[await getLocale()] ?? "en-GB";

  if (grupp.fler === 0) {
    return <ListingCard listing={grupp.forsta} bookingCount={bookingCount} isPromoted={isPromoted} />;
  }

  const ovriga = grupp.alla.slice(1);

  return (
    <div>
      <ListingCard listing={grupp.forsta} bookingCount={bookingCount} isPromoted={isPromoted} />
      <details className="group mt-1.5 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)]">
        <summary className="flex cursor-pointer items-center justify-between gap-2 px-3.5 py-2.5 text-xs font-medium text-[var(--usha-muted)] transition hover:text-[var(--usha-white)] [&::-webkit-details-marker]:hidden">
          {t("more", { count: grupp.fler })}
          <ChevronDown size={14} className="shrink-0 transition group-open:rotate-180" />
        </summary>
        <ul className="border-t border-[var(--usha-border)] px-1.5 py-1.5">
          {ovriga.map((l) => (
            <li key={l.id}>
              <Link
                href={`/event/${l.slug || l.id}`}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-xs text-[var(--usha-muted)] transition hover:bg-[var(--usha-black)] hover:text-[var(--usha-white)]"
              >
                <span>
                  {l.event_date
                    ? new Date(`${l.event_date}T12:00:00`).toLocaleDateString(dateLocale, {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })
                    : ""}
                </span>
                <span className="text-[var(--usha-gold)]">{t("book")}</span>
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
