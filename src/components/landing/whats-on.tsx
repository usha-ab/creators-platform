import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { SeriesCard } from "@/components/series-card";
import { groupBySeries } from "@/lib/listings/group-series";
import { BROWSABLE_TYPES } from "@/lib/listings/browse";
import { todayStockholm } from "@/lib/listings/time-window";
import { getBookingCounts } from "@/lib/listings/popularity";
import { loadEveningCrew } from "@/lib/taxi/crew";

/**
 * Vad som händer — högst upp på startsidan.
 *
 * Startsidan öppnade med en helskärmshög pitch. En besökare som kommit från en
 * story, en QR-kod i dörren eller bion på Instagram fick alltså skrolla förbi
 * en hel skärm innan något konkret dök upp, trots att frågan nästan alltid är
 * densamma: vad händer, och när?
 *
 * Här ligger svaret i stället. Samma kort som på /upplevelser, men bara
 * kvällar med datum från i dag och framåt — inte tjänster utan datum och inte
 * klippkort. Frågan här är "vad händer, och när?".
 *
 * Renderas inte alls när utbudet är tomt. En rubrik över ett tomrum är sämre
 * än ingen rubrik.
 */
export async function WhatsOn() {
  const t = await getTranslations("landing.whatsOn");
  const supabase = await createClient();

  const { data: listings } = await supabase
    .from("listings")
    .select(
      "id, slug, title, price, event_date, event_location, event_city, event_venue, category, image_url, series_id, ticket_types(price)"
    )
    .eq("is_active", true)
    .eq("is_public", true)
    .or(BROWSABLE_TYPES)
    // Bara kvällar med datum. Datumlösa tjänster (PT-pass, företagsevent)
    // fick knappen "Köp biljett" bredvid danskvällarna och fick startsidan att
    // se ut som en annan sorts plattform. De finns kvar på /upplevelser.
    .gte("event_date", todayStockholm())
    // Närmast i tiden först; det som saknar datum hamnar sist, som i listan.
    .order("event_date", { ascending: true, nullsFirst: false })
    // Hämta brett och välj ut nedan — sex rader rakt av blev sex kvällar ur
    // samma två serier, med samma bild sex gånger.
    .limit(40);

  if (!listings || listings.length === 0) return null;

  // En post per serie. Utan det här såg startsidan ut som att Usha bara har en
  // enda sak på gång — sex gånger, med samma foto — medan kurserna och
  // coachingen trängdes undan.
  const urval = groupBySeries(listings).slice(0, 6);

  const [bookingCounts, crewByListing] = await Promise.all([
    getBookingCounts(supabase, urval.map((g) => g.forsta.id)),
    // Vem som är där — taxidansare och instruktörer — syns direkt på kortet.
    loadEveningCrew(urval.map((g) => g.forsta.id)),
  ]);

  return (
    <section className="relative px-4 pb-14 pt-2 sm:px-6 sm:pb-20 sm:pt-4">
      <div className="mx-auto max-w-6xl">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("heading")}</h2>
            <p className="mt-1 text-sm text-[var(--usha-muted)]">{t("sub")}</p>
          </div>
          <Link
            href="/upplevelser"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--usha-gold)] transition hover:gap-2.5"
          >
            {t("seeAll")}
            <ArrowRight size={15} />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {urval.map((g, i) => (
            <SeriesCard
              key={g.forsta.id}
              grupp={g}
              bookingCount={bookingCounts[g.forsta.id] ?? 0}
              crew={crewByListing.get(g.forsta.id)}
              // Första kortet är det största som syns vid start: prioritera bilden.
              priority={i === 0}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
