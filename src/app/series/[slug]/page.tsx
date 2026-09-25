export const revalidate = 60; // ISR: revalidate every 60 seconds

import { createClient } from "@/lib/supabase/server";
import { safeJsonLd } from "@/lib/json-ld";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { MapPin, Clock, Calendar, ArrowLeft, User, ChevronRight, ChevronDown } from "lucide-react";
import { CATEGORY_LABELS } from "@/lib/categories";
import {
  splitBilingualDescription,
  buildPreviewDescription,
} from "@/lib/listings/description";
import { FollowButton } from "@/components/follow-button";
import { EmailFollowForm } from "@/components/email-follow-form";
import { FollowUs } from "@/components/follow-us";
import { getTranslations, getLocale } from "next-intl/server";
import { canonicalSeriesSlug } from "@/lib/listings/series-aliases";

interface Props {
  params: Promise<{ slug: string }>;
}

type Occurrence = {
  id: string;
  slug: string | null;
  title: string;
  description: string | null;
  category: string;
  price: number | null;
  event_date: string | null;
  event_time: string | null;
  event_end_time: string | null;
  event_location: string | null;
  event_lat: number | null;
  event_lng: number | null;
  image_url: string | null;
  user_id: string;
  content_language: string | null;
  ticket_types?: { price: number | null }[] | null;
};

const SERIES_COLUMNS =
  "id, slug, title, description, category, price, event_date, event_time, event_end_time, event_location, event_lat, event_lng, image_url, user_id, content_language, ticket_types(price)";

async function fetchBySeriesSlug(slug: string): Promise<Occurrence[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("listings")
    .select(SERIES_COLUMNS)
    .eq("series_slug", slug)
    .eq("is_active", true)
    .eq("is_public", true)
    .order("event_date", { ascending: true });
  return (data as Occurrence[] | null) ?? [];
}

/**
 * Gamla serienycklar finns på utskrivna QR-koder och i delade länkar, så de
 * översätts till dagens nyckel. Slår den nya tomt provas den inmatade som den
 * är: aliaset och databasbytet kan inte landa i exakt samma sekund, och i
 * glappet ska ingen mötas av 404. (Det hände 2026-09-17 — alias-deployen gick
 * ut före omdöpningen, och den utskrivna QR-kodens adress dog i tio minuter.)
 */
async function fetchSeries(rawSlug: string): Promise<Occurrence[]> {
  const canonical = canonicalSeriesSlug(rawSlug);
  const rows = await fetchBySeriesSlug(canonical);
  if (rows.length > 0 || canonical === rawSlug) return rows;
  return fetchBySeriesSlug(rawSlug);
}

// Per-series language: if the host pinned a language on the series, the page
// renders in it for every visitor; otherwise we follow the visitor's locale.
// Same rule as the single event page.
async function resolveLocale(series?: Occurrence): Promise<string> {
  return series?.content_language ?? (await getLocale());
}

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://usha.se";
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const occurrences = await fetchSeries(params.slug);
  const locale = await resolveLocale(occurrences[0]);
  const t = await getTranslations({ locale, namespace: "seriesPage" });

  if (occurrences.length === 0) return { title: t("metaTitleFallback") };

  const s = occurrences[0];
  const title = t("metaTitle", { title: s.title });
  // Samma behandling som eventsidan: plats först, dekorativ inledning och
  // andraspråk bort. Utan det inleds förhandsvisningen med brödtextens början
  // och kan svämma över i den engelska halvan.
  const description =
    buildPreviewDescription([s.event_location?.split(",")[0]?.trim()], s.description, 160) ||
    t("metaDescription", { title: s.title });
  const url = `${appUrl()}/series/${canonicalSeriesSlug(params.slug)}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      ...(s.image_url ? { images: [{ url: s.image_url, width: 1200, height: 630, alt: s.title }] } : {}),
    },
    twitter: {
      card: s.image_url ? "summary_large_image" : "summary",
      title,
      description,
      ...(s.image_url ? { images: [s.image_url] } : {}),
    },
  };
}

// Locale-aware date formatting. Kept local on purpose (no shared helper).
const DATE_LOCALES: Record<string, string> = {
  sv: "sv-SE",
  en: "en-GB",
  es: "es-ES",
};

function formatDate(date: string, locale: string) {
  return new Date(date + "T00:00").toLocaleDateString(DATE_LOCALES[locale] ?? "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function OccurrenceRow({
  o,
  past,
  locale,
  priceLabel,
  ctaLabel,
}: {
  o: Occurrence;
  past?: boolean;
  locale: string;
  priceLabel: string | null;
  ctaLabel: string;
}) {
  const href = `/listing/${o.slug || o.id}`;
  return (
    <Link
      href={href}
      className={`flex items-center justify-between gap-3 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4 transition hover:border-[var(--usha-gold)]/30 ${past ? "opacity-70" : ""}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {o.event_date && (
            <span className="flex items-center gap-1.5 font-medium">
              <Calendar size={14} className="text-[var(--usha-gold)]" />
              {formatDate(o.event_date, locale)}
            </span>
          )}
          {o.event_time && (
            <span className="flex items-center gap-1.5 text-[var(--usha-muted)]">
              <Clock size={14} />
              {o.event_time.slice(0, 5)}
              {o.event_end_time && ` – ${o.event_end_time.slice(0, 5)}`}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {priceLabel && (
          <span className="text-sm font-semibold text-[var(--usha-gold)]">{priceLabel}</span>
        )}
        <span className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-3 py-1.5 text-xs font-semibold text-black">
          {ctaLabel}
          <ChevronRight size={14} />
        </span>
      </div>
    </Link>
  );
}

export default async function SeriesPage(props: Props) {
  const params = await props.params;
  const occurrences = await fetchSeries(params.slug);
  if (occurrences.length === 0) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isLoggedIn = !!user;

  const series = occurrences[0];

  const locale = await resolveLocale(series);
  const t = await getTranslations({ locale, namespace: "seriesPage" });
  const isOwnSeries = !!user && user.id === series.user_id;
  const [{ count: followerCount }, { data: myFollow }] = await Promise.all([
    supabase.from("follows").select("id", { count: "exact", head: true }).eq("followed_id", series.user_id),
    user
      ? supabase.from("follows").select("id").eq("follower_id", user.id).eq("followed_id", series.user_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const tFollow = await getTranslations({ locale, namespace: "emailFollow" });
  const tCat = await getTranslations({ locale, namespace: "categories" });
  const categoryLabel = (value: string | null) =>
    !value ? "" : tCat.has(value) ? tCat(value) : CATEGORY_LABELS[value] ?? value;
  // Lägsta biljettpris, och "från" när typerna spänner över flera priser.
  // Annars står "50 SEK" på en kväll där bara practican kostar 50.
  const seriesText = splitBilingualDescription(series.description);
  const priceLabel = (o: Occurrence) => {
    const tiers = (o.ticket_types ?? [])
      .map((tt) => tt.price)
      .filter((p): p is number => typeof p === "number");
    const price = tiers.length ? Math.min(...tiers) : o.price;
    if (price == null) return null;
    if (price <= 0) return t("free");
    return t(new Set(tiers).size > 1 ? "priceFromSek" : "priceSek", { price });
  };

  // Creator profile
  const { data: creator } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, category, slug")
    .eq("id", series.user_id)
    .single();

  const creatorUrl = creator?.slug ? `/${creator.slug}` : `/creators/${series.user_id}`;

  // Split upcoming vs past (today inclusive = upcoming). Past kept as a library.
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = occurrences.filter((o) => !o.event_date || o.event_date >= today);
  const past = occurrences.filter((o) => o.event_date && o.event_date < today).reverse();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "EventSeries",
    name: series.title,
    url: `${appUrl()}/series/${canonicalSeriesSlug(params.slug)}`,
    ...(series.description
      ? { description: splitBilingualDescription(series.description).primary.slice(0, 300) }
      : {}),
    ...(series.image_url ? { image: series.image_url } : {}),
    ...(creator
      ? {
          organizer: {
            "@type": "Person",
            name: creator.full_name || t("creator"),
            url: `${appUrl()}${creatorUrl}`,
          },
        }
      : {}),
    subEvent: occurrences
      .filter((o) => o.event_date)
      .map((o) => ({
        "@type": "Event",
        name: series.title,
        startDate: o.event_time ? `${o.event_date}T${o.event_time}` : o.event_date,
        url: `${appUrl()}/listing/${o.slug || o.id}`,
        ...(o.event_location ? { location: { "@type": "Place", name: o.event_location } } : {}),
      })),
  };

  return (
    <div className="min-h-screen">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />

      {/* Header */}
      <header className="border-b border-[var(--usha-border)]">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 md:px-6">
          <Link href={isLoggedIn ? "/app" : "/"} className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--usha-gold)] to-[var(--usha-accent)]">
              <span className="text-sm font-bold text-black">U</span>
            </div>
            <span className="text-lg font-bold tracking-tight">Usha Platform</span>
          </Link>
          <Link
            href={isLoggedIn ? "/app" : "/signup"}
            className="rounded-lg bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90"
          >
            {isLoggedIn ? t("theApp") : t("getStarted")}
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8">
        <Link
          href={creatorUrl}
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-[var(--usha-muted)] transition-colors hover:text-[var(--usha-white)]"
        >
          <ArrowLeft size={14} />
          {t("backTo", { name: creator?.full_name || t("theCreator") })}
        </Link>

        {/* Series header */}
        {series.image_url && (
          <div className="mb-6 overflow-hidden rounded-2xl">
            <img
              src={series.image_url}
              alt={series.title}
              className="w-full max-h-[260px] object-cover sm:max-h-[340px] md:max-h-[420px]"
            />
          </div>
        )}

        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[var(--usha-border)] px-3 py-0.5 text-xs text-[var(--usha-muted)]">
            {categoryLabel(series.category)}
          </span>
          <span className="rounded-full bg-[var(--usha-gold)]/10 px-3 py-0.5 text-xs font-semibold text-[var(--usha-gold)]">
            {t("recurringSeries")}
          </span>
        </div>
        <h1 className="text-2xl font-bold sm:text-3xl">{series.title}</h1>

        {series.event_location && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-[var(--usha-muted)]">
            <MapPin size={14} className="text-[var(--usha-gold)]" />
            {series.event_location}
          </p>
        )}

        {series.description && (
          <div className="mt-4 text-sm leading-relaxed text-[var(--usha-muted)]">
            <p className="whitespace-pre-line">{seriesText.primary}</p>
            {/* Samma utfällning som på eventsidan — en serie visar samma
                beskrivning som sina kvällar, och skulle annars upprepa hela
                texten på båda språken här också. */}
            {seriesText.secondary && (
              <details className="group mt-4 rounded-xl border border-[var(--usha-border)]">
                <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-[var(--usha-muted)] transition hover:text-[var(--usha-white)] [&::-webkit-details-marker]:hidden">
                  {seriesText.secondaryLabel}
                  <ChevronDown size={16} className="shrink-0 transition group-open:rotate-180" />
                </summary>
                <p className="whitespace-pre-line border-t border-[var(--usha-border)] px-4 py-4">
                  {seriesText.secondary}
                </p>
              </details>
            )}
          </div>
        )}

        {/* Upcoming */}
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">
            {t("upcomingHeading")} {upcoming.length > 0 && <span className="text-[var(--usha-muted)]">({upcoming.length})</span>}
          </h2>
          {upcoming.length > 0 ? (
            <div className="space-y-2.5">
              {upcoming.map((o) => (
                <OccurrenceRow
                  key={o.id}
                  o={o}
                  locale={locale}
                  priceLabel={priceLabel(o)}
                  ctaLabel={t("book")}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4 text-sm text-[var(--usha-muted)]">
              {t("noUpcoming")}
            </p>
          )}
        </div>

        {/* Past — library of previous occurrences */}
        {past.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-3 text-lg font-semibold">
              {t("pastHeading")} <span className="text-[var(--usha-muted)]">({past.length})</span>
            </h2>
            <div className="space-y-2.5">
              {past.map((o) => (
                <OccurrenceRow
                  key={o.id}
                  o={o}
                  past
                  locale={locale}
                  priceLabel={priceLabel(o)}
                  ctaLabel={t("view")}
                />
              ))}
            </div>
          </div>
        )}

        {/* Creator card */}
        {creator && (
          <Link
            href={creatorUrl}
            className="mt-8 flex items-center gap-3 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4 transition hover:border-[var(--usha-gold)]/30"
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
              <p className="font-semibold">{creator.full_name || t("creator")}</p>
              <p className="text-xs text-[var(--usha-muted)]">
                {categoryLabel(creator.category)} · {t("viewProfile")}
              </p>
            </div>
          </Link>
        )}

        {/* Följ härifrån: serien är det man faktiskt vill ha nästa kväll av. */}
        {creator && !isOwnSeries && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <FollowButton
              creatorId={series.user_id}
              initialFollowing={!!myFollow}
              followerCount={followerCount ?? 0}
              isLoggedIn={isLoggedIn}
              returnTo={`/series/${canonicalSeriesSlug(params.slug)}`}
            />
          </div>
        )}
        {creator && !user && (
          <EmailFollowForm
            followedId={series.user_id}
            locale={locale}
            className="mt-4"
            labels={{
              prompt: tFollow("prompt", { name: creator.full_name || t("creator") }),
              placeholder: tFollow("placeholder"),
              button: tFollow("button"),
              pending: tFollow("pending"),
              active: tFollow("active", { name: creator.full_name || t("creator") }),
              failed: tFollow("failed"),
            }}
          />
        )}
        <FollowUs className="mt-8" />
      </div>
    </div>
  );
}
