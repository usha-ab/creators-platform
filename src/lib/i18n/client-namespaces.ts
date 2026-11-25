/**
 * Vilka översättningsnamespace varje del av sajten skickar till klienten.
 *
 * Bakgrund: rotlayouten skickade hela språkfilen — 179 kB i 139 namespace —
 * till en NextIntlClientProvider som omsluter allt. Allt som går till en
 * provider serialiseras in i HTML:en, så 84 % av en eventsidas svar var
 * RSC-payload. En besökare som tittade på en danskväll fick texterna för
 * partnerprogrammet, kom-igång-guiden och hela dashboarden på köpet. 54 av de
 * 139 namespacen används aldrig av någon klientkomponent någonstans.
 *
 * Varför fyra listor och inte en: en nästlad NextIntlClientProvider ERSÄTTER
 * förälderns messages, den slår inte ihop dem (use-intl: `messages: undefined
 * === i ? v?.messages : i`). Varje provider måste därför bära hela
 * uppsättningen för sitt eget träd. Layouterna ligger redan så att det blir en
 * naturlig uppdelning.
 *
 * Serverkomponenter berörs inte — getTranslations() läser hela filen på
 * servern, där den aldrig skickas någonstans.
 *
 * Listorna är härledda genom att följa importkedjan från varje sid- och
 * layoutfil och läsa useTranslations() i varje "use client"-fil. De bevakas av
 * src/lib/i18n/__tests__/client-namespaces.test.ts, som gör om samma
 * genomgång och faller om en lista inte täcker vad gruppen faktiskt använder.
 * Lägg alltså inte till något här för hand utan att testet säger att det behövs.
 */

/** Rotlayouten: alla publika sidor plus rotens egna klientkomponenter. */
export const PUBLIC_NAMESPACES = [
  "a11y",
  "common",
  "connection",
  "consent",
  "creatorProfile",
  "eventPage",
  "feed",
  "instructorMinutesCard",
  "landing",
  "listingCard",
  "quickBuy",
  "roles",
  "serverNotifications",
  "signupOnboarding",
] as const;

/** src/app/app/ — den inloggade appen. */
export const APP_NAMESPACES = [
  "a11y", "account", "adminPage", "agreements", "appProfile", "bookingsPage", "calendarPage",
  "categories", "common", "connections", "courses", "entrance", "eventBookings", "eventCrew",
  "eventForm", "eventInsights", "eventLive", "eventPage", "eventStats",
  "favorites", "feed", "gagePanel", "gigsApply", "help", "home", "hostEvent",
  "invites", "joinEvent", "landing", "languageSettings", "leaderboard",
  "libraryPage", "listen", "listingCard", "matching", "messages", "myEvents",
  "myPosts", "myTickets", "nav", "notifSettings", "notifications",
  "notificationsPage", "onboarding", "openEvents", "pendingTodos", "privacySettings",
  "profile", "quickBuy",
  "reachOut", "recommendations", "recommendationsPage", "rewards", "roleToggle",
  "roles", "scanPage", "search", "security", "selfCheckin", "serverNotifications", "settings",
  "toolsPage", "trainingBuddies",
] as const;

/** src/app/(dashboard)/ — kreatörens och lokalens verktyg. */
export const DASHBOARD_NAMESPACES = [
  "a11y", "adminPage", "adminPromoForm", "adminPromoTable", "analytics",
  "bankidToast", "billingConnect", "bookingCalendar", "bookingsPage",
  "categories", "common", "companyVerify",
  "dashProfile", "gigApplicationActions", "gigForm",
  "listingCard", "listingForm", "listingsPage", "payouts", "promoCodes",
  "redeemMinutes", "reviewForm",
] as const;

/** src/app/(auth)/ — inloggning, registrering, lösenord. */
export const AUTH_NAMESPACES = ["auth", "forgotPassword", "resetPassword"] as const;

/**
 * Plocka ut de angivna namespacen. Okända hoppas tyst över — en lista som
 * nämner något som inte finns i språkfilen fångas av testet, inte här.
 */
export function pickMessages<T extends Record<string, unknown>>(
  all: T,
  namespaces: readonly string[]
): Partial<T> {
  const out: Partial<T> = {};
  for (const ns of namespaces) {
    if (ns in all) out[ns as keyof T] = all[ns as keyof T];
  }
  return out;
}
