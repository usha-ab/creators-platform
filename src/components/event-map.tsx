import { MapPin } from "lucide-react";

/**
 * Kartan på ett evenemang.
 *
 * Fanns tidigare bara på /listing/[id] och bara när evenemanget hade
 * koordinater. Åtta av plattformens kvällar har adressen som fri text
 * ("Bacchi Syre") eftersom den skrevs för hand i stället för att väljas ur
 * platsväljaren — de fick alltså ingen karta alls, och den publika eventsidan
 * hade ingen karta ens när koordinaterna fanns.
 *
 * Google Maps Embed API tar tre sorters plats. Den här komponenten väljer den
 * mest exakta som finns och visar inget alls när det inte finns någon plats:
 *
 *   1. lat/lng      — exakt punkt, från platsväljaren
 *   2. place_id     — Googles egen identifierare, lika exakt
 *   3. fri text     — "Bacchi Syre, Stockholm". Google söker, och för ett
 *                     namngivet ställe hamnar nålen nästan alltid rätt.
 *
 * Länken under kartan går till riktiga Google Maps, där man får vägbeskrivning.
 * Den är viktigare än kartan: på en telefon är det den som tar folk fram.
 */
import { buildMapsHref } from "@/lib/listings/maps";

export function EventMap({
  lat,
  lng,
  placeId,
  location,
  city,
  locale = "sv",
  heading,
  linkLabel,
}: {
  lat?: number | null;
  lng?: number | null;
  placeId?: string | null;
  location?: string | null;
  /** Läggs till fritextsökningen så "Bacchi Syre" inte hamnar i fel land. */
  city?: string | null;
  locale?: string;
  heading: string;
  linkLabel: string;
}) {
  const hasCoords = typeof lat === "number" && typeof lng === "number";

  // Fritexten får en ort på sig när sökningen annars vore tvetydig. Står orten
  // redan i adressen läggs den inte till en gång till.
  const textQuery =
    location && city && !location.toLowerCase().includes(city.toLowerCase())
      ? `${location}, ${city}`
      : location;

  const embedQuery = hasCoords
    ? `${lat},${lng}`
    : placeId
      ? `place_id:${placeId}`
      : textQuery || null;

  if (!embedQuery) return null;

  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  // Utan nyckel blir iframen en grå ruta med ett felmeddelande från Google.
  // Då är länken ensam bättre än en trasig karta.
  const showEmbed = !!key;

  // Länken ut prioriterar NAMNET, inte koordinaterna — tvärtemot inbäddningen.
  // Koordinater ger en namnlös nål i Google Maps: ingen infokarta, inga
  // öppettider, inget foto, bara "59.32, 18.07". Med namnet öppnas stället som
  // ett ställe, med Vägbeskrivning-knappen och allt Google vet om det.
  // place_id läggs till när det finns, så rätt ställe träffas även om namnet
  // är tvetydigt. Saknas namn helt faller vi tillbaka på koordinaterna.
  const mapsHref = buildMapsHref({ location, city, placeId, lat, lng });

  return (
    <section className="mt-8">
      <h2 className="mb-2 text-lg font-semibold">{heading}</h2>
      <div className="overflow-hidden rounded-xl border border-[var(--usha-border)]">
        {showEmbed && (
          <iframe
            title={heading}
            width="100%"
            height="200"
            style={{ border: 0 }}
            className="block sm:h-[300px]"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            src={`https://www.google.com/maps/embed/v1/place?key=${key}&q=${encodeURIComponent(
              embedQuery
            )}&zoom=15&language=${encodeURIComponent(locale)}`}
          />
        )}
        <a
          href={mapsHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 bg-[var(--usha-card)] px-4 py-3 text-sm text-[var(--usha-muted)] transition hover:text-[var(--usha-white)]"
        >
          <MapPin size={14} className="shrink-0 text-[var(--usha-gold)]" />
          <span className="min-w-0 flex-1 truncate">{location || linkLabel}</span>
          <span className="shrink-0 text-xs text-[var(--usha-gold)]">{linkLabel}</span>
        </a>
      </div>
    </section>
  );
}
