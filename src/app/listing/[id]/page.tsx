export const revalidate = 60; // ISR: revalidate every 60 seconds

import { createClient } from "@/lib/supabase/server";
import { getTranslations, getLocale } from "next-intl/server";
import { safeJsonLd } from "@/lib/json-ld";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import type { ExperienceDetails } from "@/types/database";
import Link from "next/link";
import Image from "next/image";
import {
  MapPin,
  Clock,
  Calendar,
  ArrowLeft,
  Users,
  User,
} from "lucide-react";
import BookingForm from "@/app/creators/[id]/booking-form";
import { BuyTicketButton } from "@/components/buy-ticket-button";
import { InstructorMinutesCard } from "@/components/instructor-minutes-card";
import { EventMap } from "@/components/event-map";
import { CATEGORY_LABELS } from "@/lib/categories";
import { calculateDiscountedPrice } from "@/lib/stripe/commission";
import { canReceivePayments } from "@/lib/payments/beta-gate";
import { indexable } from "@/lib/seo/metadata";

interface Props {
  params: Promise<{ id: string }>;
}

function isUUID(str: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const supabase = await createClient();
  const column = isUUID(params.id) ? "id" : "slug";
  const { data: listing } = await supabase
    .from("listings")
    .select("title, description, event_location, image_url, slug, id")
    .eq(column, params.id)
    .eq("is_active", true)
    .single();

  // Not found / inactive / archived → not indexable (the page itself 404s).
  const tMeta = await getTranslations("listingPage");
  if (!listing) return { title: tMeta("metaFallbackTitle"), robots: { index: false } };

  const description = listing.description?.slice(0, 160) || `${listing.title} på Usha Platform`;
  const url = `https://usha.se/listing/${listing.slug || listing.id}`;
  // Thin/empty listing (no description and no location) → noindex.
  const isThin = !listing.description && !listing.event_location;

  return {
    title: `${listing.title} – Usha Platform`,
    description,
    ...(isThin ? { robots: { index: false } } : {}),
    ...indexable(`/listing/${listing.slug ?? listing.id}`),
    openGraph: {
      title: `${listing.title} – Usha Platform`,
      description,
      url,
      type: "website",
      ...(listing.image_url ? { images: [{ url: listing.image_url, width: 1200, height: 630, alt: listing.title }] } : {}),
    },
  };
}

export default async function ListingDetailPage(props: Props) {
  const params = await props.params;
  const supabase = await createClient();

  const column = isUUID(params.id) ? "id" : "slug";
  const t = await getTranslations("listingPage");
  const tEvent = await getTranslations("eventPage");
  // Datumet följde hårdkodat sv-SE och gav svensk veckodag och månad även på
  // en engelsk sida. Samma karta som listing-card använder.
  const dateLocale = ({ sv: "sv-SE", en: "en-GB", es: "es-ES" } as Record<string, string>)[
    await getLocale()
  ] ?? "en-GB";
  const [{ data: listing }, { data: { user } }] = await Promise.all([
    supabase
      .from("listings")
      .select(
        "id, title, description, category, price, duration_minutes, event_date, event_time, event_end_time, event_location, event_lat, event_lng, event_place_id, image_url, listing_type, min_guests, max_guests, experience_details, user_id, is_active, slug, series_id, series_slug, open_to_instructors"
      )
      .eq(column, params.id)
      .eq("is_active", true)
      .single(),
    supabase.auth.getUser(),
  ]);

  if (!listing) {
    // A bare series slug (e.g. "the-kiz-lab") has no listing of its own —
    // send it to the series landing page if one exists.
    if (!isUUID(params.id)) {
      const { data: seriesMatch } = await supabase
        .from("listings")
        .select("id")
        .eq("series_slug", params.id)
        .eq("is_active", true)
        .limit(1);
      if (seriesMatch && seriesMatch.length > 0) redirect(`/series/${params.id}`);
    }
    notFound();
  }

  // Ett daterat evenemang har en riktig eventsida. Den här sidan var en andra,
  // svagare variant av samma sak: ingen delaknapp, inga biljettpriser utöver
  // grundpriset, och all text hårdkodad på svenska. Profilen länkade hit medan
  // marknadsplatsen länkade till /event, så vilken sida en besökare mötte
  // berodde på var hen kom ifrån.
  //
  // Omdirigeringen sitter här i stället för att länkarna rättas på sex ställen,
  // eftersom den också fångar /listing-adresser som redan delats.
  // /event/[slug] slår upp både slug och rått id.
  if (listing.event_date) {
    redirect(`/event/${listing.slug || listing.id}`);
  }

  // Fetch creator profile
  const { data: creator } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, category, company_verified_at, slug")
    .eq("id", listing.user_id)
    .single();

  if (!creator) notFound();

  // Typed events (price tiers) can't be bought from the compact inline button —
  // the buyer must pick a tier on the full event page.
  const { count: ticketTypeCount } = await supabase
    .from("ticket_types")
    .select("id", { count: "exact", head: true })
    .eq("listing_id", listing.id);
  const hasTicketTypes = (ticketTypeCount ?? 0) > 0;

  // Instructors offering paid mini-sessions at this open event
  type EventInstructor = {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
    coaching_specialties: string[] | null;
    coaching_hourly_rate_sek: number | null;
  };
  let eventInstructors: EventInstructor[] = [];
  if (listing.open_to_instructors) {
    const { data: joined } = await supabase
      .from("event_instructors")
      .select("profiles!event_instructors_instructor_id_fkey(id, full_name, avatar_url, coaching_specialties, coaching_hourly_rate_sek)")
      .eq("listing_id", listing.id);
    const candidates = ((joined ?? []) as unknown as { profiles: EventInstructor | null }[])
      .map((r) => r.profiles)
      .filter((p): p is EventInstructor => !!p && !!p.coaching_hourly_rate_sek && p.coaching_hourly_rate_sek > 0);
    // Bara instruktörer som kan ta betalt visas — Connect-status via RPC eftersom
    // stripe_account_id inte är läsbart för anon/authenticated.
    const connected = await Promise.all(
      candidates.map((p) => supabase.rpc("has_stripe_connect", { p_id: p.id }))
    );
    eventInstructors = candidates.filter((_, i) => !!connected[i]?.data);
  }

  // Get visitor tier for discounts
  let visitorTier: string | null = null;
  if (user) {
    const { data: vp } = await supabase
      .from("profiles")
      .select("tier")
      .eq("id", user.id)
      .single();
    visitorTier = vp?.tier ?? null;
  }

  const isLoggedIn = !!user;
  const isOwner = user?.id === listing.user_id;
  // stripe_account_id är inte läsbart för anon/authenticated (kolumn-lockdown);
  // härled bara booleanet via SECURITY DEFINER-funktionen has_stripe_connect.
  const { data: hasConnectData } = await supabase.rpc("has_stripe_connect", { p_id: creator.id });
  const hasConnect = !!hasConnectData;
  const payeeCanReceive = canReceivePayments({
    id: creator.id,
    company_verified_at: (creator as { company_verified_at?: string | null }).company_verified_at ?? null,
  });
  const details = listing.experience_details as ExperienceDetails | null;
  const creatorUrl = creator.slug ? `/${creator.slug}` : `/creators/${creator.id}`;

  const jsonLd: Record<string, any> = {
    "@context": "https://schema.org",
    "@type": listing.listing_type === "event" ? "Event" : "Service",
    name: listing.title,
    url: `https://usha.se/listing/${listing.slug || listing.id}`,
    ...(listing.description ? { description: listing.description.slice(0, 300) } : {}),
    ...(listing.image_url ? { image: listing.image_url } : {}),
    ...(listing.price != null ? {
      offers: {
        "@type": "Offer",
        price: listing.price,
        priceCurrency: "SEK",
        availability: "https://schema.org/InStock",
      },
    } : {}),
    ...(creator ? {
      organizer: {
        "@type": "Person",
        name: creator.full_name || "Creator",
        url: `https://usha.se/creators/${creator.slug || creator.id}`,
      },
    } : {}),
  };

  if (listing.listing_type === "event") {
    if (listing.event_date) {
      jsonLd.startDate = listing.event_time
        ? `${listing.event_date}T${listing.event_time}`
        : listing.event_date;
    }
    if (listing.event_location) {
      jsonLd.location = {
        "@type": "Place",
        name: listing.event_location,
        ...(listing.event_lat && listing.event_lng ? {
          geo: { "@type": "GeoCoordinates", latitude: listing.event_lat, longitude: listing.event_lng },
        } : {}),
      };
    }
  }

  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
      />
      {/* Header */}
      <header className="border-b border-[var(--usha-border)]">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 md:px-6">
          <Link href={isLoggedIn ? "/app" : "/"} className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--usha-gold)] to-[var(--usha-accent)]">
              <span className="text-sm font-bold text-black">U</span>
            </div>
            <span className="text-lg font-bold tracking-tight">Usha Platform</span>
          </Link>
          {isLoggedIn ? (
            <Link
              href="/app"
              className="rounded-lg bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90"
            >
              Appen
            </Link>
          ) : (
            <Link
              href="/signup"
              className="rounded-lg bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90"
            >
              Kom igång
            </Link>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8">
        <Link
          href={creatorUrl}
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-[var(--usha-muted)] transition-colors hover:text-[var(--usha-white)]"
        >
          <ArrowLeft size={14} />
          {t("backTo", { name: creator.full_name || t("creatorFallbackLower") })}
        </Link>

        {/* min-w-0 på båda grid-barnen: ett grid-spår tar annars minst sitt
            innehålls min-content-bredd, och ett enda obrytbart stycke drar ut
            spåret förbi skärmkanten — då hamnar kartan och biljettrutan utanför
            till höger på mobil, medan texten ovanför ser ok ut. Samma fix som
            redan gjorts på /event/[slug]. */}
        <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
          {/* Main content */}
          <div className="min-w-0">
            {/* Event image */}
            {listing.image_url && (
              <div className="mb-6 overflow-hidden rounded-2xl">
                <img
                  src={listing.image_url}
                  alt={listing.title}
                  className="w-full max-h-[260px] object-cover sm:max-h-[340px] md:max-h-[420px]"
                />
              </div>
            )}

            {/* Title & category */}
            <div className="mb-6">
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded-full border border-[var(--usha-border)] px-3 py-0.5 text-xs text-[var(--usha-muted)]">
                  {CATEGORY_LABELS[listing.category] || listing.category}
                </span>
                {listing.price != null && (
                  <span className="rounded-full bg-[var(--usha-gold)]/10 px-3 py-0.5 text-xs font-semibold text-[var(--usha-gold)]">
                    {listing.price > 0 ? `${listing.price} SEK` : t("free")}
                  </span>
                )}
              </div>
              <h1 className="text-2xl font-bold sm:text-3xl">{listing.title}</h1>
            </div>

            {/* Date, time, location, duration */}
            {(listing.event_date || listing.event_time || listing.event_location || listing.duration_minutes) && (
              <div className="mb-6 flex flex-wrap gap-3 text-xs text-[var(--usha-muted)] sm:gap-4 sm:text-sm">
                {listing.event_date && (
                  <span className="flex items-center gap-1.5">
                    <Calendar size={14} className="text-[var(--usha-gold)]" />
                    {new Date(listing.event_date + "T00:00").toLocaleDateString(dateLocale, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                )}
                {listing.event_time && (
                  <span className="flex items-center gap-1.5">
                    <Clock size={14} className="text-[var(--usha-gold)]" />
                    {listing.event_time.slice(0, 5)}
                    {listing.event_end_time && ` – ${listing.event_end_time.slice(0, 5)}`}
                  </span>
                )}
                {listing.duration_minutes && (
                  <span className="flex items-center gap-1.5">
                    <Clock size={14} />
                    {listing.duration_minutes} min
                  </span>
                )}
                {listing.event_location && (
                  <span className="flex items-center gap-1.5">
                    <MapPin size={14} className="text-[var(--usha-gold)]" />
                    {listing.event_location}
                  </span>
                )}
                {listing.max_guests && (
                  <span className="flex items-center gap-1.5">
                    <Users size={14} />
                    {listing.min_guests ?? 1}–{listing.max_guests} gäster
                  </span>
                )}
              </div>
            )}

            {/* Part of a recurring series */}
            {listing.series_slug && (
              <Link
                href={`/series/${listing.series_slug}`}
                className="mb-6 inline-flex items-center gap-2 rounded-xl border border-[var(--usha-gold)]/30 bg-[var(--usha-gold)]/5 px-4 py-2.5 text-sm font-medium text-[var(--usha-gold)] transition hover:bg-[var(--usha-gold)]/10"
              >
                <Calendar size={14} />
                Visa alla tillfällen i serien
              </Link>
            )}

            {/* Description */}
            {listing.description && (
              <div className="mb-6">
                <h2 className="mb-2 text-lg font-semibold">{t("aboutHeading")}</h2>
                {/* min-w-0 låter spåret krympa, men en obrytbar sträng — en
                    lång adress, eller dekorativa tecken utan mellanrum — spränger
                    ändå sin egen ruta. Samma skydd som /event/[slug] har. */}
                <p className="whitespace-pre-line [overflow-wrap:anywhere] text-sm leading-relaxed text-[var(--usha-muted)]">
                  {listing.description}
                </p>
              </div>
            )}

            {/* Experience details */}
            {details?.included?.length ? (
              <div className="mb-6">
                <h2 className="mb-2 text-lg font-semibold">{t("includedHeading")}</h2>
                <div className="flex flex-wrap gap-2">
                  {details.included.map((item) => (
                    <span
                      key={item}
                      className="rounded-full bg-[var(--usha-gold)]/10 px-3 py-1 text-xs font-medium text-[var(--usha-gold)]"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {details?.amenities?.length ? (
              <div className="mb-6">
                <h2 className="mb-2 text-lg font-semibold">{t("amenitiesHeading")}</h2>
                <div className="flex flex-wrap gap-2">
                  {details.amenities.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-[var(--usha-border)] px-3 py-1 text-xs text-[var(--usha-muted)]"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Kartan bor i EventMap, som också kan rita en plats som bara
                finns som fri text — här visades ingenting utan koordinater. */}
            <EventMap
              lat={listing.event_lat}
              lng={listing.event_lng}
              placeId={listing.event_place_id}
              location={listing.event_location}
              city="Stockholm"
              heading={tEvent("mapHeading")}
              linkLabel={tEvent("openInMaps")}
            />
          </div>

          {/* Sidebar — booking + creator */}
          <div className="min-w-0 space-y-4">
            {/* Booking card */}
            <div className="space-y-4 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-5 sm:p-6 lg:sticky lg:top-6">
              {isOwner && (
                <p className="text-center text-xs text-[var(--usha-muted)]">
                  {t("ownerPreview")}
                </p>
              )}
              <div className="text-center">
                {listing.price != null && (
                  <p className="text-2xl font-bold text-[var(--usha-gold)]">
                    {listing.price > 0 ? `${listing.price} SEK` : t("free")}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-3">
                {/* Tickets are only for events. Services (e.g. private lessons)
                    are booked via BookingForm, not sold as tickets. */}
                {listing.listing_type === "event" &&
                  listing.price != null &&
                  listing.price > 0 && (
                    <BuyTicketButton
                      listingId={listing.id}
                      originalPrice={listing.price}
                      discountedPrice={calculateDiscountedPrice(listing.price, visitorTier)}
                      isLoggedIn={isLoggedIn}
                      hasConnect={hasConnect}
                      hasTicketTypes={hasTicketTypes}
                      eventSlug={listing.slug}
                    />
                  )}
                <BookingForm
                  listing={listing}
                  creatorId={creator.id}
                  isLoggedIn={isLoggedIn}
                  hasConnect={hasConnect}
                  payeeCanReceive={payeeCanReceive}
                />
              </div>
            </div>

            {/* Creator card */}
            <Link
              href={creatorUrl}
              className="flex items-center gap-3 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4 transition hover:border-[var(--usha-gold)]/30"
            >
              {creator.avatar_url ? (
                <Image
                  src={creator.avatar_url}
                  alt={creator.full_name || ""}
                  width={48}
                  height={48}
                  className="h-12 w-12 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[var(--usha-gold)]/20 to-[var(--usha-accent)]/20">
                  <User size={20} className="text-[var(--usha-gold)]" />
                </div>
              )}
              <div>
                <p className="font-semibold">{creator.full_name || t("creatorFallback")}</p>
                <p className="text-xs text-[var(--usha-muted)]">
                  {CATEGORY_LABELS[creator.category] || creator.category} · Visa profil
                </p>
              </div>
            </Link>

            {/* Instructors offering paid mini-sessions at this event */}
            {eventInstructors.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold">{t("instructorsHeading")}</h2>
                {eventInstructors.map((ins) => (
                  <InstructorMinutesCard
                    key={ins.id}
                    listingId={listing.id}
                    instructorId={ins.id}
                    instructorName={ins.full_name || t("instructorFallback")}
                    avatarUrl={ins.avatar_url}
                    specialties={ins.coaching_specialties ?? []}
                    hourlyRate={ins.coaching_hourly_rate_sek as number}
                    isLoggedIn={isLoggedIn}
                    disabledReason={user?.id === ins.id ? t("thatIsYou") : undefined}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
