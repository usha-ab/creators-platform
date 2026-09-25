import Link from "next/link";
import { MapPin, Calendar, Flame, Star } from "lucide-react";
import { getTranslations, getLocale } from "next-intl/server";
import { BuyTicketCta } from "@/components/buy-ticket-cta";
import { getSaleState } from "@/lib/listings/sale-state";

// UI-locale → BCP 47-tagg för datumformatering (annars blir månadsnamnen
// svenska även på engelska/spanska sidor).
const DATE_LOCALES: Record<string, string> = { sv: "sv-SE", en: "en-GB", es: "es-ES" };

interface ListingCardProps {
  listing: {
    id: string;
    slug?: string | null;
    title: string;
    price: number | null;
    event_date: string | null;
    event_location: string | null;
    event_city?: string | null;
    event_venue?: string | null;
    category: string | null;
    image_url: string | null;
    // Biljettyperna följer med från sidans select (ticket_types(price)).
    // Utan dem visar kortet listpriset som om det vore det enda, och en kväll
    // med practica 50 / workshop 100 / social 130 säljs in som "50 kr".
    ticket_types?: { price: number | null }[] | null;
  };
  bookingCount?: number;
  isPromoted?: boolean;
}

export async function ListingCard({ listing, bookingCount = 0, isPromoted }: ListingCardProps) {
  const t = await getTranslations();
  const dateLocale = DATE_LOCALES[await getLocale()] ?? "en-GB";
  // Passerade event ligger kvar som bläddringsbart bibliotek, men säljs inte.
  const isPast =
    getSaleState({ price: listing.price, event_date: listing.event_date }, new Date()).state === "past";
  const isPopular = bookingCount >= 3;
  const isHot = bookingCount >= 8;

  const tierPrices = (listing.ticket_types ?? [])
    .map((tt) => tt.price)
    .filter((p): p is number => typeof p === "number");
  const hasTicketTypes = tierPrices.length > 0;
  // "Från" bara när det finns en riktig spännvidd. En enda typ, eller flera
  // med samma pris, är inte "från" — det är priset.
  const showFrom = new Set(tierPrices).size > 1;
  const displayPrice = hasTicketTypes ? Math.min(...tierPrices) : listing.price;

  return (
    <Link
      href={`/listing/${listing.slug || listing.id}`}
      className={`group relative overflow-hidden rounded-xl border bg-[var(--usha-card)] transition hover:border-[var(--usha-gold)]/30 ${isPromoted ? "border-[var(--usha-gold)]/20 ring-1 ring-[var(--usha-gold)]/10" : "border-[var(--usha-border)]"}`}
    >
      {/* Badges — top-left overlay */}
      {(isPromoted || isHot || isPopular) && (
        <div className="absolute left-2 top-2 z-10 flex flex-col gap-1">
          {isPromoted && (
            <span className="flex items-center gap-1 rounded-full bg-[var(--usha-gold)] px-2 py-0.5 text-[9px] font-bold uppercase text-black shadow-sm">
              <Star size={8} /> {t("listingCard.badgePromoted")}
            </span>
          )}
          {isHot && (
            <span className="flex items-center gap-1 rounded-full bg-red-500/90 px-2 py-0.5 text-[9px] font-bold uppercase text-white shadow-sm">
              <Flame size={8} /> {t("listingCard.badgePopular")}
            </span>
          )}
          {isPopular && !isHot && (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-medium text-white shadow-sm backdrop-blur-sm">
              {t("listingCard.badgeBookings", { count: bookingCount })}
            </span>
          )}
        </div>
      )}

      {/* Image */}
      {listing.image_url ? (
        <div className="aspect-video overflow-hidden">
          <img
            src={listing.image_url}
            alt={listing.title}
            className="h-full w-full object-cover transition group-hover:scale-105"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="flex aspect-video items-center justify-center bg-[var(--usha-gold)]/5">
          <Calendar size={24} className="text-[var(--usha-gold)]/30" />
        </div>
      )}

      {/* Content */}
      <div className="p-3">
        <p className="truncate text-sm font-semibold">{listing.title}</p>
        <div className="mt-1 flex items-center gap-2 text-xs text-[var(--usha-muted)]">
          {listing.event_date && (
            <span className="flex items-center gap-0.5">
              <Calendar size={10} />
              {new Date(listing.event_date).toLocaleDateString(dateLocale, { day: "numeric", month: "short" })}
            </span>
          )}
          {(listing.event_venue || listing.event_city || listing.event_location) && (
            <span className="flex items-center gap-0.5">
              <MapPin size={10} />
              {[listing.event_venue, listing.event_city].filter(Boolean).join(" · ") ||
                listing.event_location?.split(",")[0]}
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--usha-gold)]">
            {displayPrice
              ? t(showFrom ? "listingCard.fromPrice" : "listingCard.price", { price: displayPrice })
              : t("listingCard.free")}
          </span>
          {listing.category && (
            <span className="rounded-full bg-[var(--usha-gold)]/10 px-2 py-0.5 text-[10px] text-[var(--usha-gold)]">
              {t(`categories.${listing.category}`)}
            </span>
          )}
        </div>
        {isPast ? (
          <div className="mt-2.5 w-full rounded-lg border border-[var(--usha-border)] px-3 py-2 text-center text-xs font-semibold text-[var(--usha-muted)]">
            {t("eventPage.badgePast")}
          </div>
        ) : (
          <BuyTicketCta
            listingId={listing.id}
            slug={listing.slug}
            price={displayPrice}
            hasTicketTypes={hasTicketTypes}
            fromPrice={showFrom}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-3 py-2 text-xs font-semibold text-black transition hover:opacity-90"
          />
        )}
      </div>
    </Link>
  );
}
