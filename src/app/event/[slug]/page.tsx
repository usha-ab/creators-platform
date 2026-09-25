import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { collabRoleLabel } from "@/lib/collaborators";
import { applyPoolLimits } from "@/lib/tickets/pools";
import { passSavings } from "@/lib/passes/series-pass";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Calendar, ChevronDown, Clock, MapPin, Ticket, Users, Pencil } from "lucide-react";
import { EVENT_CATEGORY_LABELS } from "@/app/app/events/constants";
import { BookButton } from "./book-button";
import { WaitlistForm } from "./waitlist-form";
import { AccessCodeForm } from "./access-code-form";
import { getSaleState } from "@/lib/listings/sale-state";
import { splitBilingualDescription, buildPreviewDescription } from "@/lib/listings/description";
import { buildMapsHref } from "@/lib/listings/maps";
import { canReceivePayments } from "@/lib/payments/beta-gate";
import { safeJsonLd } from "@/lib/json-ld";
import { getTranslations, getLocale, getMessages } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { SocialShareButton } from "@/components/social-share-button";
import { TrackEvent } from "@/components/track-event";
import { EventMap } from "@/components/event-map";
import { FollowButton } from "@/components/follow-button";
import { EmailFollowForm } from "@/components/email-follow-form";
import { FollowUs } from "@/components/follow-us";
import { getCreditLedgerBalance } from "@/lib/credits/balance";
import { indexable } from "@/lib/seo/metadata";

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
      "id, user_id, title, description, category, price, duration_minutes, image_url, image_url_square, series_id, event_date, event_time, event_end_time, event_location, event_place_id, event_lat, event_lng, event_city, event_venue, slug, series_slug, is_active, content_language, organizer_name, early_bird_start, early_bird_end, early_bird_price, public_sale_at, capacity, tickets_sold, venue_profile_id, venue_confirmed_at"
    )
    .eq(isUUID(slug) ? "id" : "slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (!listing) return null;

  const { data: host } = await supabase
    .from("profiles")
    .select("id, full_name, slug, avatar_url, bankid_verified_at, company_verified_at")
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
  // Förhandsvisningen i WhatsApp, Facebook och iMessage klipps efter ett par
  // rader. Faktaraden först: när och var kvällen hålls är mer värt där än
  // brödtextens inledning — som dessutom kan vara en stiliserad rubrik, eller
  // den andra halvan av en tvåspråkig text.
  const previewDate = listing.event_date
    ? new Intl.DateTimeFormat(eventLocale === "sv" ? "sv-SE" : eventLocale === "es" ? "es-ES" : "en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "Europe/Stockholm",
      }).format(new Date(`${listing.event_date}T12:00:00`))
    : null;
  const previewTime = listing.event_time
    ? `${listing.event_time.slice(0, 5)}${listing.event_end_time ? `–${listing.event_end_time.slice(0, 5)}` : ""}`
    : null;
  const description =
    buildPreviewDescription(
      [previewDate, previewTime, listing.event_location?.split(",")[0]?.trim()],
      listing.description
    ) ||
    (host?.full_name ? t("metaDescriptionBy", { name: host.full_name }) : t("metaDescription"));

  return {
    title: t("metaTitle", { title: listing.title }),
    description,
    // Kvällen bor på sin egen adress även när besökaren kom in via seriens
    // slug (som omdirigerar hit) eller via /listing/<id>. Utan canonical får
    // sökmotorn välja mellan tre adresser till samma innehåll.
    ...indexable(`/event/${listing.slug ?? listing.id}`),
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
      signupCreditOre = (credit && !gone ? credit.amount_ore : 0) + (await getCreditLedgerBalance(sb, buyer.id));
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

  // Klippkort på serien ("5 kvällar") säljs som ett alternativ bredvid
  // kvällens biljetter. Kortet är en egen annons (package) kopplad till en
  // eller flera serier, så pris och antal ändras i kreatörens tjänstelista.
  // Ett kort som gäller flera serier ligger i pass_series_ids; pass_series_id
  // tas med i sökningen för kort som skrevs innan arrayen fanns.
  // Värdet vävs in i ett PostgREST-filter nedan, så det får bara vara ett uuid.
  const seriesIdRaw = (listing as { series_id?: string | null }).series_id ?? null;
  const seriesIdForPass =
    seriesIdRaw && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seriesIdRaw)
      ? seriesIdRaw
      : null;
  type PassRow = { id: string; title: string; price: number | null; session_count: number | null; pass_covers: string | null; pass_reference_price: number | null };
  const { data: passRows } = seriesIdForPass
    ? await supabase
        .from("listings")
        .select("id, title, price, session_count, pass_covers, pass_reference_price")
        .or(`pass_series_id.eq.${seriesIdForPass},pass_series_ids.cs.{${seriesIdForPass}}`)
        .eq("is_active", true)
        .eq("is_public", true)
        .order("price", { ascending: true })
    : { data: [] as PassRow[] };
  const passes = ((passRows ?? []) as PassRow[])
    .filter((p) => (p.session_count ?? 0) > 0)
    .map((p) => ({ id: p.id, title: p.title, price: p.price ?? 0, sessionCount: p.session_count ?? 0, covers: p.pass_covers, referencePrice: p.pass_reference_price }));

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

  // Rabatten på ett klippkort ska stå i klartext i köpvalet. Jämförpriset är i
  // första hand arrangörens eget (pass_reference_price), annars kvällens
  // biljett som heter det kortet täcker, annars entrépriset. Finns inget att
  // jämföra med står det ingenting — hellre tyst än ett påhittat jämförpris.
  const passesForSale = passes.map((p) => {
    const reference =
      p.referencePrice ??
      (ticketTypes ?? []).find((tt) => tt.name === p.covers)?.price ??
      listing.price ??
      0;
    return { ...p, savings: passSavings({ price: p.price, sessionCount: p.sessionCount }, reference) };
  });

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
  const tFollow = await getTranslations({ locale, namespace: "emailFollow" });
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

  // Priset för knappen högst upp. Biljettyperna kan spänna över flera priser
  // (50/100/130/200 på The Lab) — då är lägsta priset rätt att visa, med
  // "från", eftersom inget val är gjort ännu.
  // Betalspärren under beta: bara plattformsägaren och verifierade bolag får ta
  // emot riktiga betalningar. Alla checkout-rutter kontrollerar det redan, men
  // den här sidan gjorde det inte — så en besökare kunde trycka Köp och mötas
  // av ett fel först efteråt. Bättre att aldrig visa knappen.
  const payeeCanReceive = canReceivePayments({
    id: listing.user_id,
    company_verified_at:
      (host as { company_verified_at?: string | null } | null)?.company_verified_at ?? null,
  });
  const beskrivning = splitBilingualDescription(listing.description);
  // Gratis biljetter rör inga pengar och berörs inte av spärren.
  const sellable = payeeCanReceive || isFree;
  const salePrices = ticketTypesForSale.map((tt) => tt.price);
  const lowestPrice = salePrices.length ? Math.min(...salePrices) : sale.price;
  const hasPriceRange = new Set(salePrices).size > 1;
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

  // Följ arrangören (och lokalen) härifrån, där publiken faktiskt är. Profilen
  // hade knappen; eventsidan hade den inte, och det är hit man kommer från
  // Facebook, QR-koden i dörren och biljetten.
  const followTargets = [listing.user_id, ...(venue ? [venue.id] : [])];
  const [{ count: hostFollowerCount }, { data: myFollows }] = await Promise.all([
    supabase.from("follows").select("id", { count: "exact", head: true }).eq("followed_id", listing.user_id),
    user
      ? supabase.from("follows").select("followed_id").eq("follower_id", user.id).in("followed_id", followTargets)
      : Promise.resolve({ data: [] as { followed_id: string }[] }),
  ]);
  const followingIds = new Set((myFollows ?? []).map((f) => f.followed_id));
  const hostDisplayName = listing.organizer_name || host?.full_name || t("organizer");

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

  // Strukturerad data. Sidan hade ingen alls, medan /listing — som daterade
  // evenemang omdirigeras BORT från sedan #326 — hade full Event-markup. Varje
  // event flyttades alltså till en sida som varken Google eller en aggregator
  // kan läsa maskinellt.
  //
  // Tidszonen skrivs ut (+02:00/+01:00) i stället för att utelämnas: utan
  // offset tolkas tiden som besökarens lokala, och en kväll 17:00 i Stockholm
  // blir fel för alla andra.
  const tzOffset = (() => {
    const d = new Date(`${listing.event_date}T12:00:00Z`);
    const namn = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Stockholm",
      timeZoneName: "longOffset",
    }).formatToParts(d).find((x) => x.type === "timeZoneName")?.value;
    return namn?.replace("GMT", "") || "+01:00";
  })();
  const isoStart = listing.event_time
    ? `${listing.event_date}T${listing.event_time.slice(0, 8)}${tzOffset}`
    : listing.event_date;
  const isoEnd = listing.event_end_time
    ? `${listing.event_date}T${listing.event_end_time.slice(0, 8)}${tzOffset}`
    : undefined;

  // En Offer per biljettyp. Det är hela poängen för en aggregator: "från 50 kr"
  // går att härleda, och practica/workshop/social syns var för sig.
  const offers = ticketTypesForSale.length
    ? ticketTypesForSale.map((tt) => ({
        "@type": "Offer",
        name: tt.name,
        price: tt.price,
        priceCurrency: "SEK",
        url: `${appUrl}/event/${slug}`,
        availability: sale.buyable && sellable
          ? "https://schema.org/InStock"
          : "https://schema.org/SoldOut",
      }))
    : listing.price != null
      ? [{
          "@type": "Offer",
          price: listing.price,
          priceCurrency: "SEK",
          url: `${appUrl}/event/${slug}`,
          availability: sale.buyable && sellable
            ? "https://schema.org/InStock"
            : "https://schema.org/SoldOut",
        }]
      : [];

  const eventJsonLd = {
    "@context": "https://schema.org",
    "@type": "DanceEvent",
    name: listing.title,
    url: `${appUrl}/event/${slug}`,
    // Radbrytningar fyller ingen funktion i en maskinläst beskrivning, och att
    // inte ha dem tar bort en hel klass av escapningsproblem.
    ...(beskrivning.primary
      ? { description: beskrivning.primary.replace(/\s+/g, " ").trim().slice(0, 500) }
      : {}),
    ...(listing.image_url ? { image: [listing.image_url] } : {}),
    startDate: isoStart,
    ...(isoEnd ? { endDate: isoEnd } : {}),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    ...(listing.event_location
      ? {
          location: {
            "@type": "Place",
            name: listing.event_venue || listing.event_location.split(",")[0]?.trim(),
            address: {
              "@type": "PostalAddress",
              streetAddress: listing.event_location,
              ...(listing.event_city ? { addressLocality: listing.event_city } : {}),
              addressCountry: "SE",
            },
            ...(typeof listing.event_lat === "number" && typeof listing.event_lng === "number"
              ? {
                  geo: {
                    "@type": "GeoCoordinates",
                    latitude: listing.event_lat,
                    longitude: listing.event_lng,
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(offers.length ? { offers } : {}),
    organizer: {
      "@type": "Organization",
      name: listing.organizer_name || host?.full_name || "Usha Platform",
      url: host ? `${appUrl}/creators/${host.slug || host.id}` : appUrl,
    },
    ...(listing.series_slug
      ? { superEvent: { "@type": "EventSeries", url: `${appUrl}/series/${listing.series_slug}` } }
      : {}),
  };

  return (
    <>
    {/* Utanför NextIntlClientProvider med flit. safeJsonLd escapar <, > och &
        till \u003c/\u003e/\u0026, men korsar strängen RSC-gränsen in i en
        klientkomponent avkodas den ett varv på vägen: & blev & igen och \n
        blev en riktig radbrytning inuti en JSON-sträng. Resultatet var ogiltig
        JSON som varken Google eller en aggregator kunde läsa. /series och
        /listing har alltid fungerat just för att de saknar klientgräns runt
        sitt skript. */}
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLd(eventJsonLd) }}
    />
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
        {/* Ingen gradient och ingen text över bilden längre. Affischen och
            rubriken slogs ihop till ett rörigt lapptäcke — särskilt i
            Facebooks inbyggda webbläsare, där Usha-brickan lade sig mitt i
            titeln. Bilden får tala själv; uppgifterna står under den. */}
        {/* Lodrätt längs vänsterkanten, nedifrån och upp.
            writing-mode gör texten vertikal utan att rotera hela lådan, så
            träffytan och rundningen följer med; rotate-180 vänder läsriktningen
            till nedifrån och upp, vilket är den som fungerar när etiketten
            sitter i vänsterkanten. U-märket vänds tillbaka så bokstaven står
            rätt. Den ligger ovanpå bilden och inte under den, eftersom den är
            sidans enda väg tillbaka. */}
        <div className="absolute bottom-3 left-3 z-10">
          <Link
            href="/"
            /* Mer genomskinlig platta, tydligare kant: bilden ska synas igenom,
               och det är kanten snarare än fyllningen som håller brickan läsbar
               mot både ljus och mörk bakgrund. Suddet bakom gör texten läsbar
               även där bilden är brokig. */
            className="flex rotate-180 items-center gap-2 rounded-full border border-white/45 bg-black/20 px-1.5 py-3 text-xs font-medium backdrop-blur-md transition [writing-mode:vertical-rl] hover:border-white/70 hover:bg-black/40"
          >
            <span className="flex h-5 w-5 shrink-0 rotate-180 items-center justify-center rounded bg-gradient-to-br from-[var(--usha-gold)] to-[var(--usha-accent)] text-[10px] font-bold text-black [writing-mode:horizontal-tb]">
              U
            </span>
            {t("production")}
          </Link>
        </div>

      </div>

      {/* Rubriken och uppgifterna, nu på sidans egen yta i stället för ovanpå
          affischen. Samma innehåll som förut — bara läsbart. */}
      <header className="mx-auto max-w-4xl px-6 pt-8 sm:px-10 sm:pt-12">
        <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--usha-gold)]/15 px-3 py-1 text-xs font-medium text-[var(--usha-gold)]">
          {categoryLabel}
        </span>
        <h1 className="text-3xl font-bold leading-tight text-[var(--usha-white)] sm:text-5xl">
          {listing.title}
        </h1>
        {(dateLabel || listing.event_location) && (
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[var(--usha-muted)] sm:text-base">
            {/* Datumet är en länk till en kalenderpost. Den som bestämt sig
                ska inte behöva skriva in kvällen för hand — och just den raden
                är där blicken redan är när beslutet tas. */}
            {dateLabel && (
              <a
                href={`/event/${slug}/kalender.ics`}
                title={t("addToCalendar")}
                aria-label={`${t("addToCalendar")}: ${dateLabel}`}
                className="inline-flex items-center gap-1.5 underline decoration-[var(--usha-muted)]/40 underline-offset-4 transition hover:text-[var(--usha-white)] hover:decoration-[var(--usha-gold)]"
              >
                <Calendar size={16} />
                {dateLabel}
              </a>
            )}
            {timeLabel && (
              <span className="inline-flex items-center gap-1.5">
                <Clock size={16} />
                {timeLabel}
              </span>
            )}
            {/* Biljettlänken hör till uppgifterna om kvällen: när, var, vad det
                kostar. På mobil ligger biljettrutan efter beskrivningen och
                kartan, så utan den här knappen ser en besökare varken pris
                eller köpväg förrän hen scrollat förbi allt. Från md och upp
                står sidokolumnen redan bredvid rubriken — då skulle knappen
                scrolla till något som redan syns. */}
            {sale.buyable && sellable && (
              <a
                href="#biljetter"
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-5 py-2.5 text-base font-bold text-black shadow-lg shadow-[var(--usha-gold)]/20 transition hover:opacity-90 active:scale-[0.98] md:hidden"
              >
                <Ticket size={17} />
                {isFree
                  ? t("freeTicket")
                  : hasPriceRange
                    ? t("ticketsFromCta", { price: lowestPrice })
                    : t("buyTicket", { price: lowestPrice })}
              </a>
            )}
            {/* Adressen går till kartan, även när lokalen har en profil hos
                oss. Den som läser adressraden vill veta var det ligger;
                lokalens profil når man från lokalkortet i sidokolumnen, som
                finns just för det. Förut tog adressen dit i stället, och till
                kartan kom man bara genom att scrolla förbi hela texten. */}
            {listing.event_location && (
              <a
                href={buildMapsHref({
                  location: listing.event_location,
                  city: "Stockholm",
                  placeId: listing.event_place_id,
                  lat: listing.event_lat,
                  lng: listing.event_lng,
                })}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 underline decoration-[var(--usha-muted)]/40 underline-offset-4 transition hover:text-[var(--usha-white)] hover:decoration-[var(--usha-gold)]"
              >
                <MapPin size={16} />
                {listing.event_location}
              </a>
            )}
          </div>
        )}
      </header>

      <div className="mx-auto max-w-4xl px-6 pb-10 pt-8 sm:px-10 sm:pb-16 sm:pt-10">
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
        {/* min-w-0 på båda grid-barnen: ett grid-spår tar annars minst sitt
            innehålls min-content-bredd, och ett enda obrytbart stycke drar ut
            spåret förbi skärmkanten — då hamnar kartan och biljettrutan
            utanför till höger på mobil, medan texten ovanför ser ok ut. */}
        <div className="grid gap-8 md:grid-cols-[1fr_280px] md:gap-12">
          <div className="min-w-0">
            {listing.description ? (
              <div className="text-base leading-relaxed text-[var(--usha-white)] sm:text-lg">
                <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {beskrivning.primary}
                </div>
                {/* Andra språket bakom en utfällning i stället för under
                    förstasidestexten. Hela texten två gånger gör sidan dubbelt
                    så lång, och den som söker sitt språk måste scrolla förbi
                    ett stycke hen inte kan läsa. <details> klarar sig utan JS
                    och är öppningsbar innan sidan hydrerat. */}
                {beskrivning.secondary && (
                  <details className="group mt-6 rounded-xl border border-[var(--usha-border)]">
                    <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-[var(--usha-muted)] transition hover:text-[var(--usha-white)] [&::-webkit-details-marker]:hidden">
                      {beskrivning.secondaryLabel}
                      <ChevronDown size={16} className="shrink-0 transition group-open:rotate-180" />
                    </summary>
                    <div className="whitespace-pre-wrap [overflow-wrap:anywhere] border-t border-[var(--usha-border)] px-4 py-4 text-base leading-relaxed sm:text-lg">
                      {beskrivning.secondary}
                    </div>
                  </details>
                )}
              </div>
            ) : (
              <p className="text-base text-[var(--usha-muted)]">
                {t("descriptionSoon")}
              </p>
            )}

            {/* duration_minutes är ett fält från tjänsteformuläret och kan
                motsäga klockslagen: The Lab har 240 lagrat men pågår 17–23,
                alltså 360. Står både "17:00 – 23:00" och "240 min" på samma
                sida vet ingen vilket som gäller. Finns en sluttid är den
                sanningen, och längden är redan uttryckt. */}
            {listing.duration_minutes && !listing.event_end_time && (
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

          <aside className="min-w-0 space-y-4">
            <div id="biljetter" className="scroll-mt-6 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6">
              {/* Prisrubriken hör ihop med biljettvalet, så under försäljning
                  renderas den av BookButton och följer det man klickat på.
                  Går det inte att köpa finns inget val att följa, och då står
                  den kvar här. */}
              {sale.buyable && sellable ? (
                <BookButton
                  listingId={listing.id}
                  price={sale.price}
                  isLoggedIn={!!user}
                  returnPath={returnPath}
                  ticketTypes={ticketTypesForSale}
                  passes={passesForSale}
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
                     sale.state === "sold_out" ? t("soldOut") :
                     sale.buyable ? t("payAtVenueBadge") : t("notReleased")}
                  </div>
                  {/* Säljfönstret är öppet, men arrangören får inte ta emot
                      onlinebetalning under beta. Säg vad som gäller i stället
                      för att låta rutan se ut som ett tekniskt fel — kvällen
                      blir ju av, betalningen sker bara i dörren. */}
                  {sale.buyable && (
                    <p className="mt-3 text-center text-xs leading-relaxed text-[var(--usha-muted)]">
                      {t("payAtVenueNote")}
                    </p>
                  )}
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
              {!isHost && (
                <div className="mt-2">
                  <FollowButton
                    creatorId={listing.user_id}
                    initialFollowing={followingIds.has(listing.user_id)}
                    followerCount={hostFollowerCount ?? 0}
                    isLoggedIn={!!user}
                    returnTo={returnPath}
                    size="sm"
                  />
                </div>
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
                {user?.id !== venue.id && (
                  <div className="mt-2">
                    <FollowButton
                      creatorId={venue.id}
                      initialFollowing={followingIds.has(venue.id)}
                      followerCount={0}
                      isLoggedIn={!!user}
                      returnTo={returnPath}
                      size="sm"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Utan konto: följ via e-post. Bekräftas med länk i mejlet innan
            något annat skickas. */}
        {host && !user && (
          <EmailFollowForm
            followedId={listing.user_id}
            locale={locale}
            className="mt-6"
            labels={{
              prompt: tFollow("prompt", { name: hostDisplayName }),
              placeholder: tFollow("placeholder"),
              button: tFollow("button"),
              pending: tFollow("pending"),
              active: tFollow("active", { name: hostDisplayName }),
              failed: tFollow("failed"),
            }}
          />
        )}

        <FollowUs className="mt-8" />

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
    </>
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
