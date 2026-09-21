"use client";

import { useRole } from "@/components/mobile/role-context";
import {
  Calendar,
  Star,
  MapPin,
  Users,
  DollarSign,
  Clock,
  ChevronRight,
  Music,
  Camera,
  Palette,
  UtensilsCrossed,
  Ticket,
  PartyPopper,
  Waves,
  TrendingUp,
  Sparkles,
  Plus,
  Search,
  MessageCircle,
  Compass,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { OnboardingChecklist } from "./creator-onboarding";
import { PendingTodos } from "./pending-todos";
import { OwnListingRow, type OwnListing } from "./own-listing-row";
import { ReachOut } from "./reach-out";
import type { TodoItem } from "@/lib/todo/pending";
import RecommendedEvents from "@/components/RecommendedEvents";
import { FavoriteButton } from "@/components/favorite-button";
import { BuyTicketCta } from "@/components/buy-ticket-cta";
import { SearchBar } from "@/components/search-bar";
import { GatedAction } from "@/components/subscription/GatedAction";
import { Feed } from "@/components/feed/feed";
import { CreatePostForm } from "@/components/feed/create-post-form";
import { useTranslations } from "next-intl";
import type { FeedPost } from "@/types/database";

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  website: string | null;
  category: string | null;
  location: string | null;
  hourly_rate: number | null;
  is_public: boolean;
  tier: string | null;
  stripe_account_id: string | null;
  created_at: string;
  updated_at: string;
  // Onboarding/seller-state (present via profiles.select("*")).
  role?: string | null;
  bankid_verified_at?: string | null;
  is_company?: boolean | null;
  company_verified_at?: string | null;
  terms_url?: string | null;
  slug?: string | null;
  whitelabel_enabled?: boolean | null;
  stripe_card_payments_enabled?: boolean | null;
  customer_location?: string | null;
}

interface Listing {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  category: string;
  price: number | null;
  duration_minutes: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  event_date?: string | null;
  event_time?: string | null;
  image_url?: string | null;
  slug?: string | null;
}

type TopCreator = Pick<Profile, "id" | "full_name" | "category" | "avatar_url">;

export interface UpcomingBooking {
  id: string;
  title: string;
  scheduledAt: string;
  location: string | null;
}

interface HomeContentProps {
  profile: Profile | null;
  listings: Listing[];
  ownServices?: OwnListing[];
  /**
   * Antal egna listningar, räknat i databasen. Listan ovan är kapad till tio
   * poster, så dess längd är en visningsgräns och inte ett antal — KPI-rutan
   * visade "10" för den som hade sjutton.
   */
  ownServicesCount?: number;
  topCreators: TopCreator[];
  bookingsCount: number;
  monthlyRevenue?: number;
  averageRating?: number | null;
  feedPosts?: FeedPost[];
  upcomingBookings?: UpcomingBooking[];
  hasPreferences?: boolean;
  hostedEventsCount?: number;
  /** Sådant som väntar på ett svar. Tomt = panelen visas inte alls. */
  todos?: TodoItem[];
}

export function HomeContent({
  profile,
  listings,
  ownServices = [],
  ownServicesCount,
  topCreators,
  bookingsCount,
  monthlyRevenue = 0,
  averageRating = null,
  feedPosts = [],
  upcomingBookings = [],
  hasPreferences = false,
  hostedEventsCount = 0,
  todos = [],
}: HomeContentProps) {
  const { role } = useRole();
  const servicesCount = ownServicesCount ?? ownServices.length;

  if (role === "customer") {
    return (
      <PublikHome
        profile={profile}
        listings={listings}
        topCreators={topCreators}
        tier={profile?.tier || "gratis"}
        feedPosts={feedPosts}
        upcomingBookings={upcomingBookings}
        hasPreferences={hasPreferences}
        todos={todos}
      />
    );
  }

  if (role === "creator") {
    return (
      <KreatorHome
        profile={profile}
        bookingsCount={bookingsCount}
        listings={listings}
        ownServices={ownServices}
        servicesCount={servicesCount}
        monthlyRevenue={monthlyRevenue}
        averageRating={averageRating}
        tier={profile?.tier || "gratis"}
        feedPosts={feedPosts}
        todos={todos}
      />
    );
  }

  return (
    <UpplevelseHome profile={profile} bookingsCount={bookingsCount} listings={listings} ownServices={ownServices} servicesCount={servicesCount} monthlyRevenue={monthlyRevenue} averageRating={averageRating} tier={profile?.tier || "gratis"} feedPosts={feedPosts} hostedEventsCount={hostedEventsCount} todos={todos} />
  );
}

/* ─── Publik (Customer) Home ─── */
function PublikHome({
  profile,
  listings,
  topCreators,
  tier = "gratis",
  feedPosts = [],
  upcomingBookings = [],
  hasPreferences = false,
  todos = [],
}: {
  profile: Profile | null;
  listings: Listing[];
  topCreators: TopCreator[];
  tier?: string;
  feedPosts?: FeedPost[];
  upcomingBookings?: UpcomingBooking[];
  hasPreferences?: boolean;
  todos?: TodoItem[];
}) {
  const t = useTranslations("home");
  const tc = useTranslations("common");

  // "What do you want to do today?" quick actions — the user's primary jobs.
  const quickActions = [
    { label: t("qaFindEvent"), href: "/app/search", icon: Search },
    { label: t("qaMyBookings"), href: "/app/tickets", icon: Ticket },
    { label: tc("messages"), href: "/app/messages", icon: MessageCircle },
    { label: t("qaDiscoverCreators"), href: "/marketplace", icon: Compass },
  ];
  const isGuld = tier === "guld" || tier === "premium";
  const isPremium = tier === "premium";
  const eventImages = [
    "https://images.unsplash.com/photo-1504609813442-a8924e83f76e?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=600&h=400&fit=crop",
    "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=600&h=400&fit=crop",
  ];

  const events = listings.map((listing) => ({
    id: listing.id,
    title: listing.title,
    date: listing.created_at
      ? new Date(listing.created_at).toLocaleDateString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : "",
    price: listing.price ? `${listing.price} kr` : t("free"),
    priceNum: listing.price ?? null,
    slug: (listing as { slug?: string | null }).slug ?? null,
    image: (listing as { image_url?: string | null }).image_url ?? null,
    category: listing.category || "Övrigt",
    hasTicketTypes:
      ((listing as { ticket_types?: unknown[] }).ticket_types?.length ?? 0) > 0,
  }));

  const categoryIconMap: Record<string, LucideIcon> = {
    dance: Music,
    musik: Music,
    music: Music,
    foto: Camera,
    photo: Camera,
    konst: Palette,
    art: Palette,
    restaurant: UtensilsCrossed,
    mat: UtensilsCrossed,
    wellness: Waves,
    spa: Waves,
    yoga: Waves,
    concert: PartyPopper,
    konsert: PartyPopper,
  };

  const venueListings = listings
    .filter((l) => l.category)
    .slice(0, 4)
    .map((l) => ({
      name: l.title,
      type: l.category,
      icon: categoryIconMap[l.category?.toLowerCase()] || Ticket,
    }));

  // Hero event — first listing gets the spotlight
  const heroEvent = events[0] || null;
  const restEvents = events.slice(1);

  return (
    <div className="space-y-8 pb-4">
      <PendingTodos items={todos} />
      {/* Ingen ReachOut i publikvyn: QR, egen adress och whitelabel är verktyg
          för den som säljer något. En besökare har ingen sida att sprida. */}
      <OnboardingChecklist
        role={profile?.role ?? "customer"}
        customerLocation={profile?.customer_location ?? null}
        hasPreferences={hasPreferences}
      />
      {/* Hero Section — full-bleed with glassmorphism */}
      {heroEvent ? (
        <div className="relative -mx-4 -mt-2 overflow-hidden md:-mx-0 md:rounded-2xl">
          <img
            src={heroEvent.image || eventImages[0]}
            alt={heroEvent.title}
            className="h-[280px] w-full object-cover md:h-[320px]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
          <div className="absolute right-3 top-3">
            <FavoriteButton listingId={heroEvent.id} isLoggedIn={!!profile} />
          </div>
          {/* Trending badge */}
          <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-red-500/90 px-2.5 py-1 text-[10px] font-bold text-white backdrop-blur-sm">
            <TrendingUp size={10} />
            {t("trending")}
          </div>
          {/* Glassmorphism info card */}
          <div className="absolute inset-x-3 bottom-3 rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-xl">
            <div className="flex items-end justify-between">
              <div>
                <span className="mb-1 inline-block rounded-full bg-[var(--usha-gold)] px-2.5 py-0.5 text-[10px] font-bold text-black">
                  {heroEvent.category}
                </span>
                <h2 className="mt-1.5 text-lg font-bold leading-tight text-white drop-shadow">
                  {heroEvent.title}
                </h2>
                <div className="mt-1 flex items-center gap-2 text-xs text-white/70">
                  <Calendar size={11} />
                  <span>{heroEvent.date}</span>
                </div>
              </div>
              <span className="rounded-xl bg-[var(--usha-gold)] px-3 py-1.5 text-sm font-bold text-black shadow-lg">
                {heroEvent.price}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="px-4 pt-4">
          <h1 className="text-2xl font-bold">
            {t("greeting", { name: profile?.full_name || t("greetingFallback") })}
          </h1>
          <p className="text-sm text-[var(--usha-muted)]">
            {t("discoverSubtitle")}
          </p>
        </div>
      )}

      <div className="space-y-8 px-4">
        {/* Greeting — compact when hero exists */}
        {heroEvent && (
          <div>
            <h1 className="text-xl font-bold">
              {t("greeting", { name: profile?.full_name || t("greetingFallback") })}
            </h1>
            <p className="text-xs text-[var(--usha-muted)]">
              {t("discoverSubtitle")}
            </p>
          </div>
        )}

        {/* Search — first focus */}
        <SearchBar />

        {/* Quick actions — "Vad vill du göra idag?" */}
        <section>
          <h2 className="mb-3 text-lg font-bold">{t("quickActionsTitle")}</h2>
          <div className="grid grid-cols-2 gap-2">
            {quickActions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="flex items-center gap-2.5 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-3 text-sm font-medium transition hover:border-[var(--usha-gold)]/30"
              >
                <action.icon size={16} className="text-[var(--usha-gold)]" />
                {action.label}
              </Link>
            ))}
          </div>
        </section>

        {/* Upcoming bookings — second focus */}
        {upcomingBookings.length > 0 && (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar size={16} className="text-[var(--usha-gold)]" />
                <h2 className="text-lg font-bold">{t("upcomingBookings")}</h2>
              </div>
              <Link href="/app/tickets" className="text-xs text-[var(--usha-gold)]">
                {tc("viewAll")}
              </Link>
            </div>
            <div className="space-y-2">
              {upcomingBookings.map((b) => (
                <Link
                  key={b.id}
                  href="/app/tickets"
                  className="flex items-center gap-3 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-3 transition hover:border-[var(--usha-gold)]/30"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--usha-gold)]/10">
                    <Ticket size={16} className="text-[var(--usha-gold)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{b.title}</p>
                    <p className="truncate text-xs text-[var(--usha-muted)]">
                      {new Date(b.scheduledAt).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      {b.location ? ` · ${b.location}` : ""}
                    </p>
                  </div>
                  <ChevronRight size={16} className="text-[var(--usha-muted)]" />
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Personalized Recommendations — near you */}
        <RecommendedEvents />

        {/* Event Carousel — snap scroll with dots */}
        {restEvents.length > 0 && (
          <section>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-[var(--usha-gold)]" />
                <h2 className="text-lg font-bold">{t("popularEvents")}</h2>
              </div>
              <Link href="/marketplace" className="text-xs text-[var(--usha-gold)]">
                {tc("viewAll")}
              </Link>
            </div>
            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 scrollbar-hide md:grid md:grid-cols-2 lg:grid-cols-3 md:overflow-x-visible">
              {restEvents.map((event, i) => (
                <div
                  key={event.id}
                  className="group min-w-[85vw] snap-start sm:min-w-[260px] md:min-w-0 overflow-hidden rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] transition-all duration-300 hover:border-[var(--usha-gold)]/30 hover:shadow-lg hover:shadow-[var(--usha-gold)]/5"
                >
                  <div className="relative h-36 overflow-hidden">
                    <img
                      src={event.image || eventImages[(i + 1) % eventImages.length]}
                      alt={event.title}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                    <div className="absolute right-2 top-2">
                      <FavoriteButton listingId={event.id} isLoggedIn={!!profile} />
                    </div>
                    <div className="absolute bottom-2 left-2 right-2 flex items-end justify-between">
                      <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                        {event.category}
                      </span>
                      <span className="rounded-full bg-[var(--usha-gold)] px-2.5 py-0.5 text-[10px] font-bold text-black">
                        {event.price}
                      </span>
                    </div>
                  </div>
                  <div className="p-3">
                    <h3 className="text-sm font-semibold leading-tight">{event.title}</h3>
                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--usha-muted)]">
                      <Calendar size={10} />
                      <span>{event.date}</span>
                    </div>
                    <BuyTicketCta
                      listingId={event.id}
                      slug={event.slug}
                      price={event.priceNum}
                      isLoggedIn={!!profile}
                      hasTicketTypes={event.hasTicketTypes}
                      className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-3 py-2 text-xs font-semibold text-black transition hover:opacity-90"
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* No events fallback */}
        {events.length === 0 && (
          <section>
            <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] py-16">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-[var(--usha-gold)]/20 to-[var(--usha-accent)]/20">
                <Calendar size={28} className="text-[var(--usha-gold)]" />
              </div>
              <p className="text-sm font-medium">{t("noEventsYet")}</p>
              <p className="mt-1 text-xs text-[var(--usha-muted)]">{t("checkBackSoon")}</p>
            </div>
          </section>
        )}

        {/* Social Feed — moved below discovery */}
        {feedPosts.length > 0 && (
          <section>
            <h2 className="mb-4 text-lg font-bold">{t("feed")}</h2>
            <Feed initialPosts={feedPosts} isLoggedIn={!!profile} currentUserId={profile?.id} />
          </section>
        )}

        {/* Guld/Premium exclusive section */}
        {isGuld && (
          <section>
            <div className="mb-4 flex items-center gap-2">
              <Star size={16} className="text-[var(--usha-gold)]" />
              <h2 className="text-lg font-bold">{t("exclusiveForYou")}</h2>
              {isPremium ? (
                <span className="rounded-full bg-purple-500/10 px-2 py-0.5 text-[10px] font-semibold text-purple-400">{t("vip")}</span>
              ) : (
                <span className="rounded-full bg-[var(--usha-gold)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--usha-gold)]">{t("gold")}</span>
              )}
            </div>
            <div className="rounded-2xl border border-[var(--usha-gold)]/20 bg-gradient-to-br from-[var(--usha-gold)]/5 to-transparent p-5">
              <div className="flex items-center gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--usha-gold)]/10">
                  <Clock size={18} className="text-[var(--usha-gold)]" />
                </div>
                <div>
                  <p className="text-sm font-semibold">
                    {t("earlyAccess", { hours: isPremium ? "72" : "48" })}
                  </p>
                  <p className="text-xs text-[var(--usha-muted)]">
                    {t("seeNewEventsFirst")}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-3 text-center">
                  <p className="text-lg font-bold text-[var(--usha-gold)]">{isPremium ? "20%" : "10%"}</p>
                  <p className="text-[10px] text-[var(--usha-muted)]">{t("bookingDiscount")}</p>
                </div>
                <div className="rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-3 text-center">
                  <p className="text-lg font-bold text-[var(--usha-gold)]">{isPremium ? t("vip") : t("priority")}</p>
                  <p className="text-[10px] text-[var(--usha-muted)]">{isPremium ? t("neverInQueue") : t("prioritySupport")}</p>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Top Creators — larger avatars with glow */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold">{t("topCreators")}</h2>
            <Link href="/marketplace" className="text-xs text-[var(--usha-gold)]">
              {tc("viewAll")}
            </Link>
          </div>
          <div className="flex gap-5 overflow-x-auto pb-2 scrollbar-hide md:grid md:grid-cols-5 md:overflow-x-visible">
            {topCreators.length > 0 ? topCreators.map((creator) => (
              <Link
                key={creator.id}
                href={`/creators/${creator.id}`}
                className="group flex min-w-[80px] md:min-w-0 flex-col items-center gap-2"
              >
                <div className="relative">
                  <div className="h-[68px] w-[68px] rounded-full border-2 border-[var(--usha-gold)]/60 p-0.5 transition-all duration-300 group-hover:border-[var(--usha-gold)] group-hover:shadow-lg group-hover:shadow-[var(--usha-gold)]/20">
                    {creator.avatar_url ? (
                      <img
                        src={creator.avatar_url}
                        alt={creator.full_name || ""}
                        className="h-full w-full rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-[var(--usha-gold)]/20 to-[var(--usha-accent)]/20">
                        <span className="text-lg font-bold text-[var(--usha-gold)]">
                          {(creator.full_name || "?")[0]}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-xs font-medium leading-tight">
                    {(creator.full_name || "Kreator").split(" ")[0]}
                  </p>
                  <p className="text-[10px] text-[var(--usha-muted)]">
                    {creator.category || "Kreator"}
                  </p>
                </div>
              </Link>
            )) : (
              <div className="col-span-full flex flex-col items-center justify-center rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] py-8">
                <Users size={28} className="mb-2 text-[var(--usha-muted)]" />
                <p className="text-sm text-[var(--usha-muted)]">{t("noCreatorsYet")}</p>
              </div>
            )}
          </div>
        </section>

        {/* Clubs & Studios — animated hover cards */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold">{t("clubsAndStudios")}</h2>
            <Link href="/marketplace" className="text-xs text-[var(--usha-gold)]">
              {tc("viewAll")}
            </Link>
          </div>
          <div className="space-y-3 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
            {venueListings.length > 0 ? venueListings.map((venue, i) => {
              const IconComponent = venue.icon;
              return (
                <div
                  key={i}
                  className="group flex items-center gap-4 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4 transition-all duration-300 hover:border-[var(--usha-gold)]/30 hover:bg-gradient-to-r hover:from-[var(--usha-gold)]/5 hover:to-transparent"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--usha-gold)]/10 to-[var(--usha-accent)]/10 transition-transform duration-300 group-hover:scale-110">
                    <IconComponent size={20} className="text-[var(--usha-gold)]" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold">{venue.name}</h3>
                    <p className="text-xs text-[var(--usha-muted)]">{venue.type}</p>
                  </div>
                  <ChevronRight size={16} className="text-[var(--usha-muted)] transition-transform duration-300 group-hover:translate-x-1 group-hover:text-[var(--usha-gold)]" />
                </div>
              );
            }) : (
              <div className="col-span-full flex flex-col items-center justify-center rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] py-8">
                <MapPin size={28} className="mb-2 text-[var(--usha-muted)]" />
                <p className="text-sm text-[var(--usha-muted)]">{t("noVenuesYet")}</p>
              </div>
            )}
          </div>
        </section>

        {/* Soft upgrade nudge */}
        {!isPremium && (
          <section>
            <Link
              href="/dashboard/billing"
              className="group block overflow-hidden rounded-2xl border border-[var(--usha-gold)]/20 bg-gradient-to-r from-[var(--usha-gold)]/5 via-[var(--usha-accent)]/5 to-transparent p-5 transition-all duration-300 hover:border-[var(--usha-gold)]/40"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-[var(--usha-gold)]/20 to-[var(--usha-accent)]/20">
                  <Sparkles size={18} className="text-[var(--usha-gold)]" />
                </div>
                <div className="flex-1">
                  {isGuld ? (
                    <>
                      <p className="text-sm font-semibold">{t("upgradeToPremium")}</p>
                      <p className="text-xs text-[var(--usha-muted)]">
                        {t("premiumBenefits")}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold">{t("becomeGold")}</p>
                      <p className="text-xs text-[var(--usha-muted)]">
                        {t("goldBenefits")}
                      </p>
                    </>
                  )}
                </div>
                <ChevronRight size={16} className="text-[var(--usha-gold)]/60 transition-transform duration-300 group-hover:translate-x-1" />
              </div>
            </Link>
          </section>
        )}
      </div>
    </div>
  );
}

/* ─── Kreatör (Creator) Home ─── */
function KreatorHome({
  profile,
  bookingsCount,
  listings,
  ownServices = [],
  servicesCount = 0,
  monthlyRevenue = 0,
  averageRating = null,
  tier = "gratis",
  feedPosts = [],
  todos = [],
}: {
  profile: Profile | null;
  bookingsCount: number;
  listings: Listing[];
  ownServices?: OwnListing[];
  /** Räknat i databasen — ownServices är kapad och duger inte att räkna på. */
  servicesCount?: number;
  monthlyRevenue?: number;
  averageRating?: number | null;
  tier?: string;
  feedPosts?: FeedPost[];
  todos?: TodoItem[];
}) {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const tr = useTranslations("roles");
  const isPremium = tier === "premium";
  const isGuld = tier === "guld";
  const commission = isPremium ? 3 : isGuld ? 8 : 15;

  // Egna listningar, de tre närmaste. Raden renderas av OwnListingRow — den
  // fick tidigare en tillplattad kopia utan bild, pris eller status, vilket var
  // hela anledningen till att listan såg ofullständig ut.
  // "Dina tjänster" visade även evenemangen, som redan har en egen flik.
  // Samma Lab-kväll dök upp på två ställen och rubriken blev meningslös.
  // Skiljs på datum, inte listing_type — se serviceListings på profilsidan.
  const todaysListings = ownServices.filter((l) => !l.event_date).slice(0, 3);

  const userListings = ownServices.map((l) => ({ id: l.id, title: l.title }));

  const onboarding = (
    <>
      <PendingTodos items={todos} />
      {profile && (
        <ReachOut
          profileId={profile.id}
          slug={profile.slug ?? null}
          isPublic={!!profile.is_public}
          whitelabelEnabled={!!profile.whitelabel_enabled}
          shareToken={(profile as { share_token?: string | null }).share_token ?? null}
        />
      )}
      <OnboardingChecklist
      role={profile?.role ?? "creator"}
      isCompany={!!profile?.is_company}
      bio={profile?.bio}
      avatarUrl={profile?.avatar_url}
      bankidVerifiedAt={profile?.bankid_verified_at ?? null}
      companyVerifiedAt={profile?.company_verified_at ?? null}
      termsUrl={profile?.terms_url ?? null}
      servicesCount={servicesCount}
      stripeAccountId={profile?.stripe_account_id}
      stripeCardPaymentsEnabled={!!profile?.stripe_card_payments_enabled}
      isPublic={profile?.is_public}
      />
    </>
  );

  const servicesEmpty = (
    <Link
      href="/dashboard/listings/new"
      className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--usha-gold)]/40 bg-[var(--usha-gold)]/5 px-4 py-5 text-sm font-medium text-[var(--usha-gold)] transition hover:bg-[var(--usha-gold)]/10"
    >
      <Plus size={16} />
      {t("createFirstService")}
    </Link>
  );

  const postForm = (
    <CreatePostForm
      authorName={profile?.full_name || tr("creator")}
      authorAvatar={profile?.avatar_url || null}
      listings={userListings}
    />
  );

  /* ── Premium: command-center layout ── */
  if (isPremium) {
    return (
      <div className="px-4 py-6 space-y-6">
        {/* Header — minimal */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">{profile?.full_name || tr("creator")}</h1>
            <p className="text-[11px] text-[var(--usha-muted)]">Premium · {t("commission", { commission })}</p>
          </div>
          <Link
            href="/app/calendar"
            className="rounded-lg bg-[var(--usha-card)] border border-[var(--usha-border)] px-3 py-1.5 text-xs font-medium text-[var(--usha-muted)] transition hover:text-[var(--usha-white)]"
          >
            {t("calendar")}
          </Link>
        </div>

        {/* Create post */}
        {postForm}

        {onboarding}

        {/* KPI ribbon — single row */}
        <div className="flex gap-2">
          {[
            { label: t("revenue"), value: `${monthlyRevenue.toLocaleString("sv-SE")} kr` },
            { label: t("bookings"), value: String(bookingsCount) },
            { label: t("rating"), value: averageRating != null ? `${averageRating}/5` : "—" },
            { label: t("services"), value: String(servicesCount) },
          ].map((kpi) => (
            <div key={kpi.label} className="flex-1 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-3 py-3 text-center">
              <p className="text-base font-bold leading-none">{kpi.value}</p>
              <p className="mt-1 text-[10px] text-[var(--usha-muted)]">{kpi.label}</p>
            </div>
          ))}
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: t("newService"), href: "/app/courses", icon: Clock },
            { label: t("newEvent"), href: "/app/events/new", icon: Ticket },
            { label: t("bookings"), href: "/app/calendar", icon: Calendar },
            { label: tc("messages"), href: "/app/messages", icon: Users },
            { label: tc("profile"), href: "/app/profile", icon: Star },
          ].map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className="flex items-center gap-3 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-3 text-sm font-medium transition hover:border-[var(--usha-gold)]/30"
            >
              <action.icon size={16} className="text-[var(--usha-muted)]" />
              {action.label}
            </Link>
          ))}
        </div>

        {/* Recent activity feed */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-[var(--usha-muted)]">{t("yourServices")}</h2>
          <div className="space-y-1.5">
            {todaysListings.length > 0 ? todaysListings.map((l) => (
              <OwnListingRow key={l.id} listing={l} />
            )) : (
              servicesEmpty
            )}
          </div>
        </section>

        {/* Bookings — compact */}
        <Link
          href="/app/calendar"
          className="flex items-center justify-between rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 transition hover:border-[var(--usha-gold)]/30"
        >
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-[var(--usha-muted)]" />
            <span className="text-sm">{t("activeBookings", { count: bookingsCount })}</span>
          </div>
          <span className="text-xs text-[var(--usha-gold)]">
            {tc("view")}
          </span>
        </Link>
      </div>
    );
  }

  /* ── Guld: functional, compact ── */
  if (isGuld) {
    return (
      <div className="px-4 py-6 space-y-6">
        {/* Header with commission badge */}
        <div>
          <h1 className="text-xl font-bold">
            {t("greeting", { name: profile?.full_name || tr("creator") })}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-xs text-[var(--usha-muted)]">{tr("creator")} · {profile?.category || "Kreativ"}</span>
            <span className="rounded-full bg-[var(--usha-gold)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--usha-gold)]">
              {t("commission", { commission })}
            </span>
          </div>
        </div>

        {onboarding}

        {/* Compact stat bar */}
        <div className="flex items-center gap-4 rounded-xl border border-[var(--usha-gold)]/20 bg-[var(--usha-gold)]/5 px-4 py-3">
          <div className="flex items-center gap-1.5">
            <DollarSign size={14} className="text-[var(--usha-gold)]" />
            <span className="text-sm font-bold">{monthlyRevenue.toLocaleString("sv-SE")} kr</span>
          </div>
          <div className="h-4 w-px bg-[var(--usha-border)]" />
          <div className="flex items-center gap-1.5">
            <Calendar size={14} className="text-[var(--usha-gold)]" />
            <span className="text-sm font-bold">{bookingsCount}</span>
          </div>
          <div className="h-4 w-px bg-[var(--usha-border)]" />
          <div className="flex items-center gap-1.5">
            <Star size={14} className="text-[var(--usha-gold)]" />
            <span className="text-sm font-bold">{averageRating != null ? `${averageRating}/5` : "—"}</span>
          </div>
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: t("newService"), href: "/app/courses", icon: Clock },
            { label: t("bookings"), href: "/app/calendar", icon: Calendar },
            { label: tc("messages"), href: "/app/messages", icon: Users },
            { label: t("statistics"), href: "/dashboard", icon: TrendingUp },
          ].map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className="flex items-center gap-2.5 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-3 text-sm font-medium transition hover:border-[var(--usha-gold)]/30"
            >
              <action.icon size={16} className="text-[var(--usha-gold)]" />
              {action.label}
            </Link>
          ))}
        </div>

        {/* Listings */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold">{t("yourServices")}</h2>
            <Link href="/app/courses" className="text-xs text-[var(--usha-gold)]">{tc("all")}</Link>
          </div>
          <div className="space-y-2">
            {todaysListings.length > 0 ? todaysListings.map((l) => (
              <OwnListingRow key={l.id} listing={l} />
            )) : (
              servicesEmpty
            )}
          </div>
        </section>

        {/* Bookings */}
        <Link
          href="/app/calendar"
          className="flex items-center justify-between rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 transition hover:border-[var(--usha-gold)]/30"
        >
          <div className="flex items-center gap-3">
            <Calendar size={16} className="text-[var(--usha-gold)]" />
            <span className="text-sm">{t("activeBookings", { count: bookingsCount })}</span>
          </div>
          <span className="rounded-lg bg-[var(--usha-gold)]/10 px-3 py-1.5 text-xs font-medium text-[var(--usha-gold)]">
            {t("calendar")}
          </span>
        </Link>
      </div>
    );
  }

  /* ── Gratis: show all features, lock premium ones ── */
  return (
    <div className="px-4 py-6 space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold">
          {t("greeting", { name: profile?.full_name || tr("creator") })} 👋
        </h1>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-xs text-[var(--usha-muted)]">{tr("creator")} · {profile?.category || "Kreativ"}</span>
          <span className="rounded-full bg-[var(--usha-muted)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--usha-muted)]">
            {t("commission", { commission })}
          </span>
        </div>
      </div>

      {onboarding}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: t("bookings"), value: String(bookingsCount), icon: Calendar },
          { label: t("revenue"), value: `${monthlyRevenue.toLocaleString("sv-SE")} kr`, icon: DollarSign },
          { label: t("rating"), value: averageRating != null ? `${averageRating}/5` : "—", icon: Star },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-[var(--usha-gold)]/20 bg-gradient-to-br from-[var(--usha-gold)]/10 to-transparent p-4"
          >
            <stat.icon size={18} className="mb-2 text-[var(--usha-gold)]" />
            <p className="text-xl font-bold">{stat.value}</p>
            <p className="text-[11px] text-[var(--usha-muted)]">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* KPI ribbon — locked for gratis */}
      <GatedAction requiredTier="premium" message={t("upgradePremiumKpi")} showLock>
        <div className="flex gap-2">
          {[
            { label: t("revenue"), value: `${monthlyRevenue.toLocaleString("sv-SE")} kr` },
            { label: t("bookings"), value: String(bookingsCount) },
            { label: t("rating"), value: averageRating != null ? `${averageRating}/5` : "—" },
            { label: t("services"), value: String(servicesCount) },
          ].map((kpi) => (
            <div key={kpi.label} className="flex-1 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-3 py-3 text-center">
              <p className="text-base font-bold leading-none">{kpi.value}</p>
              <p className="mt-1 text-[10px] text-[var(--usha-muted)]">{kpi.label}</p>
            </div>
          ))}
        </div>
      </GatedAction>

      {/* Quick actions — scan locked for gratis */}
      <div className="grid grid-cols-2 gap-2">
        <Link href="/app/courses" className="flex items-center gap-2.5 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-3 text-sm font-medium transition hover:border-[var(--usha-gold)]/30">
          <Clock size={16} className="text-[var(--usha-gold)]" />
          {t("newService")}
        </Link>
        <Link href="/app/calendar" className="flex items-center gap-2.5 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-3 text-sm font-medium transition hover:border-[var(--usha-gold)]/30">
          <Calendar size={16} className="text-[var(--usha-gold)]" />
          {t("bookings")}
        </Link>
        <GatedAction requiredTier="guld" message={t("upgradeGoldScan")} showLock>
          <div className="flex items-center gap-2.5 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-3 text-sm font-medium">
            <Camera size={16} className="text-[var(--usha-gold)]" />
            {t("scanTicket")}
          </div>
        </GatedAction>
        <Link href="/app/messages" className="flex items-center gap-2.5 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-3 text-sm font-medium transition hover:border-[var(--usha-gold)]/30">
          <Users size={16} className="text-[var(--usha-gold)]" />
          {tc("messages")}
        </Link>
      </div>

      {/* Listings */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">{t("yourServices")}</h2>
          <Link href="/app/courses" className="text-xs text-[var(--usha-gold)]">{tc("all")}</Link>
        </div>
        <div className="space-y-2">
          {todaysListings.length > 0 ? todaysListings.map((l) => (
            <OwnListingRow key={l.id} listing={l} />
          )) : (
            <p className="py-6 text-center text-sm text-[var(--usha-muted)]">{t("noServicesYet")}</p>
          )}
        </div>
      </section>

      {/* Bookings */}
      <Link
        href="/app/calendar"
        className="flex items-center justify-between rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 transition hover:border-[var(--usha-gold)]/30"
      >
        <div className="flex items-center gap-3">
          <Calendar size={16} className="text-[var(--usha-gold)]" />
          <span className="text-sm">{t("activeBookings", { count: bookingsCount })}</span>
        </div>
        <span className="rounded-lg bg-[var(--usha-gold)]/10 px-3 py-1.5 text-xs font-medium text-[var(--usha-gold)]">
          {t("calendar")}
        </span>
      </Link>

      {/* Upgrade nudge */}
      <Link
        href="/dashboard/billing"
        className="group block rounded-xl border border-[var(--usha-gold)]/20 bg-gradient-to-r from-[var(--usha-gold)]/5 to-transparent p-4 transition hover:border-[var(--usha-gold)]/40"
      >
        <div className="flex items-center gap-3">
          <Sparkles size={16} className="text-[var(--usha-gold)]" />
          <div className="flex-1">
            <p className="text-sm font-medium">{t("lowerCommission")}</p>
            <p className="text-[11px] text-[var(--usha-muted)]">{t("payingToday")}</p>
          </div>
          <ChevronRight size={14} className="text-[var(--usha-gold)]/60 transition group-hover:translate-x-1" />
        </div>
      </Link>
    </div>
  );
}

/* ─── Upplevelse (Venue/Experience) Home ─── */
function UpplevelseHome({
  hostedEventsCount = 0,
  todos = [],
  profile,
  bookingsCount,
  listings,
  ownServices = [],
  servicesCount = 0,
  monthlyRevenue = 0,
  averageRating = null,
  tier = "gratis",
  feedPosts = [],
}: {
  profile: Profile | null;
  bookingsCount: number;
  listings: Listing[];
  ownServices?: OwnListing[];
  /** Räknat i databasen — ownServices är kapad och duger inte att räkna på. */
  servicesCount?: number;
  monthlyRevenue?: number;
  averageRating?: number | null;
  tier?: string;
  feedPosts?: FeedPost[];
  hostedEventsCount?: number;
  todos?: TodoItem[];
}) {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const tr = useTranslations("roles");
  const isPremium = tier === "premium";
  const isGuld = tier === "guld";
  const commission = isPremium ? 3 : isGuld ? 8 : 15;

  // The venue's OWN events (dedicated query), not the global feed.
  const activeEvents = ownServices.filter((l) => l.is_active);
  const draftEvents = ownServices.filter((l) => !l.is_active);

  // Kommande evenemang, renderade av samma rad som kreatörsvyn: affisch, datum,
  // pris, status och en väg till hur sidan ser ut publikt.
  const upcomingEvents = ownServices.slice(0, 5);

  const userListings = ownServices.map((l) => ({ id: l.id, title: l.title }));

  const onboarding = (
    <>
      <PendingTodos items={todos} />
      {profile && (
        <ReachOut
          profileId={profile.id}
          slug={profile.slug ?? null}
          isPublic={!!profile.is_public}
          whitelabelEnabled={!!profile.whitelabel_enabled}
          shareToken={(profile as { share_token?: string | null }).share_token ?? null}
        />
      )}
      <OnboardingChecklist
      role={profile?.role ?? "venue"}
      isCompany={!!profile?.is_company}
      bio={profile?.bio}
      avatarUrl={profile?.avatar_url}
      bankidVerifiedAt={profile?.bankid_verified_at ?? null}
      companyVerifiedAt={profile?.company_verified_at ?? null}
      termsUrl={profile?.terms_url ?? null}
      servicesCount={servicesCount}
      stripeAccountId={profile?.stripe_account_id}
      stripeCardPaymentsEnabled={!!profile?.stripe_card_payments_enabled}
      isPublic={profile?.is_public}
      hostedEventsCount={hostedEventsCount}
      />
    </>
  );

  const eventsEmpty = (
    <Link
      href="/app/events/new"
      className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--usha-gold)]/40 bg-[var(--usha-gold)]/5 px-4 py-5 text-sm font-medium text-[var(--usha-gold)] transition hover:bg-[var(--usha-gold)]/10"
    >
      <Plus size={16} />
      {t("createFirstEvent")}
    </Link>
  );

  const postForm = (
    <CreatePostForm
      authorName={profile?.full_name || tr("venue")}
      authorAvatar={profile?.avatar_url || null}
      listings={userListings}
    />
  );

  /* ── Premium: ops-center ── */
  if (isPremium) {
    return (
      <div className="px-4 py-6 space-y-6">
        {/* Header — minimal */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">{profile?.full_name || tr("venue")}</h1>
            <p className="text-[11px] text-[var(--usha-muted)]">Premium · {t("commission", { commission })}</p>
          </div>
          <Link
            href="/app/scan"
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-3 py-1.5 text-xs font-bold text-black"
          >
            <Camera size={12} />
            {t("scanTicket")}
          </Link>
        </div>

        {/* Create post */}
        {postForm}

        {onboarding}

        {/* KPI ribbon */}
        <div className="flex gap-2">
          {[
            { label: t("revenue"), value: `${monthlyRevenue.toLocaleString("sv-SE")} kr` },
            { label: t("bookings"), value: String(bookingsCount) },
            { label: "Events", value: String(activeEvents.length) },
            { label: "Utkast", value: String(draftEvents.length) },
          ].map((kpi) => (
            <div key={kpi.label} className="flex-1 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-3 py-3 text-center">
              <p className="text-base font-bold leading-none">{kpi.value}</p>
              <p className="mt-1 text-[10px] text-[var(--usha-muted)]">{kpi.label}</p>
            </div>
          ))}
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: t("newEvent"), href: "/app/events", icon: Ticket },
            { label: t("scanTicket"), href: "/app/scan", icon: Camera },
            { label: tc("messages"), href: "/app/messages", icon: Users },
            { label: t("upcomingEvents"), href: "/app/events", icon: Calendar },
          ].map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className="flex items-center gap-3 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-3 text-sm font-medium transition hover:border-[var(--usha-gold)]/30"
            >
              <action.icon size={16} className="text-[var(--usha-muted)]" />
              {action.label}
            </Link>
          ))}
        </div>

        {/* Event pipeline */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-[var(--usha-muted)]">{t("eventPipeline")}</h2>
          <div className="space-y-1.5">
            {upcomingEvents.length > 0 ? upcomingEvents.map((event) => (
              <OwnListingRow key={event.id} listing={event} />
            )) : (
              eventsEmpty
            )}
          </div>
        </section>
      </div>
    );
  }

  /* ── Guld: functional dashboard ── */
  if (isGuld) {
    return (
      <div className="px-4 py-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold">{t("greeting", { name: profile?.full_name || t("greetingFallback") })}</h1>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-xs text-[var(--usha-muted)]">{tr("venue")} · {profile?.category || "Venue"}</span>
            <span className="rounded-full bg-[var(--usha-gold)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--usha-gold)]">
              {t("commission", { commission })}
            </span>
          </div>
        </div>

        {onboarding}

        {/* Compact stat bar */}
        <div className="flex items-center gap-4 rounded-xl border border-[var(--usha-gold)]/20 bg-[var(--usha-gold)]/5 px-4 py-3">
          <div className="flex items-center gap-1.5">
            <DollarSign size={14} className="text-[var(--usha-gold)]" />
            <span className="text-sm font-bold">{monthlyRevenue.toLocaleString("sv-SE")} kr</span>
          </div>
          <div className="h-4 w-px bg-[var(--usha-border)]" />
          <div className="flex items-center gap-1.5">
            <Ticket size={14} className="text-[var(--usha-gold)]" />
            <span className="text-sm font-bold">{activeEvents.length} events</span>
          </div>
          <div className="h-4 w-px bg-[var(--usha-border)]" />
          <div className="flex items-center gap-1.5">
            <Calendar size={14} className="text-[var(--usha-gold)]" />
            <span className="text-sm font-bold">{bookingsCount}</span>
          </div>
        </div>

        {/* Quick actions with scan button */}
        <div className="grid grid-cols-2 gap-2">
          <Link href="/app/scan" className="flex items-center gap-2.5 rounded-xl border border-[var(--usha-gold)]/30 bg-[var(--usha-gold)]/5 p-3 text-sm font-medium text-[var(--usha-gold)]">
            <Camera size={16} />
            {t("scanTicket")}
          </Link>
          <Link href="/app/events" className="flex items-center gap-2.5 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-3 text-sm font-medium transition hover:border-[var(--usha-gold)]/30">
            <Ticket size={16} className="text-[var(--usha-gold)]" />
            {t("upcomingEvents")}
          </Link>
        </div>

        {/* Events list */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold">{t("upcomingEvents")}</h2>
            <Link href="/app/events" className="text-xs text-[var(--usha-gold)]">{tc("manage")}</Link>
          </div>
          <div className="space-y-2">
            {upcomingEvents.length > 0 ? upcomingEvents.slice(0, 4).map((event) => (
              <OwnListingRow key={event.id} listing={event} />
            )) : (
              eventsEmpty
            )}
          </div>
        </section>
      </div>
    );
  }

  /* ── Gratis: show all features, lock premium ones ── */
  return (
    <div className="px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          {t("greeting", { name: profile?.full_name || t("greetingFallback") })} 👋
        </h1>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-xs text-[var(--usha-muted)]">{tr("venue")} · {profile?.category || "Venue"}</span>
          <span className="rounded-full bg-[var(--usha-muted)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--usha-muted)]">
            {t("commission", { commission })}
          </span>
        </div>
      </div>

      {onboarding}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: t("bookings"), value: String(bookingsCount), icon: Calendar },
          { label: t("rating"), value: averageRating != null ? `${averageRating}/5` : "—", icon: Star },
          { label: t("revenue"), value: `${monthlyRevenue.toLocaleString("sv-SE")} kr`, icon: DollarSign },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-[var(--usha-gold)]/20 bg-gradient-to-br from-[var(--usha-gold)]/10 to-transparent p-4"
          >
            <stat.icon size={18} className="mb-2 text-[var(--usha-gold)]" />
            <p className="text-xl font-bold">{stat.value}</p>
            <p className="text-[11px] text-[var(--usha-muted)]">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* KPI ribbon — locked for gratis */}
      <GatedAction requiredTier="premium" message={t("upgradePremiumKpi")} showLock>
        <div className="flex gap-2">
          {[
            { label: t("revenue"), value: `${monthlyRevenue.toLocaleString("sv-SE")} kr` },
            { label: t("bookings"), value: String(bookingsCount) },
            { label: "Events", value: String(activeEvents.length) },
            { label: "Utkast", value: String(draftEvents.length) },
          ].map((kpi) => (
            <div key={kpi.label} className="flex-1 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-3 py-3 text-center">
              <p className="text-base font-bold leading-none">{kpi.value}</p>
              <p className="mt-1 text-[10px] text-[var(--usha-muted)]">{kpi.label}</p>
            </div>
          ))}
        </div>
      </GatedAction>

      {/* Quick actions — scan locked for gratis */}
      <div className="grid grid-cols-2 gap-2">
        <Link href="/app/events" className="flex items-center gap-2.5 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-3 text-sm font-medium transition hover:border-[var(--usha-gold)]/30">
          <Ticket size={16} className="text-[var(--usha-gold)]" />
          {t("newEvent")}
        </Link>
        <GatedAction requiredTier="guld" message={t("upgradeGoldScan")} showLock>
          <div className="flex items-center gap-2.5 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-3 text-sm font-medium">
            <Camera size={16} className="text-[var(--usha-gold)]" />
            {t("scanTicket")}
          </div>
        </GatedAction>
        <Link href="/app/messages" className="flex items-center gap-2.5 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-3 text-sm font-medium transition hover:border-[var(--usha-gold)]/30">
          <Users size={16} className="text-[var(--usha-gold)]" />
          {tc("messages")}
        </Link>
        <Link href="/app/events" className="flex items-center gap-2.5 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-3 text-sm font-medium transition hover:border-[var(--usha-gold)]/30">
          <Calendar size={16} className="text-[var(--usha-gold)]" />
          {t("upcomingEvents")}
        </Link>
      </div>

      {/* Event pipeline — locked for gratis */}
      <GatedAction requiredTier="premium" message={t("upgradePremiumPipeline")} showLock>
        <section>
          <h2 className="mb-3 text-sm font-semibold text-[var(--usha-muted)]">{t("eventPipeline")}</h2>
          <div className="space-y-1.5">
            {upcomingEvents.length > 0 ? upcomingEvents.slice(0, 3).map((event) => (
              <OwnListingRow key={event.id} listing={event} />
            )) : (
              eventsEmpty
            )}
          </div>
        </section>
      </GatedAction>

      {/* Upcoming Events */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">{t("upcomingEvents")}</h2>
          <Link href="/app/events" className="text-xs text-[var(--usha-gold)]">{tc("manage")}</Link>
        </div>
        <div className="space-y-2">
          {upcomingEvents.length > 0 ? upcomingEvents.slice(0, 3).map((event) => (
              <OwnListingRow key={event.id} listing={event} />
            )) : (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--usha-border)] bg-[var(--usha-card)] py-12">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[var(--usha-gold)]/20 to-[var(--usha-accent)]/20">
                <Ticket size={24} className="text-[var(--usha-gold)]" />
              </div>
              <p className="text-sm font-medium">{t("createFirstEvent")}</p>
              <p className="mt-1 text-xs text-[var(--usha-muted)]">{t("startSellingTickets")}</p>
              <Link href="/app/events" className="mt-4 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-5 py-2 text-xs font-bold text-black">
                {t("createEvent")}
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Upgrade nudge */}
      <Link
        href="/dashboard/billing"
        className="group block rounded-xl border border-[var(--usha-gold)]/20 bg-gradient-to-r from-[var(--usha-gold)]/5 to-transparent p-4 transition hover:border-[var(--usha-gold)]/40"
      >
        <div className="flex items-center gap-3">
          <Sparkles size={16} className="text-[var(--usha-gold)]" />
          <div className="flex-1">
            <p className="text-sm font-medium">{t("lowerCommission")}</p>
            <p className="text-[11px] text-[var(--usha-muted)]">{t("payingToday")}</p>
          </div>
          <ChevronRight size={14} className="text-[var(--usha-gold)]/60 transition group-hover:translate-x-1" />
        </div>
      </Link>
    </div>
  );
}
