export const revalidate = 60; // ISR: revalidate every 60 seconds

import { createClient } from "@/lib/supabase/server";
import { safeJsonLd } from "@/lib/json-ld";
import { CATEGORY_LABELS } from "@/lib/categories";
import { getTranslations, getLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import type { ExperienceDetails } from "@/types/database";
import Link from "next/link";
import Image from "next/image";
import { MapPin, Clock, Globe, ArrowLeft, Calendar, MessageCircle, Users, Instagram, Mail, Phone, ShieldCheck, ChevronDown } from "lucide-react";
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
import { ShareEventButton } from "@/components/share-event-button";
import { createAdminClient } from "@/lib/supabase/admin";
import { readShareToken, shareTokenMatches } from "@/lib/profiles/share-link";
import { isAdminById } from "@/lib/admin/check";
import { InstructorMinutesCard } from "@/components/instructor-minutes-card";
import { indexable } from "@/lib/seo/metadata";

interface Props {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
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
    // Profilen nås som /creators/<id>, /creators/<slug> och via kreatörens
    // korta /<slug> (som omdirigerar hit). Sluggen är den adress vi vill ha
    // indexerad när den finns.
    ...indexable(`/creators/${profile.slug || profile.id}`),
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
  const locale = await getLocale();
  const tCommon = await getTranslations("common");

  const column = isUUID(params.id) ? "id" : "slug";
  // Hämtas med service-role och UTAN is_public-filtret, för att ägaren och
  // admin ska kunna se en sida innan den är publik. En kreatör som bygger sin
  // profil hade annars ingen väg att se resultatet förrän hen tryckt publicera,
  // och admin fick rendera sidan för hand ur databasen för att följa framsteg.
  // Alla andra möter fortfarande 404 för en opublik profil — samma som förut.
  const [{ data: profile }, { data: { user } }] = await Promise.all([
    createAdminClient()
      .from("profiles")
      .select(
        "id, full_name, avatar_url, bio, category, location, hourly_rate, website, company_verified_at, categories, locations, rates, websites, social_instagram, social_x, social_facebook, contact_email, contact_phone, whitelabel_enabled, whitelabel_brand_name, whitelabel_logo_url, whitelabel_primary_color, whitelabel_accent_color, whitelabel_accent_color_2, whitelabel_accent_color_3, bankid_verified_at, bankid_name, offers_coaching, coaching_hourly_rate_sek, coaching_specialties, slug, is_public, share_token"
      )
      .eq(column, params.id)
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);

  if (!profile) notFound();
  // Tre vägar in till en opublik profil: ägaren, admin, eller en giltig
  // delningstoken i länken. Token gör det möjligt att visa sig för utvalda
  // utan att synas på marknadsplatsen — profilen ligger kvar utanför sök och
  // listningar, den är bara nåbar för den som fått adressen.
  const sharedToken = readShareToken(await props.searchParams);
  const viaShareLink = shareTokenMatches(profile.share_token, sharedToken);
  const canPreview =
    viaShareLink || (!!user && (user.id === profile.id || (await isAdminById(user.id))));
  if (!profile.is_public && !canPreview) notFound();
  const isPreviewOfUnpublished = !profile.is_public;

  // En profil med egen adress ska bo på den, inte på sitt id. Länkar byggda
  // innan slugen fanns — en QR-kod, ett delat meddelande, en gammal bokmärkning
  // — pekar fortfarande på UUID:t, och utan det här står den kvar i
  // adressfältet hos den som klickar. Metadatans canonical pekar redan på
  // slug-adressen, så utan omdirigeringen säger sidan en sak och webbläsaren
  // en annan.
  if (isUUID(params.id) && profile.slug) {
    redirect(`/creators/${profile.slug}`);
  }

  const { data: allListings } = await supabase
    .from("listings")
    .select("id, title, image_url, description, category, price, duration_minutes, event_date, event_time, event_location, release_to_gold_at, listing_type, min_guests, max_guests, experience_details, sort_order")
    .eq("user_id", profile.id)
    .eq("is_active", true)
    .eq("is_public", true)
    // Kreatörens egen ordning först. NULL sorteras sist, så allt som aldrig
    // ordnats behåller exakt sitt gamla utseende — nyast först.
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  // Evenemang som ANDRA arrangerar hos den här lokalen. Det är den här sidan
  // som gör att en lokal kan nå sin publik genom plattformen i stället för att
  // få deltagarlistor utlämnade till sig.
  //
  // Bara bekräftade kopplingar visas: annars kunde vem som helst tagga en
  // populär lokal och göra sitt evenemang synligt på dess sida.
  const { data: hostedEvents } = await supabase
    .from("listings")
    .select("id, title, event_date, event_time, event_location, price, profiles!user_id(full_name)")
    .eq("venue_profile_id", profile.id)
    .not("venue_confirmed_at", "is", null)
    .neq("user_id", profile.id)
    .eq("is_active", true)
    .eq("is_public", true)
    .order("event_date", { ascending: true });

  // Coaching på The Lab säljs som instruktörsminuter på ett öppet event, inte
  // från profilen. Profilen visar därför nästa öppna kväll och låter minuterna
  // köpas mot den. Utan en kommande öppen kväll finns inget att köpa mot, och
  // då visas inte kortet — ett dött köp är sämre än inget.
  const coachingOnLab = !!(profile as any).offers_coaching && ((profile as any).coaching_hourly_rate_sek ?? 0) > 0;
  const { data: nextOpenNight } = coachingOnLab
    ? await supabase
        .from("listings")
        .select("id, title, event_date, event_time")
        .eq("user_id", profile.id)
        .eq("listing_type", "event")
        .eq("open_to_instructors", true)
        .eq("is_active", true)
        .eq("is_public", true)
        .gte("event_date", new Date().toISOString().slice(0, 10))
        .order("event_date", { ascending: true })
        .limit(1)
        .maybeSingle()
    : { data: null };

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
  // Ett evenemang och en tjänst renderades i samma rutnät under rubriken
  // "Tjänster", och sedan en gång till i evenemangstidslinjen. Samma kväll två
  // gånger på samma sida. Tjänster är det som inte har ett datum att gå till.
  //
  // Skiljs på datum, inte på listing_type. Fältet har skrivits av formuläret i
  // månader utan att någon läst det, så det är inte att lita på: ett åttaveckors
  // kostprogram låg typat som "event" utan datum och hade försvunnit från båda
  // sektionerna. Tidslinjen längre ner går redan på datum — samma regel här.
  const serviceListings = listings.filter((l) => !l.event_date && l.listing_type !== "package");
  // Klippkorten saknar datum men hör till kvällarna de ger tillträde till, inte
  // till coachingen. De hör alltså hemma under Evenemang, inte under Tjänster.
  const passListings = listings.filter((l) => !l.event_date && l.listing_type === "package");

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
  // stripe_account_id är inte längre läsbart för anon (P0-lockdown); härled bara
  // booleanet via SECURITY DEFINER-funktionen has_stripe_connect.
  const { data: hasConnectData } = await supabase.rpc("has_stripe_connect", { p_id: profile.id });
  const hasConnect = !!hasConnectData;
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
        {isPreviewOfUnpublished && (
          <div className="mb-4 rounded-xl border border-[var(--usha-gold)]/40 bg-[var(--usha-gold)]/10 px-4 py-3 text-sm text-[var(--usha-gold)]">
            {t("previewBanner")}
          </div>
        )}
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
            {profile.bio && (
              <p className="mb-5 max-w-2xl whitespace-pre-line text-[15px] leading-relaxed text-[var(--usha-white)]">
                {profile.bio}
              </p>
            )}
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
            {/* Dela finns för alla — även ägaren, som når hit via "Visa min sida"
                och vill kunna skicka sin sida vidare direkt därifrån. Absolut
                adress: navigator.share kräver en fullständig URL.

                Men inte på en opublik profil: den sidan är 404 för alla utom
                ägaren och admin, så en delad länk hade lett mottagaren till en
                återvändsgränd. */}
            {!isPreviewOfUnpublished && (
            <div className="mt-4">
              <ShareEventButton
                url={`https://usha.se/creators/${(profile as any).slug || profile.id}`}
                title={profile.full_name || t("creatorFallbackName")}
                text={t("shareText", { name: profile.full_name || t("creatorFallbackName") })}
                label={t("share")}
                copiedLabel={tCommon("linkCopied")}
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--usha-border)] px-4 py-2 text-sm font-medium transition hover:border-[var(--usha-gold)]/30 hover:text-[var(--usha-gold)]"
              />
            </div>
            )}
            {!isOwnProfile && (
              <div className="mt-4 flex items-center gap-3">
                <FollowButton
                  creatorId={profile.id}
                  initialFollowing={isFollowing}
                  followerCount={followerCount || 0}
                  isLoggedIn={isLoggedIn}
                />
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

        {/* Evenemang hos den här lokalen, arrangerade av andra */}
        {hostedEvents && hostedEvents.length > 0 && (
          <div className="mb-10">
            <h2 className="mb-4 text-xl font-bold">{t("hosted.heading")}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {hostedEvents.map((ev) => {
                const organiser = Array.isArray(ev.profiles) ? ev.profiles[0] : ev.profiles;
                return (
                  <Link
                    key={ev.id}
                    href={`/listing/${ev.id}`}
                    className="block rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-5 transition hover:border-[var(--usha-gold)]/30"
                  >
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <h3 className="font-semibold">{ev.title}</h3>
                      {ev.price != null && (
                        <span className="shrink-0 font-semibold text-[var(--usha-gold)]">
                          {t("services.priceSek", { price: ev.price })}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--usha-muted)]">
                      {[ev.event_date, ev.event_time?.slice(0, 5)].filter(Boolean).join(" · ")}
                    </p>
                    {organiser?.full_name && (
                      <p className="mt-1 text-xs text-[var(--usha-muted)]">
                        {t("hosted.by", { name: organiser.full_name })}
                      </p>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Listings */}
        <div>
          <h2 className="mb-4 text-xl font-bold">{t("services.heading")}</h2>
          {serviceListings.length === 0 ? (
            <p className="text-sm text-[var(--usha-muted)]">
              {t("services.empty")}
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {serviceListings.map((listing) => (
                <Link
                  key={listing.id}
                  href={`/listing/${listing.id}`}
                  className="group block overflow-hidden rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] transition hover:border-[var(--usha-gold)]/30"
                >
                  {/* Tjänsten säljs på bilden lika mycket som på texten. Saknas den
                      får kortet en lugn platshållare i stället för att hoppa i höjd. */}
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
                  <div className="p-5">
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
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Coaching på The Lab är också en tjänst — den säljs bara på ett annat sätt:
              minuter mot nästa öppna kväll i stället för en bokad tid. Därför står den
              här bland tjänsterna, inte uppe i huvudet bredvid priserna. */}
          {coachingOnLab && nextOpenNight && (
            <div className="mt-4 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-5">
              <h3 className="mb-1 font-semibold">{t("coaching.onLab")}</h3>
              <p className="mb-2 text-xs text-[var(--usha-muted)]">
                {t("coaching.onLabHint", { name: profile.full_name || t("creatorFallbackName") })}{" "}
                <Link href={`/listing/${nextOpenNight.id}`} className="text-[var(--usha-gold)] hover:underline">
                  {t("coaching.nextNight", {
                    date: [new Date(nextOpenNight.event_date + "T00:00").toLocaleDateString(locale, { day: "numeric", month: "long" }), nextOpenNight.event_time?.slice(0, 5)].filter(Boolean).join(" "),
                  })}
                </Link>
              </p>
              <InstructorMinutesCard
                listingId={nextOpenNight.id}
                instructorId={profile.id}
                instructorName={profile.full_name || t("creatorFallbackName")}
                avatarUrl={profile.avatar_url}
                specialties={((profile as any).coaching_specialties as string[] | null) ?? []}
                hourlyRate={(profile as any).coaching_hourly_rate_sek as number}
                isLoggedIn={isLoggedIn}
                disabledReason={isOwnProfile ? t("coaching.itsYou") : undefined}
              />
            </div>
          )}
        </div>

        {/* Event Timeline */}
        {(() => {
          const eventsWithDates = (listings || []).filter((l) => l.event_date);
          if (eventsWithDates.length === 0 && passListings.length === 0) return null;
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
              {passListings.length > 0 && (
                <div className="mb-6 space-y-2">
                  <h3 className="mb-3 text-sm font-semibold text-[var(--usha-gold)]">{t("events.passes")}</h3>
                  {passListings.map((p) => (
                    <Link key={p.id} href={`/listing/${p.id}`} className="flex items-center justify-between gap-4 rounded-xl border border-[var(--usha-gold)]/25 bg-[var(--usha-gold)]/5 p-4 transition hover:border-[var(--usha-gold)]/50">
                      <p className="min-w-0 font-medium">{p.title}</p>
                      {p.price != null && <span className="shrink-0 font-semibold text-[var(--usha-gold)]">{t("services.priceSek", { price: p.price })}</span>}
                    </Link>
                  ))}
                </div>
              )}
              {upcoming.length > 0 && (
                <details open className="group mb-6">
                  <summary className="mb-3 flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-emerald-400">
                    <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
                    {t("events.upcoming")}
                    <span className="font-normal text-[var(--usha-muted)]">{upcoming.length}</span>
                  </summary>
                  <div className="space-y-2">
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
                </details>
              )}
              {past.length > 0 && (
                <details className="group">
                  <summary className="mb-3 flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-[var(--usha-muted)]">
                    <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
                    {t("events.past")}
                    <span className="font-normal">{Math.min(past.length, 10)}</span>
                  </summary>
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
                </details>
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
