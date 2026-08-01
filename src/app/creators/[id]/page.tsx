export const revalidate = 60; // ISR: revalidate every 60 seconds

import { createClient } from "@/lib/supabase/server";
import { safeJsonLd } from "@/lib/json-ld";
import { CATEGORY_LABELS } from "@/lib/categories";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ExperienceDetails } from "@/types/database";
import Link from "next/link";
import Image from "next/image";
import { MapPin, Clock, Globe, ArrowLeft, Calendar, MessageCircle, Users, Instagram, Mail, Phone, ShieldCheck } from "lucide-react";
import BookingForm from "./booking-form";
import { BuyTicketButton } from "@/components/buy-ticket-button";
import { CreatorReviews } from "@/components/creator-reviews";
import { ReportUserButton } from "@/components/report-user-button";
import { AvailabilityCalendar } from "@/components/availability-calendar";
import { CreatorGallery } from "@/components/creator-gallery";
import { CreatorProducts } from "@/components/creator-products";
import { calculateDiscountedPrice } from "@/lib/stripe/commission";
import { canReceivePayments } from "@/lib/payments/beta-gate";
import { filterByGoldExclusivity } from "@/lib/listings/early-bird";
import { FollowButton } from "@/components/follow-button";
import { TipButton } from "@/components/tip-button";

interface Props {
  params: Promise<{ id: string }>;
}

function isUUID(str: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const supabase = await createClient();
  const t = await getTranslations("creatorProfile");
  const column = isUUID(params.id) ? "id" : "slug";
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, bio, category, categories, avatar_url, slug, id")
    .eq(column, params.id)
    .eq("is_public", true)
    .single();

  // Not found / non-public / archived → not indexable (the page itself 404s).
  if (!profile) return { title: t("metaTitleFallback"), robots: { index: false } };

  const cats = profile.categories?.length ? profile.categories : (profile.category ? [profile.category] : []);
  const categoryLabel = cats.map((c: string) => CATEGORY_LABELS[c] || c).join(", ") || null;
  const description = profile.bio?.slice(0, 160) || t("metaDescriptionFallback", { category: categoryLabel || t("creatorFallbackName") });
  const url = `https://usha.se/creators/${profile.slug || profile.id}`;

  // Empty profile (no bio and no active listings) → noindex.
  const { count: activeListings } = await supabase
    .from("listings")
    .select("id", { count: "exact", head: true })
    .eq("user_id", profile.id)
    .eq("is_active", true).eq("is_public", true);
  const isThin = !profile.bio && !activeListings;

  return {
    title: t("metaTitle", { name: profile.full_name || t("creatorFallbackName") }),
    description,
    ...(isThin ? { robots: { index: false } } : {}),
    openGraph: {
      title: t("metaTitleOg", { name: profile.full_name || t("creatorFallbackName") }),
      description,
      url,
      type: "profile",
      ...(profile.avatar_url ? { images: [{ url: profile.avatar_url, width: 400, height: 400, alt: profile.full_name || "Creator" }] } : {}),
    },
  };
}

export default async function CreatorProfilePage(props: Props) {
  const params = await props.params;
  const supabase = await createClient();
  const t = await getTranslations("creatorProfile");

  const column = isUUID(params.id) ? "id" : "slug";
  const [{ data: profile }, { data: { user } }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, full_name, avatar_url, bio, category, location, hourly_rate, website, stripe_account_id, company_verified_at, categories, locations, rates, websites, social_instagram, social_x, social_facebook, contact_email, contact_phone, whitelabel_enabled, whitelabel_brand_name, whitelabel_logo_url, whitelabel_primary_color, whitelabel_accent_color, whitelabel_accent_color_2, whitelabel_accent_color_3, bankid_verified_at, bankid_name"
      )
      .eq(column, params.id)
      .eq("is_public", true)
      .single(),
    supabase.auth.getUser(),
  ]);

  if (!profile) notFound();

  const { data: allListings } = await supabase
    .from("listings")
    .select("id, title, description, category, price, duration_minutes, event_date, event_time, event_location, release_to_gold_at, listing_type, min_guests, max_guests, experience_details")
    .eq("user_id", profile.id)
    .eq("is_active", true)
    .eq("is_public", true)
    .order("created_at", { ascending: false });

  // Get visitor's tier for discount calculation + early bird filtering, and role for B2B booking gating
  let visitorTier: string | null = null;
  let visitorRole: string | null = null;
  if (user) {
    const { data: visitorProfile } = await supabase
      .from("profiles")
      .select("tier, role")
      .eq("id", user.id)
      .single();
    visitorTier = visitorProfile?.tier ?? null;
    visitorRole = (visitorProfile as { role?: string | null } | null)?.role ?? null;
  }

  // Filter out Gold-exclusive listings for gratis users
  const listings = filterByGoldExclusivity(allListings || [], visitorTier);

  // Fetch creator availability for current month
  const now = new Date();
  const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const lastDayNum = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const endOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(lastDayNum).padStart(2, "0")}`;
  const [{ data: availabilityData }, { data: mediaData }, { data: digitalProducts }] = await Promise.all([
    supabase
      .from("creator_availability")
      .select("available_date")
      .eq("user_id", profile.id)
      .gte("available_date", startOfMonth)
      .lte("available_date", endOfMonth),
    supabase
      .from("creator_media")
      .select("id, media_type, url, thumbnail_url, caption, is_hero, section")
      .eq("user_id", profile.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("digital_products")
      .select("id, title, description, price, product_type, thumbnail_url")
      .eq("creator_id", profile.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
  ]);
  const availableDates = (availabilityData || []).map((r) => r.available_date);

  const creatorCategories: string[] = (profile as any).categories?.length ? (profile as any).categories : (profile.category ? [profile.category] : []);
  const creatorLocations: string[] = (profile as any).locations?.length ? (profile as any).locations : (profile.location ? [profile.location] : []);
  const creatorRates: Record<string, number> = (profile as any).rates && typeof (profile as any).rates === "object" ? (profile as any).rates : (profile.category && profile.hourly_rate ? { [profile.category]: profile.hourly_rate } : {});
  const creatorWebsites: string[] = (profile as any).websites?.length ? (profile as any).websites : (profile.website ? [profile.website] : []);

  // Fetch follow data
  const [{ count: followerCount }, { data: isFollowingData }] = await Promise.all([
    supabase
      .from("follows")
      .select("id", { count: "exact", head: true })
      .eq("followed_id", profile.id),
    user
      ? supabase
          .from("follows")
          .select("id")
          .eq("follower_id", user.id)
          .eq("followed_id", profile.id)
          .single()
      : Promise.resolve({ data: null }),
  ]);

  const isLoggedIn = !!user;
  const isOwnProfile = user?.id === profile.id;
  const isFollowing = !!isFollowingData;
  const hasConnect = !!profile.stripe_account_id;
  const payeeCanReceive = canReceivePayments({
    id: profile.id,
    company_verified_at: (profile as { company_verified_at?: string | null }).company_verified_at ?? null,
  });
  const wl = (profile as any).whitelabel_enabled;
  const wlBrand = (profile as any).whitelabel_brand_name;
  const wlLogo = (profile as any).whitelabel_logo_url;
  const wlPrimary = (profile as any).whitelabel_primary_color;
  const wlColor = (profile as any).whitelabel_accent_color;
  const wlColor2 = (profile as any).whitelabel_accent_color_2;
  const wlColor3 = (profile as any).whitelabel_accent_color_3;

  const wlStyle = wl ? {
    ...(wlPrimary ? { '--usha-gold': wlPrimary, '--usha-primary': wlPrimary } : {}),
    ...(wlColor ? { '--usha-accent': wlColor } : {}),
    ...(wlColor2 ? { '--usha-accent-2': wlColor2 } : {}),
    ...(wlColor3 ? { '--usha-accent-3': wlColor3 } : {}),
  } as React.CSSProperties : undefined;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: profile.full_name || "Creator",
    url: `https://usha.se/creators/${(profile as any).slug || profile.id}`,
    ...(profile.avatar_url ? { image: profile.avatar_url } : {}),
    ...(profile.bio ? { description: profile.bio.slice(0, 300) } : {}),
    ...(profile.location ? { address: { "@type": "PostalAddress", addressLocality: profile.location } } : {}),
    ...(creatorCategories.length ? { jobTitle: creatorCategories.map((c: string) => CATEGORY_LABELS[c] || c).join(", ") } : {}),
  };

  return (
    <div className="min-h-screen" style={wlStyle}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
      />
      {/* Header */}
      <header className="border-b border-[var(--usha-border)]">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-6">
          <Link href={isLoggedIn ? "/app" : "/"} className="flex items-center gap-2">
            {wl && wlLogo ? (
              <Image src={wlLogo} alt={wlBrand || "Logo"} width={32} height={32} className="h-8 w-8 rounded-lg object-contain" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--usha-gold)] to-[var(--usha-accent)]">
                <span className="text-sm font-bold text-black">U</span>
              </div>
            )}
            <span className="text-lg font-bold tracking-tight">{wl && wlBrand ? wlBrand : "Usha Platform"}</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/marketplace"
              className="text-sm text-[var(--usha-muted)] transition hover:text-[var(--usha-white)]"
            >
              {t("nav.marketplace")}
            </Link>
            {isLoggedIn ? (
              <Link
                href="/app"
                className="rounded-lg bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90"
              >
                {t("nav.app")}
              </Link>
            ) : (
              <Link
                href="/signup"
                className="rounded-lg bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90"
              >
                {t("nav.getStarted")}
              </Link>
            )}
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-10">
        <Link
          href="/marketplace"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-[var(--usha-muted)] transition-colors hover:text-[var(--usha-white)]"
        >
          <ArrowLeft size={14} />
          {t("nav.backToMarketplace")}
        </Link>

        {/* Profile header */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6 md:mb-10">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--usha-border)] bg-[var(--usha-card)] sm:h-24 sm:w-24">
            {profile.avatar_url ? (
              <Image
                src={profile.avatar_url}
                alt={profile.full_name || "Creator"}
                width={96}
                height={96}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-3xl font-bold text-[var(--usha-muted)]">
                {profile.full_name?.[0]?.toUpperCase() || "?"}
              </span>
            )}
          </div>

          <div className="flex-1">
            <h1 className="mb-1 flex flex-wrap items-center gap-2 text-2xl font-bold sm:text-3xl">
              {profile.full_name || "Creator"}
              {(profile as { bankid_verified_at?: string | null }).bankid_verified_at && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full bg-green-500 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white shadow-md shadow-green-500/40 ring-1 ring-green-700/20"
                  title={(profile as { bankid_name?: string | null }).bankid_name ? t("bankidVerifiedTitleNamed", { name: (profile as { bankid_name?: string | null }).bankid_name! }) : t("bankidVerifiedTitle")}
                >
                  <ShieldCheck size={14} strokeWidth={2.5} />
                  {t("bankidBadge")}
                </span>
              )}
            </h1>
            <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-[var(--usha-muted)]">
              {creatorCategories.map((cat) => (
                <span key={cat} className="rounded-full border border-[var(--usha-border)] px-3 py-0.5">
                  {CATEGORY_LABELS[cat] || cat}
                </span>
              ))}
              {creatorLocations.map((loc) => (
                <span key={loc} className="flex items-center gap-1">
                  <MapPin size={13} />
                  {loc}
                </span>
              ))}
            </div>
            {Object.keys(creatorRates).length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {Object.entries(creatorRates).map(([cat, rate]) => (
                  <span key={cat} className="rounded-full bg-[var(--usha-gold)]/10 px-3 py-0.5 text-xs font-semibold text-[var(--usha-gold)]">
                    {t("rate", { category: CATEGORY_LABELS[cat] || cat, rate })}
                  </span>
                ))}
              </div>
            )}
            <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-[var(--usha-muted)]">
              {creatorWebsites.map((url) => (
                <a
                  key={url}
                  href={url.startsWith("http") ? url : `https://${url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 transition-colors hover:text-[var(--usha-white)]"
                >
                  <Globe size={13} />
                  {url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </a>
              ))}
              {profile.social_instagram && (
                <a
                  href={`https://instagram.com/${profile.social_instagram.replace(/^@/, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 transition-colors hover:text-[var(--usha-white)]"
                >
                  <Instagram size={13} />
                  {profile.social_instagram}
                </a>
              )}
              {profile.social_x && (
                <a
                  href={`https://x.com/${profile.social_x.replace(/^@/, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 transition-colors hover:text-[var(--usha-white)]"
                >
                  <span className="text-xs font-bold">𝕏</span>
                  {profile.social_x}
                </a>
              )}
              {profile.social_facebook && (
                <a
                  href={profile.social_facebook.startsWith("http") ? profile.social_facebook : `https://facebook.com/${profile.social_facebook}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 transition-colors hover:text-[var(--usha-white)]"
                >
                  <span className="text-xs font-bold">f</span>
                  {profile.social_facebook.replace(/^https?:\/\/(www\.)?facebook\.com\//, "")}
                </a>
              )}
            </div>
            {((profile as any).contact_email || (profile as any).contact_phone) && (
              <div className="mb-4 flex flex-wrap items-center gap-4 text-sm text-[var(--usha-muted)]">
                {(profile as any).contact_email && (
                  <a href={`mailto:${(profile as any).contact_email}`} className="flex items-center gap-1 transition-colors hover:text-[var(--usha-white)]">
                    <Mail size={13} />
                    {(profile as any).contact_email}
                  </a>
                )}
                {(profile as any).contact_phone && (
                  <a href={`tel:${(profile as any).contact_phone}`} className="flex items-center gap-1 transition-colors hover:text-[var(--usha-white)]">
                    <Phone size={13} />
                    {(profile as any).contact_phone}
                  </a>
                )}
              </div>
            )}
            {profile.bio && (
              <p className="max-w-2xl whitespace-pre-line text-sm leading-relaxed text-[var(--usha-muted)]">
                {profile.bio}
              </p>
            )}
            {!isOwnProfile && (
              <div className="mt-4 flex items-center gap-3">
                <FollowButton
                  creatorId={profile.id}
                  initialFollowing={isFollowing}
                  followerCount={followerCount || 0}
                  isLoggedIn={isLoggedIn}
                />
                {hasConnect && (
                  <TipButton recipientId={profile.id} recipientName={profile.full_name} />
                )}
                {isLoggedIn && (
                  <>
                    <Link
                      href={`/app/messages?to=${profile.id}`}
                      className="inline-flex items-center gap-2 rounded-xl border border-[var(--usha-border)] px-4 py-2 text-sm font-medium transition hover:border-[var(--usha-gold)]/30 hover:text-[var(--usha-gold)]"
                    >
                      <MessageCircle size={14} />
                      {t("sendMessage")}
                    </Link>
                    <ReportUserButton userId={profile.id} userName={profile.full_name || t("userFallbackName")} />
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Listings */}
        <div>
          <h2 className="mb-4 text-xl font-bold">{t("services.heading")}</h2>
          {!listings || listings.length === 0 ? (
            <p className="text-sm text-[var(--usha-muted)]">
              {t("services.empty")}
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {listings.map((listing) => (
                <Link
                  key={listing.id}
                  href={`/listing/${listing.id}`}
                  className="block rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-5 transition hover:border-[var(--usha-gold)]/30"
                >
                  <div className="mb-2 flex items-start justify-between">
                    <h3 className="font-semibold">{listing.title}</h3>
                    {listing.price != null && (
                      <span className="shrink-0 font-semibold text-[var(--usha-gold)]">
                        {t("services.priceSek", { price: listing.price })}
                      </span>
                    )}
                  </div>
                  {listing.description && (
                    <p className="mb-3 line-clamp-2 text-sm text-[var(--usha-muted)]">
                      {listing.description}
                    </p>
                  )}
                  {/* Experience details badges */}
                  {listing.experience_details && (() => {
                    const details = listing.experience_details as ExperienceDetails;
                    return details?.included?.length ? (
                      <div className="mb-3 flex flex-wrap gap-1.5">
                        {details.included.map((item) => (
                          <span key={item} className="rounded-full bg-[var(--usha-gold)]/10 px-2 py-0.5 text-[10px] text-[var(--usha-gold)]">
                            {item}
                          </span>
                        ))}
                      </div>
                    ) : null;
                  })()}
                  <div className="flex items-center justify-between">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-3 text-xs text-[var(--usha-muted)]">
                        <span className="rounded-full border border-[var(--usha-border)] px-2 py-0.5">
                          {CATEGORY_LABELS[listing.category] || listing.category}
                        </span>
                        {listing.duration_minutes != null && (
                          <span className="flex items-center gap-1">
                            <Clock size={11} />
                            {t("services.durationMin", { minutes: listing.duration_minutes })}
                          </span>
                        )}
                        {listing.max_guests && (
                          <span className="flex items-center gap-1">
                            <Users size={11} />
                            {t("services.guests", { min: listing.min_guests ?? 1, max: listing.max_guests })}
                          </span>
                        )}
                      </div>
                      {(listing.event_date || listing.event_time || listing.event_location) && (
                        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--usha-muted)]">
                          {listing.event_date && (
                            <span className="flex items-center gap-1">
                              <Calendar size={11} />
                              {new Date(listing.event_date + "T00:00").toLocaleDateString("sv-SE", { day: "numeric", month: "short", year: "numeric" })}
                            </span>
                          )}
                          {listing.event_time && (
                            <span className="flex items-center gap-1">
                              <Clock size={11} />
                              {listing.event_time.slice(0, 5)}
                            </span>
                          )}
                          {listing.event_location && (
                            <span className="flex items-center gap-1">
                              <MapPin size={11} />
                              {listing.event_location}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {!isOwnProfile && (
                      <div className="flex items-center gap-2">
                        {/* Tickets are only for events; services are booked, not ticketed. */}
                        {listing.listing_type === "event" &&
                          listing.price != null &&
                          listing.price > 0 && (
                            <BuyTicketButton
                              listingId={listing.id}
                              originalPrice={listing.price}
                              discountedPrice={calculateDiscountedPrice(listing.price, visitorTier)}
                              isLoggedIn={isLoggedIn}
                              hasConnect={hasConnect}
                            />
                          )}
                        <BookingForm
                          listing={listing}
                          creatorId={profile.id}
                          isLoggedIn={isLoggedIn}
                          hasConnect={hasConnect}
                          payeeCanReceive={payeeCanReceive}
                          viewerRole={visitorRole}
                        />
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Event Timeline */}
        {(() => {
          const eventsWithDates = (listings || []).filter((l) => l.event_date);
          if (eventsWithDates.length === 0) return null;
          const today = new Date().toISOString().split("T")[0];
          const upcoming = eventsWithDates.filter((l) => l.event_date! >= today).sort((a, b) => a.event_date!.localeCompare(b.event_date!));
          const past = eventsWithDates.filter((l) => l.event_date! < today).sort((a, b) => b.event_date!.localeCompare(a.event_date!));
          return (
            <div className="mt-10">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-xl font-bold">{t("events.heading")}</h2>
                <Link href={`/creators/${params.id}/kalender`} className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--usha-gold)] hover:underline">
                  <Calendar size={14} /> {t("events.seeCalendar")}
                </Link>
              </div>
              {upcoming.length > 0 && (
                <>
                  <h3 className="mb-3 text-sm font-semibold text-emerald-400">{t("events.upcoming")}</h3>
                  <div className="mb-6 space-y-2">
                    {upcoming.map((ev) => (
                      <Link key={ev.id} href={`/listing/${ev.id}`} className="flex items-center gap-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 transition hover:border-emerald-500/40">
                        <div className="shrink-0 text-center">
                          <div className="text-lg font-bold text-emerald-400">
                            {new Date(ev.event_date + "T00:00").getDate()}
                          </div>
                          <div className="text-[10px] uppercase text-emerald-400/70">
                            {new Date(ev.event_date + "T00:00").toLocaleDateString("sv-SE", { month: "short" })}
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{ev.title}</p>
                          <div className="flex items-center gap-3 text-xs text-[var(--usha-muted)]">
                            {ev.event_time && <span>{ev.event_time.slice(0, 5)}</span>}
                            {ev.event_location && <span className="flex items-center gap-1"><MapPin size={10} />{ev.event_location}</span>}
                            {ev.price != null && <span className="text-[var(--usha-gold)]">{t("services.priceSek", { price: ev.price })}</span>}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </>
              )}
              {past.length > 0 && (
                <>
                  <h3 className="mb-3 text-sm font-semibold text-[var(--usha-muted)]">{t("events.past")}</h3>
                  <div className="space-y-2">
                    {past.slice(0, 10).map((ev) => (
                      <Link key={ev.id} href={`/listing/${ev.id}`} className="flex items-center gap-4 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4 opacity-70 transition hover:opacity-90">
                        <div className="shrink-0 text-center">
                          <div className="text-lg font-bold text-[var(--usha-muted)]">
                            {new Date(ev.event_date + "T00:00").getDate()}
                          </div>
                          <div className="text-[10px] uppercase text-[var(--usha-muted)]">
                            {new Date(ev.event_date + "T00:00").toLocaleDateString("sv-SE", { month: "short", year: "numeric" })}
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{ev.title}</p>
                          <div className="flex items-center gap-3 text-xs text-[var(--usha-muted)]">
                            {ev.event_location && <span className="flex items-center gap-1"><MapPin size={10} />{ev.event_location}</span>}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {/* Portfolio */}
        {mediaData && mediaData.length > 0 && (
          <div className="mt-10">
            <h2 className="mb-4 text-xl font-bold">{t("portfolio")}</h2>
            <CreatorGallery media={mediaData} />
          </div>
        )}

        {/* Digital products */}
        {digitalProducts && digitalProducts.length > 0 && (
          <div className="mt-10">
            <CreatorProducts products={digitalProducts} isLoggedIn={isLoggedIn} creatorId={profile.id} />
          </div>
        )}

        {/* Availability */}
        <div className="mt-10">
          <AvailabilityCalendar creatorId={profile.id} initialAvailableDates={availableDates} />
        </div>

        {/* Reviews */}
        <div className="mt-10">
          <CreatorReviews creatorId={profile.id} />
        </div>
      </div>
    </div>
  );
}
