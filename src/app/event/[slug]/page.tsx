import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { collabRoleLabel } from "@/lib/collaborators";
import { applyPoolLimits } from "@/lib/tickets/pools";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Calendar, Clock, MapPin, Ticket, Users, Pencil } from "lucide-react";
import { EVENT_CATEGORY_LABELS } from "@/app/app/events/constants";
import { BookButton } from "./book-button";
import { WaitlistForm } from "./waitlist-form";
import { AccessCodeForm } from "./access-code-form";
import { getSaleState } from "@/lib/listings/sale-state";
import { getTranslations, getLocale, getMessages } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { SocialShareButton } from "@/components/social-share-button";
import { TrackEvent } from "@/components/track-event";
import { EventMap } from "@/components/event-map";

export const revalidate = 60;

const FALLBACK_IMAGE =
  "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1200&h=630&fit=crop";

interface Params {
  params: Promise<{ slug: string }>;
  /** `?tt=<biljettyp>` förväljer en biljettyp — se "Lägg till" på biljettsidan. */
  searchParams?: Promise<{ tt?: string }>;
}

function isUUID(str: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

/** Raden bakom ett litet evenemangskort längst ned på sidan. */
interface EventCard {
  id: string;
  title: string;
  slug: string | null;
  image_url: string | null;
  event_date: string | null;
  event_location: string | null;
  price: number | null;
  series_slug: string | null;
}

// Resolve a series slug (e.g. from a Facebook ticket link like /event/the-kiz-lab)
// to a concrete occurrence. Occurrences don't always carry their own `slug`
// (recurring instances are often created with slug=null), so fall back to the
// occurrence `id` — getListing() resolves either. Returns null only when the
// series has no active occurrence at all.
async function resolveSlugToOccurrence(slug: string): Promise<string | null> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data: upcoming } = await supabase
    .from("listings")
    .select("id, slug, event_date")
    .eq("series_slug", slug)
    .eq("is_active", true)
    .eq("is_public", true)
    .or(`event_date.gte.${today},event_date.is.null`)
    .order("event_date", { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (upcoming) return upcoming.slug ?? upcoming.id;

  const { data: latest } = await supabase
    .from("listings")
    .select("id, slug")
    .eq("series_slug", slug)
    .eq("is_active", true)
    .eq("is_public", true)
    .order("event_date", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return latest ? latest.slug ?? latest.id : null;
}

async function getListing(slug: string) {
  const supabase = await createClient();
  const { data: listing } = await supabase
    .from("listings")
    .select(
      "id, user_id, title, description, category, price, duration_minutes, image_url, image_url_square, event_date, event_time, event_end_time, event_location, event_place_id, event_lat, event_lng, slug, series_slug, is_active, content_language, organizer_name, early_bird_start, early_bird_end, early_bird_price, public_sale_at, capacity, tickets_sold, venue_profile_id, venue_confirmed_at"
    )
    .eq(isUUID(slug) ? "id" : "slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (!listing) return null;

  const { data: host } = await supabase
    .from("profiles")
    .select("id, full_name, slug, avatar_url, bankid_verified_at")
    .eq("id", listing.user_id)
    .maybeSingle();

  // Lokalen, när kopplingen är godkänd och lokalen är någon annan än
  // arrangören. Innan detta nämndes lokalen bara som text i platsraden medan
  // arrangören fick en klickbar profil — den som skannade en QR-kod i baren
  // såg alltså husets namn utan att kunna ta sig till huset. Kopplingen är
  // ömsesidig, presentationen ska vara det också.
  const venueId =
    listing.venue_confirmed_at && listing.venue_profile_id !== listing.user_id
      ? listing.venue_profile_id
      : null;
  const { data: venue } = venueId
    ? await supabase
        .from("profiles")
        .select("id, full_name, slug, avatar_url, is_public")
        .eq("id", venueId)
        .maybeSingle()
    : { data: null };
  // En lokal som gömt sin profil ska inte länkas fram av ett evenemang.
  const venueLink = venue?.is_public ? venue : null;

  const today = new Date().toISOString().slice(0, 10);
  const cardColumns = "id, title, slug, image_url, event_date, event_location, price, series_slug";

  // Seriens övriga kvällar är inte "upptäck mer" — de är samma kväll en annan
  // vecka. Låg de i samma sektion blev "Fler produktioner" tre kopior av det
  // besökaren redan tittade på. De hör hemma under en egen rubrik, där de gör
  // nytta: kan du inte den 7:e finns den 14:e.
  const seriesSlug = (listing as { series_slug?: string | null }).series_slug ?? null;

  const [{ data: moreDatesRows }, { data: moreRows }] = await Promise.all([
    seriesSlug
      ? supabase
          .from("listings")
          .select(cardColumns)
          .eq("is_active", true)
          .eq("is_public", true)
          .eq("series_slug", seriesSlug)
          .neq("id", listing.id)
          .gte("event_date", today)
          .order("event_date", { ascending: true })
          .limit(3)
      : Promise.resolve({ data: [] as EventCard[] }),
    // Hämta med marginal och sålla bort serien i JS — ett "inte den här serien"
    // i frågan måste också släppa igenom rader där series_slug är NULL, och det
    // blir lättare att läsa fel än att skriva rätt.
    supabase
      .from("listings")
      .select(cardColumns)
      .eq("is_active", true)
      .eq("is_public", true)
      .neq("id", listing.id)
      .or(`event_date.gte.${today},event_date.is.null`)
      .order("event_date", { ascending: true, nullsFirst: false })
      .limit(12),
  ]);

  const more = ((moreRows ?? []) as EventCard[])
    .filter((m) => !seriesSlug || m.series_slug !== seriesSlug)
    .slice(0, 3);

  return { listing, host, venue: venueLink, more, moreDates: (moreDatesRows ?? []) as EventCard[] };
}

async function getCrew(listingId: string) {
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  // RLS on listing_collaborators is host-or-self only, so the public page reads
  // accepted crew server-side via the service role (key never reaches the client).
  const { data: collabs } = await admin
    .from("listing_collaborators")
    .select("user_id, role, accepted_at")
    .eq("listing_id", listingId)
    .eq("status", "accepted")
    .order("accepted_at", { ascending: true });

  if (!collabs || collabs.length === 0) return [];

  const ids = collabs.map((c) => c.user_id);
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name, slug, avatar_url")
    .in("id", ids);

  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  return collabs.map((c) => ({
    user_id: c.user_id,
    role: c.role as string,
    profile: byId.get(c.user_id) ?? null,
  }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  let data = await getListing(slug);
  if (!data) {
    const resolved = await resolveSlugToOccurrence(slug);
    if (resolved) data = await getListing(resolved);
  }
  if (!data) return { title: "Event hittades inte" };

  const { listing, host } = data;
  const eventLocale = listing.content_language ?? (await getLocale());
  const t = await getTranslations({ locale: eventLocale, namespace: "eventPage" });
  const image = listing.image_url ?? FALLBACK_IMAGE;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://usha.se";
  const description =
    listing.description?.slice(0, 200) ??
    (host?.full_name ? t("metaDescriptionBy", { name: host.full_name }) : t("metaDescription"));

  return {
    title: t("metaTitle", { title: listing.title }),
    description,
    openGraph: {
      title: listing.title,
      description,
      url: `${appUrl}/event/${slug}`,
      type: "website",
      images: [{ url: image, width: 1200, height: 630, alt: listing.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: listing.title,
      description,
      images: [image],
    },
  };
}

// UI-locale → BCP 47-tagg för datumformatering (annars blir månadsnamnen
// svenska även på engelska/spanska sidor).
const DATE_LOCALES: Record<string, string> = { sv: "sv-SE", en: "en-GB", es: "es-ES" };
function dateLocaleFor(locale: string) {
  return DATE_LOCALES[locale] ?? "en-GB";
}

function formatDate(dateStr: string | null, timeStr: string | null, locale = "sv") {
  if (!dateStr) return null;
  const time = timeStr ? (timeStr.length === 5 ? `${timeStr}:00` : timeStr.slice(0, 8)) : "12:00:00";
  const date = new Date(`${dateStr}T${time}+02:00`);
  if (isNaN(date.getTime())) return null;
  return date.toLocaleDateString(dateLocaleFor(locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Stockholm",
  });
}

function formatTime(timeStr: string | null, endTimeStr: string | null) {
  if (!timeStr) return null;
  const start = timeStr.slice(0, 5);
  if (endTimeStr) return `${start} – ${endTimeStr.slice(0, 5)}`;
  return start;
}

export default async function EventPage(props: Params) {
  const params = await props.params;
  const { slug } = await params;
  // Den som redan har en biljett och vill lägga till ett pass kommer hit med
  // typen förvald, så att första skärmen visar rätt pris i stället för att be
  // hen leta rätt på raden igen.
  const preselectTicketTypeId = (await props.searchParams)?.tt ?? null;

  // Välkomstavdraget, om köparen har kvar sitt. Visas i biljettrutan så att
  // det syns FÖRE kassan — ett avdrag som dyker upp först i Stripe övertygar
  // ingen att köpa.
  let signupCreditOre = 0;
  {
    const sb = await createClient();
    const { data: { user: buyer } } = await sb.auth.getUser();
    if (buyer) {
      const { data: credit } = await sb
        .from("account_credits")
        .select("amount_ore, used_at, expires_at")
        .eq("user_id", buyer.id)
        .maybeSingle();
      const gone = !!credit?.used_at || (!!credit?.expires_at && new Date(credit.expires_at) < new Date());
      signupCreditOre = credit && !gone ? credit.amount_ore : 0;
    }
  }
  let data = await getListing(slug);
  if (!data) {
    const resolved = await resolveSlugToOccurrence(slug);
    if (resolved) redirect(`/event/${resolved}`);
    notFound();
  }

  const { listing, host, venue, more, moreDates } = data;
  const crew = await getCrew(listing.id);
  const supabase = await createClient();

  // Ticket types (price tiers). Empty → single-price event (unchanged).
  const { data: ticketTypes } = await supabase
    .from("ticket_types")
    .select("id, name, price, capacity, tickets_sold, ticket_type_pools(pool_id, ticket_pools(id, capacity))")
    .eq("listing_id", listing.id)
    .order("sort_order", { ascending: true });

  // Pottmedlemmar ärver pottens tak och pottens sålda antal, annars ser de
  // obegränsade ut för köparen och nekas först i kassan.
  // Hur mycket varje pott tagit: summan av vad ALLA typer i potten sålt.
  const pottSalda = new Map<string, number>();
  for (const tt of ticketTypes ?? []) {
    for (const k of (tt.ticket_type_pools ?? []) as { pool_id: string }[]) {
      pottSalda.set(k.pool_id, (pottSalda.get(k.pool_id) ?? 0) + (tt.tickets_sold ?? 0));
    }
  }

  const ticketTypesForSale = applyPoolLimits(
    (ticketTypes ?? []).map((tt) => ({
      ...tt,
      pools: ((tt.ticket_type_pools ?? []) as unknown as {
        pool_id: string;
        ticket_pools: { capacity: number | null } | { capacity: number | null }[] | null;
      }[]).map((k) => {
        const pott = Array.isArray(k.ticket_pools) ? k.ticket_pools[0] : k.ticket_pools;
        return { id: k.pool_id, capacity: pott?.capacity ?? null, sold: pottSalda.get(k.pool_id) ?? 0 };
      }),
    }))
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Per-event language: if the host pinned a language, the WHOLE page (server
  // text + client components) renders in it for every visitor; else follow the
  // visitor's locale. Client children are wrapped in a matching provider below.
  const eventLocale = listing.content_language ?? (await getLocale());
  const t = await getTranslations({ locale: eventLocale, namespace: "eventPage" });
  // Rot-översättare för delade nycklar (categories.*, common.*).
  const tRoot = await getTranslations({ locale: eventLocale });
  const messages = await getMessages({ locale: eventLocale });
  const locale = eventLocale;
  const image = listing.image_url ?? FALLBACK_IMAGE;
  // Kategorin är ett enum i databasen — översätt via eventPage.cat_* och annars
  // via de delade categories.*-nycklarna innan råvärdet visas.
  const categoryLabel = t.has(`cat_${listing.category}`)
    ? t(`cat_${listing.category}`)
    : tRoot.has(`categories.${listing.category}`)
      ? tRoot(`categories.${listing.category}`)
      : EVENT_CATEGORY_LABELS[listing.category] ?? listing.category;
  const dateLabel = formatDate(listing.event_date, listing.event_time, locale);
  const timeLabel = formatTime(listing.event_time, listing.event_end_time);
  // Timed automation: effective price + whether tickets are buyable right now.
  const sale = getSaleState(listing, new Date());
  const isFree = !sale.price || sale.price <= 0;
  const saleUntil = sale.until
    ? new Intl.DateTimeFormat(dateLocaleFor(locale), {
        day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
        timeZone: "Europe/Stockholm",
      }).format(sale.until)
    : null;
  const saleBadge =
    sale.state === "early_bird" ? t("badgeEarlyBird") :
    sale.state === "past" ? t("badgePast") :
    sale.state === "sold_out" ? t("badgeSoldOut") :
    sale.state === "before" ? t("badgeComingSoon") : null;
  const saleNote =
    sale.state === "past" ? t("eventPast") :
    sale.state === "early_bird" && saleUntil ? t("earlyBirdUntil", { date: saleUntil }) :
    sale.state === "before" && saleUntil ? t("releasesAt", { date: saleUntil }) :
    sale.state === "sold_out" && saleUntil ? t("releasesAt", { date: saleUntil }) : null;
  const isHost = !!user && user.id === listing.user_id;
  const returnPath = `/event/${slug}`;

  const prepareCards = (items: EventCard[]): PreparedCard[] =>
    items.map((m) => ({
      id: m.id,
      href: m.slug ? `/event/${m.slug}` : `/listing/${m.id}`,
      title: m.title,
      image: m.image_url,
      meta: [
        m.event_date
          ? new Date(`${m.event_date}T12:00:00+02:00`).toLocaleDateString(dateLocaleFor(locale), {
              day: "numeric",
              month: "short",
              timeZone: "Europe/Stockholm",
            })
          : t("dateComing"),
        m.event_location,
      ]
        .filter(Boolean)
        .join(" · "),
      price: m.price ? t("priceLabel", { price: m.price }) : t("free"),
    }));
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://usha.se";

  return (
    <NextIntlClientProvider locale={eventLocale} messages={messages}>
    <main className="min-h-screen bg-[var(--usha-black)] text-[var(--usha-white)]">
      <TrackEvent
        name="listing_view"
        params={{
          listing_id: listing.id,
          slug,
          price: listing.price ?? 0,
          is_free: isFree,
          category: listing.category,
        }}
      />
      <div className="relative w-full overflow-hidden sm:aspect-[2/1]">
        {/* Mobil: affischen i sina egna proportioner. En tvingad kvadrat åt upp
            en fjärdedel av bredden på en 4:3-bild — på The Lab försvann hela
            tidsschemat i högerkanten. Desktop behåller den breda bannern. */}
        <picture>
          <source media="(max-width: 639px)" srcSet={listing.image_url_square ?? image} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt={listing.title}
            className="block h-auto w-full sm:absolute sm:inset-0 sm:h-full sm:object-cover sm:object-center"
          />
        </picture>
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/10 to-black" />

        <div className="absolute left-6 top-6 z-10">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 text-xs font-medium backdrop-blur-sm transition hover:bg-black/60"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded bg-gradient-to-br from-[var(--usha-gold)] to-[var(--usha-accent)] text-[10px] font-bold text-black">
              U
            </span>
            {t("production")}
          </Link>
        </div>

        <div className="absolute bottom-0 left-0 right-0 px-6 pb-10 text-white sm:px-10 sm:pb-16">
          <div className="mx-auto max-w-4xl">
            <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--usha-gold)]/15 px-3 py-1 text-xs font-medium text-[var(--usha-gold)]">
              {categoryLabel}
            </span>
            <h1 className="text-3xl font-bold leading-tight sm:text-5xl">
              {listing.title}
            </h1>
            {(dateLabel || listing.event_location) && (
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/80 sm:text-base">
                {dateLabel && (
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar size={16} />
                    {dateLabel}
                  </span>
                )}
                {timeLabel && (
                  <span className="inline-flex items-center gap-1.5">
                    <Clock size={16} />
                    {timeLabel}
                  </span>
                )}
                {listing.event_location &&
                  (venue ? (
                    <Link
                      href={`/creators/${venue.slug || venue.id}`}
                      className="inline-flex items-center gap-1.5 underline-offset-4 transition hover:text-white hover:underline"
                    >
                      <MapPin size={16} />
                      {listing.event_location}
                    </Link>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin size={16} />
                      {listing.event_location}
                    </span>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-10 sm:px-10 sm:py-16">
        {isHost && (
          <div className="mb-8 flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--usha-gold)]/30 bg-[var(--usha-gold)]/5 p-3">
            <span className="mr-1 px-1 text-xs font-medium text-[var(--usha-gold)]">
              {t("yourProduction")}
            </span>
            <Link
              href={`/app/events/${listing.id}/crew`}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--usha-gold)] px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90"
            >
              <Users size={15} />
              {t("manageCrew")}
            </Link>
            <Link
              href={`/app/events/${listing.id}/waitlist`}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--usha-border)] px-4 py-2 text-sm font-medium text-[var(--usha-white)] transition hover:border-[var(--usha-gold)]/60"
            >
              <Clock size={15} />
              {t("waitlistLabel")}
            </Link>
            <Link
              href={`/app/events/${listing.id}/codes`}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--usha-border)] px-4 py-2 text-sm font-medium text-[var(--usha-white)] transition hover:border-[var(--usha-gold)]/60"
            >
              <Ticket size={15} />
              {t("manageCodes")}
            </Link>
            <Link
              href={`/app/events/${listing.id}/edit`}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--usha-border)] px-4 py-2 text-sm font-medium text-[var(--usha-white)] transition hover:border-[var(--usha-gold)]/60"
            >
              <Pencil size={15} />
              {t("edit")}
            </Link>
          </div>
        )}
        <div className="grid gap-8 md:grid-cols-[1fr_280px] md:gap-12">
          <div>
            {listing.description ? (
              <div className="whitespace-pre-wrap text-base leading-relaxed text-[var(--usha-white)] sm:text-lg">
                {listing.description}
              </div>
            ) : (
              <p className="text-base text-[var(--usha-muted)]">
                {t("descriptionSoon")}
              </p>
            )}

            {listing.duration_minutes && (
              <p className="mt-6 text-sm text-[var(--usha-muted)]">
                {t("durationMin", { minutes: listing.duration_minutes })}
              </p>
            )}

            {/* Kartan. Den som läst klart och bestämt sig ska inte behöva
                googla adressen själv — särskilt inte på väg dit. */}
            <EventMap
              lat={listing.event_lat}
              lng={listing.event_lng}
              placeId={listing.event_place_id}
              location={listing.event_location}
              city="Stockholm"
              locale={locale}
              heading={t("mapHeading")}
              linkLabel={t("openInMaps")}
            />
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6">
              {/* Prisrubriken hör ihop med biljettvalet, så under försäljning
                  renderas den av BookButton och följer det man klickat på.
                  Går det inte att köpa finns inget val att följa, och då står
                  den kvar här. */}
              {sale.buyable ? (
                <BookButton
                  listingId={listing.id}
                  price={sale.price}
                  isLoggedIn={!!user}
                  returnPath={returnPath}
                  ticketTypes={ticketTypesForSale}
                  preselectTicketTypeId={preselectTicketTypeId}
                  creditOre={signupCreditOre}
                  header={{
                    badge: saleBadge ?? t("ticket"),
                    listPrice: listing.price ?? null,
                    note: saleNote,
                  }}
                />
              ) : (
                <>
                  <div className="mb-4 text-center">
                    <p className="text-xs uppercase tracking-wide text-[var(--usha-muted)]">
                      {saleBadge ?? t("ticket")}
                    </p>
                    <p className="mt-1 whitespace-nowrap text-3xl font-bold text-[var(--usha-gold)]">
                      {isFree ? (
                        t("free")
                      ) : (
                        <>
                          {sale.price < (listing.price ?? 0) && (
                            <span className="mr-2 align-middle text-xl font-normal text-[var(--usha-muted)] line-through">
                              {t("priceLabel", { price: listing.price ?? 0 })}
                            </span>
                          )}
                          {t("priceLabel", { price: sale.price })}
                        </>
                      )}
                    </p>
                    {saleNote && (
                      <p className="mt-1 text-xs text-[var(--usha-muted)]">{saleNote}</p>
                    )}
                  </div>
                  <div className="w-full rounded-lg border border-[var(--usha-border)] bg-[var(--usha-black)] px-4 py-2.5 text-center text-sm font-semibold text-[var(--usha-muted)]">
                    {sale.state === "past" ? t("badgePast") :
                     sale.state === "sold_out" ? t("soldOut") : t("notReleased")}
                  </div>
                </>
              )}
              {sale.buyable && !user && (
                <p className="mt-3 text-center text-[11px] text-[var(--usha-muted)]">
                  {t("noAccountNote")}
                </p>
              )}
            </div>

            {/* Väntelistan visas bara när biljetter INTE säljs (ännu ej släppt
                eller slutsålt) — under aktiv försäljning köper man direkt. Ett
                passerat event har inget att vänta på. */}
            {!sale.buyable && sale.state !== "past" && <WaitlistForm listingId={listing.id} />}

            {/* Åtkomstkod (team/VIP) ger gratis biljett — meningslös i efterhand. */}
            {sale.state !== "past" && <AccessCodeForm listingId={listing.id} isLoggedIn={!!user} />}

            <div className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4">
              <p className="mb-2 text-[11px] uppercase tracking-wide text-[var(--usha-muted)]">
                {t("share")}
              </p>
              <SocialShareButton
                title={listing.title}
                url={`${appUrl}/event/${slug}`}
                eventDate={listing.event_date}
                eventTime={listing.event_time}
                eventLocation={listing.event_location}
                price={listing.price}
              />
            </div>
          </aside>
        </div>

        {host && (
          <div className="mt-12 flex items-center gap-4 border-t border-[var(--usha-border)] pt-8">
            {!listing.organizer_name && host.avatar_url && (
              <Image
                src={host.avatar_url}
                alt={host.full_name ?? ""}
                width={48}
                height={48}
                className="h-12 w-12 rounded-full object-cover"
              />
            )}
            <div className="flex-1">
              <p className="text-xs uppercase tracking-wide text-[var(--usha-muted)]">
                {t("organizer")}
              </p>
              {listing.organizer_name ? (
                <span className="text-sm font-medium text-[var(--usha-white)]">
                  {listing.organizer_name}
                </span>
              ) : host.slug ? (
                <Link
                  href={`/creators/${host.slug}`}
                  className="text-sm font-medium text-[var(--usha-white)] hover:text-[var(--usha-gold)]"
                >
                  {host.full_name}
                </Link>
              ) : (
                <span className="text-sm font-medium text-[var(--usha-white)]">
                  {host.full_name}
                </span>
              )}
              {host.bankid_verified_at && (
                <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-green-400">
                  · {t("bankidVerified")}
                </span>
              )}
            </div>

            {/* Lokalen får samma plats som arrangören. Kvällen är deras hus lika
                mycket som hans produktion, och den som hittar hit ska kunna
                hitta vidare till vad mer som händer där. */}
            {venue && (
              <div className="border-l border-[var(--usha-border)] pl-4">
                <p className="text-xs uppercase tracking-wide text-[var(--usha-muted)]">
                  {t("venue")}
                </p>
                <Link
                  href={`/creators/${venue.slug || venue.id}`}
                  className="text-sm font-medium text-[var(--usha-white)] hover:text-[var(--usha-gold)]"
                >
                  {venue.full_name}
                </Link>
              </div>
            )}
          </div>
        )}

        {crew.length > 0 && (
          <div className="mt-8 border-t border-[var(--usha-border)] pt-8">
            <p className="mb-4 text-xs uppercase tracking-wide text-[var(--usha-muted)]">
              {t("crewHeading")}
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-4">
              {crew.map((c) => {
                const p = c.profile;
                const name = p?.full_name ?? tRoot("eventCrew.memberFallback");
                const inner = (
                  <>
                    {p?.avatar_url ? (
                      <Image
                        src={p.avatar_url}
                        alt={name}
                        width={40}
                        height={40}
                        className="h-10 w-10 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--usha-card)] text-sm font-semibold text-[var(--usha-white)]">
                        {name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span>
                      <span className="block text-sm font-medium text-[var(--usha-white)]">{name}</span>
                      <span className="block text-[11px] text-[var(--usha-muted)]">
                        {collabRoleLabel(c.role)}
                      </span>
                    </span>
                  </>
                );
                return p?.slug ? (
                  <Link
                    key={c.user_id}
                    href={`/creators/${p.slug}`}
                    className="flex items-center gap-3 transition hover:opacity-80"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div key={c.user_id} className="flex items-center gap-3">
                    {inner}
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>

      {moreDates.length > 0 && (
        <EventCardSection
          eyebrow={t("sameSeries")}
          heading={t("moreDates")}
          viewAllHref={listing.series_slug ? `/series/${listing.series_slug}` : "/marketplace"}
          viewAllLabel={tRoot("common.viewAll")}
          cards={prepareCards(moreDates)}
          fallbackLabel={t("production")}
        />
      )}

      {more.length > 0 && (
        <EventCardSection
          eyebrow={t("discoverMore")}
          heading={t("moreProductions")}
          viewAllHref="/marketplace"
          viewAllLabel={tRoot("common.viewAll")}
          cards={prepareCards(more)}
          fallbackLabel={t("production")}
        />
      )}
    </main>
    </NextIntlClientProvider>
  );
}

/** Ett kort så som det visas: alla texter redan färdiga. */
interface PreparedCard {
  id: string;
  href: string;
  title: string;
  image: string | null;
  meta: string;
  price: string;
}

function EventCardSection({
  eyebrow,
  heading,
  viewAllHref,
  viewAllLabel,
  cards,
  fallbackLabel,
}: {
  eyebrow: string;
  heading: string;
  viewAllHref: string;
  viewAllLabel: string;
  cards: PreparedCard[];
  fallbackLabel: string;
}) {
  return (
    <section className="border-t border-[var(--usha-border)] bg-[var(--usha-card)]/30">
      <div className="mx-auto max-w-5xl px-6 py-12 sm:px-10 sm:py-16">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--usha-muted)]">{eyebrow}</p>
            <h2 className="mt-1 text-2xl font-bold sm:text-3xl">{heading}</h2>
          </div>
          <Link
            href={viewAllHref}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--usha-border)] px-4 py-2 text-xs font-medium text-[var(--usha-white)] transition hover:border-[var(--usha-gold)]/60 hover:text-[var(--usha-gold)]"
          >
            {viewAllLabel} →
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <Link
              key={c.id}
              href={c.href}
              className="group overflow-hidden rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] transition hover:border-[var(--usha-gold)]/40"
            >
              <div className="relative aspect-[1.91/1] bg-black">
                {c.image ? (
                  <Image
                    src={c.image}
                    alt={c.title}
                    fill
                    sizes="(max-width: 640px) 100vw, 33vw"
                    className="object-cover transition group-hover:scale-[1.02]"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-[var(--usha-muted)]">
                    {fallbackLabel}
                  </div>
                )}
              </div>
              <div className="p-4">
                <h3 className="line-clamp-1 text-sm font-semibold">{c.title}</h3>
                <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--usha-muted)]">
                  <span className="line-clamp-1">{c.meta}</span>
                  <span className="font-semibold text-[var(--usha-gold)]">{c.price}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
