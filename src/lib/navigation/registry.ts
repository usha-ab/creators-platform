// Ett register över appens destinationer.
//
// Varje meny i appen hade tidigare sin egen hårdkodade lista: flikraden,
// sidomenyn på desktop, Mer-griden, profilmenyn, settings-hubben och
// knappraden på eventsidan. Ingen av dem visste om de andra, så en ny sida
// blev osynlig om man glömde en av listorna — och det hände upprepade gånger:
// Kopplingar, Login & säkerhet, bokningsvyn. Sidomenyn och Mer-griden hade
// dessutom drivit isär, så vad som gick att nå berodde på skärmbredden.
//
// Här deklareras varje destination EN gång. Menyerna renderar ur registret,
// och coverage-testet failar om en sida under /app eller /dashboard varken
// står här eller är listad som kontextuell. Att glömma en meny är därmed inte
// längre möjligt utan att bygget säger ifrån.

import type { LucideIcon } from "lucide-react";
import { hasCapability, type AdminAccess, type AdminRequirement } from "@/lib/admin/capabilities";
import {
  Package, CalendarCheck, CalendarDays, ScanLine, Briefcase, BookOpen, Building2,
  Wallet, BarChart3, CreditCard, Tag, Search, Store, FileText, Heart, Trophy,
  ShoppingBag, Ticket, MessageCircle, BookMarked, Gift, Bell, User, Settings,
  Users, Home, Sparkles, Box, LayoutGrid, KeyRound, Languages, Layers } from "lucide-react";

/** Kanoniska roller. Se roll-modellen: creator/venue säljer, customer köper. */
export type NavRole = "customer" | "creator" | "venue";

/**
 * Ytor en destination kan visas på.
 * - `sidebar`: sidomenyn på desktop
 * - `more`: Mer-griden (mobil)
 * - `sell`: Utbud-sidan, samlingen av allt man kan sälja
 * Profilmenyn och settings-hubben är små och handredigerade, men deras sidor
 * måste ändå stå i registret för att passera coverage-testet.
 */
export type NavSurface = "sidebar" | "more" | "profile" | "settings" | "sell";

export type NavGroup =
  | "createSell"
  | "finance"
  | "explore"
  | "myAccount";

export interface AppDestination {
  /** Rutt som den ser ut i URL:en. Måste matcha en page.tsx om external saknas. */
  path: string;
  /**
   * Lång etikett + beskrivning, nycklar i toolsPage-namespacet. Krävs bara för
   * destinationer som renderas i Mer-griden eller sidomenyn — settings- och
   * profilraderna har egna etiketter i sina respektive namespace och står här
   * enbart för att coverage-testet ska se dem.
   */
  labelKey?: string;
  descKey?: string;
  /** Kort etikett för sidomenyn, nyckel i nav-namespacet. */
  navLabelKey?: string;
  icon: LucideIcon;
  group: NavGroup;
  /** "all" = alla roller. Annars de roller som ser destinationen. */
  roles: NavRole[] | "all";
  surfaces: NavSurface[];
  /** Ligger utanför appen (annan domän eller publik sajt). */
  external?: boolean;
}

export const APP_DESTINATIONS: AppDestination[] = [
  // ---- Skapa & sälj -------------------------------------------------------
  { path: "/app", labelKey: "homeLabel", navLabelKey: "home", icon: Home,
    group: "createSell", roles: "all", surfaces: ["sidebar"] },
  // Utbud: en ingång i stället för fem. Tjänster, Produkter, Kurser och de två
  // gig-sidorna låg som jämlikar i menyerna trots att tre av dem inte hade en
  // enda rad i databasen och Tjänster visade exakt samma lista som Evenemang.
  // Fem nästan lika menyrader tvingar en att veta vad man ska kalla det man
  // säljer innan man börjat. Ett klick till, och sidan säger vad var sak är.
  { path: "/app/sell", labelKey: "sellLabel", descKey: "sellDesc", navLabelKey: "sell", icon: Layers,
    group: "createSell", roles: ["creator", "venue"], surfaces: ["more", "sidebar"] },
  // Evenemang ligger kvar i sidomenyn OCH på Utbud. Det är det enda av utbudet
  // som används dagligen och den enda tabellen med riktig data — att lägga det
  // bakom ett extra klick vore att göra vanligast till krångligast.
  { path: "/app/events", labelKey: "eventsLabel", descKey: "eventsDesc", navLabelKey: "events", icon: Building2,
    group: "createSell", roles: ["creator", "venue"], surfaces: ["more", "sidebar", "sell"] },
  { path: "/app/courses", labelKey: "coursesLabel", descKey: "coursesDesc", navLabelKey: "content", icon: BookOpen,
    group: "createSell", roles: ["creator", "venue"], surfaces: ["sell"] },
  { path: "/dashboard/products", labelKey: "productsLabel", descKey: "productsDesc", icon: Box,
    group: "createSell", roles: ["creator", "venue"], surfaces: ["sell"] },
  { path: "/dashboard/listings", labelKey: "servicesLabel", descKey: "servicesDesc", icon: Package,
    group: "createSell", roles: ["creator", "venue"], surfaces: ["sell"] },
  // Uppdragsmarknaden har två sidor: lokalen lägger ut, kreatören söker. De låg
  // som två menyrader med olika namn under olika prefix, så vilken sida av
  // marknaden man såg berodde på vilken roll man råkade ha. Samma etikett nu,
  // en ruta på Utbud, och rollen avgör vart den leder — det är samma marknad.
  { path: "/dashboard/gigs", labelKey: "gigsLabel", descKey: "gigsDesc", icon: Briefcase,
    group: "createSell", roles: ["venue"], surfaces: ["sell"] },
  { path: "/app/gigs", labelKey: "openGigsLabel", descKey: "openGigsDesc", icon: Briefcase,
    group: "createSell", roles: ["creator"], surfaces: ["sell"] },
  // I sidomenyn: vilka som kommer i kväll är en daglig fråga för den som håller
  // event, inte något man letar upp i en verktygslåda.
  { path: "/dashboard/bookings", labelKey: "bookingsLabel", descKey: "bookingsDesc",
    navLabelKey: "bookings", icon: CalendarCheck,
    group: "createSell", roles: ["creator", "venue"], surfaces: ["more", "sidebar"] },
  { path: "/app/calendar", labelKey: "calendarLabel", descKey: "calendarDesc", navLabelKey: "calendar", icon: CalendarDays,
    group: "createSell", roles: "all", surfaces: ["more", "sidebar"] },
  { path: "/app/scan", labelKey: "scanLabel", descKey: "scanDesc", navLabelKey: "scan", icon: ScanLine,
    group: "createSell", roles: ["creator", "venue"], surfaces: ["more", "sidebar"] },
  // Bara lokaler: arrangörer som vill koppla sitt evenemang hit. Utan en yta att
  // svara på blir kopplingen aldrig bekräftad, och då når den ingen.
  // Ligger även i sidomenyn: det här är lokalens inkorg, inte ett verktyg. Låg
  // den bara i Mer-griden fanns den inte alls på desktop utom via "Verktyg", och
  // Bacchis första lokalvärd letade förgäves efter den i menyn.
  { path: "/app/venue-requests", labelKey: "venueRequestsLabel", descKey: "venueRequestsDesc",
    navLabelKey: "venueRequests", icon: Building2,
    group: "createSell", roles: ["venue"], surfaces: ["more", "sidebar"] },
  // Bara lokaler: teamet. Ägaren delar ut behörigheter härifrån.
  { path: "/app/venue-team", labelKey: "venueTeamLabel", descKey: "venueTeamDesc", icon: Users,
    group: "createSell", roles: ["venue"], surfaces: ["more"] },

  // ---- Ekonomi ------------------------------------------------------------
  // I sidomenyn: "var är mina pengar" är den fråga folk letar efter först och
  // tålmodigast med. Den ska inte ligga bakom en generisk etikett.
  { path: "/dashboard/payouts", labelKey: "payoutsLabel", descKey: "payoutsDesc",
    navLabelKey: "payouts", icon: Wallet,
    group: "finance", roles: ["creator", "venue"], surfaces: ["more", "sidebar"] },
  { path: "/dashboard/analytics", labelKey: "analyticsLabel", descKey: "analyticsDesc", icon: BarChart3,
    group: "finance", roles: ["creator", "venue"], surfaces: ["more"] },
  { path: "/dashboard/billing", labelKey: "billingLabel", descKey: "billingDesc", icon: CreditCard,
    group: "finance", roles: "all", surfaces: ["more"] },
  // Partnerprogrammet: alla kan värva, så raden ligger hos alla roller.
  { path: "/app/partner", labelKey: "partnerLabel", descKey: "partnerDesc", navLabelKey: "partner", icon: Gift,
    group: "finance", roles: "all", surfaces: ["more"] },
  { path: "/dashboard/promo-codes", labelKey: "promoCodesLabel", descKey: "promoCodesDesc", icon: Tag,
    group: "finance", roles: ["creator", "venue"], surfaces: ["more"] },

  // ---- Utforska -----------------------------------------------------------
  { path: "/app/search", labelKey: "searchLabel", descKey: "searchDesc", icon: Search,
    group: "explore", roles: "all", surfaces: ["more"] },
  { path: "/app/recommendations", labelKey: "recommendationsLabel", descKey: "recommendationsDesc", icon: Sparkles,
    group: "explore", roles: "all", surfaces: ["more"] },
  { path: "/app/training-buddies", labelKey: "trainingBuddiesLabel", descKey: "trainingBuddiesDesc", navLabelKey: "buddies", icon: Users,
    group: "explore", roles: "all", surfaces: ["more", "sidebar"] },
  { path: "/marketplace", labelKey: "marketplaceLabel", descKey: "marketplaceDesc", icon: Store,
    group: "explore", roles: "all", surfaces: ["more"], external: true },
  { path: "https://shop.usha.se", labelKey: "shopLabel", descKey: "shopDesc", icon: ShoppingBag,
    group: "explore", roles: "all", surfaces: ["more"], external: true },
  { path: "/app/posts", labelKey: "feedLabel", descKey: "feedDesc", navLabelKey: "myPosts", icon: FileText,
    group: "explore", roles: "all", surfaces: ["more", "sidebar"] },
  { path: "/app/favorites", labelKey: "favoritesLabel", descKey: "favoritesDesc", navLabelKey: "favorites", icon: Heart,
    group: "explore", roles: "all", surfaces: ["more", "sidebar"] },
  { path: "/app/leaderboard", labelKey: "leaderboardLabel", descKey: "leaderboardDesc", navLabelKey: "leaderboard", icon: Trophy,
    group: "explore", roles: "all", surfaces: ["more", "sidebar"] },

  // ---- Mitt konto ---------------------------------------------------------
  { path: "/app/tickets", labelKey: "ticketsLabel", descKey: "ticketsDesc", navLabelKey: "tickets", icon: Ticket,
    group: "myAccount", roles: "all", surfaces: ["more", "sidebar"] },
  { path: "/app/my-collaborations", labelKey: "collaborationsLabel", descKey: "collaborationsDesc", icon: Users,
    group: "myAccount", roles: "all", surfaces: ["more"] },
  { path: "/app/messages", labelKey: "messagesLabel", navLabelKey: "messages", icon: MessageCircle,
    group: "myAccount", roles: "all", surfaces: ["more", "sidebar"] },
  { path: "/app/library", labelKey: "libraryLabel", descKey: "libraryDesc", navLabelKey: "library", icon: BookMarked,
    group: "myAccount", roles: "all", surfaces: ["more", "sidebar"] },
  { path: "/app/rewards", labelKey: "rewardsLabel", descKey: "rewardsDesc", icon: Gift,
    group: "myAccount", roles: "all", surfaces: ["more", "profile"] },
  { path: "/app/notifications", labelKey: "notificationsLabel", icon: Bell,
    group: "myAccount", roles: "all", surfaces: ["more"] },
  { path: "/app/profile", labelKey: "profileLabel", navLabelKey: "profile", icon: User,
    group: "myAccount", roles: "all", surfaces: ["more", "sidebar"] },
  { path: "/app/settings", labelKey: "settingsLabel", icon: Settings,
    group: "myAccount", roles: "all", surfaces: ["more"] },
  // Mer-griden själv måste finnas i sidomenyn. Utan den vägen är allt som bara
  // ligger i griden omöjligt att nå på desktop, eftersom flikraden är md:hidden.
  { path: "/app/tools", labelKey: "toolsLabel", navLabelKey: "tools", icon: LayoutGrid,
    group: "myAccount", roles: "all", surfaces: ["sidebar"] },
  { path: "/app/settings/language", icon: Languages,
    group: "myAccount", roles: "all", surfaces: ["settings"] },
  { path: "/app/settings/connections", icon: Settings,
    group: "myAccount", roles: "all", surfaces: ["settings", "profile"] },
  { path: "/app/settings/security", icon: Settings,
    group: "myAccount", roles: "all", surfaces: ["settings", "profile"] },
  { path: "/app/settings/notifications", icon: Bell,
    group: "myAccount", roles: "all", surfaces: ["settings", "profile"] },
  { path: "/app/settings/privacy", icon: Settings,
    group: "myAccount", roles: "all", surfaces: ["settings", "profile"] },
  { path: "/app/settings/help", icon: Settings,
    group: "myAccount", roles: "all", surfaces: ["settings", "profile"] },
  { path: "/app/settings/account", icon: Settings,
    group: "myAccount", roles: "all", surfaces: ["settings"] },
];

/**
 * Sidor som medvetet saknar menyingång, med skälet. De nås från ett objekt
 * eller mitt i ett flöde, och skulle vara meningslösa i en meny eftersom de
 * kräver ett id eller ett pågående ärende.
 *
 * Står en sida här är den granskad och avsiktlig — inte bortglömd. Det är
 * skillnaden mot en föräldralös sida.
 */
/**
 * Adminverktygen står för sig själva.
 *
 * De kan inte ligga i APP_DESTINATIONS: en rad där måste tilldelas en roll, och
 * rollerna är creator/venue/customer — så ingången skulle visas för varje
 * säljare och sedan bara skicka dem till /dashboard av sidans egen grind. Här
 * styr i stället is_admin, och menyerna renderar den här listan bara för den
 * som faktiskt är admin.
 *
 * Sidorna bakom kräver ändå sin egen isAdminById-kontroll. Att utelämna en
 * länk är att städa menyn, inte att skydda något.
 */
export interface AdminDestination {
  /** Rutt som den ser ut i URL:en. Måste matcha en page.tsx. */
  path: string;
  /** Etikett + beskrivning, nycklar i adminPage-namespacet. */
  labelKey: string;
  descKey: string;
  icon: LucideIcon;
  /**
   * Vad som krävs för att öppna verktyget. En kapacitet går att delegera till
   * en partner; "full" gör det inte — det betyder hel admin. Menyn och sidan
   * läser samma fält, så ett verktyg kan inte synas för någon som ändå vänds
   * bort av grinden.
   */
  requires: AdminRequirement;
}

/** Navet som adminverktygen hänger under. */
export const ADMIN_ROOT = "/dashboard/admin";

export const ADMIN_DESTINATIONS: AdminDestination[] = [
  { path: "/dashboard/admin/creators", labelKey: "creatorsLabel", descKey: "creatorsDesc", icon: Users,
    requires: "creators" },
  { path: "/dashboard/admin/promo", labelKey: "promoLabel", descKey: "promoDesc", icon: Tag,
    requires: "promo" },
  { path: "/dashboard/admin/partners", labelKey: "partnersLabel", descKey: "partnersDesc", icon: Gift,
    requires: "partners" },
  // Att dela ut behörighet går inte att delegera: en partner som kan bredda sin
  // egen behörighet har i praktiken ingen begränsning.
  { path: "/dashboard/admin/access", labelKey: "accessLabel", descKey: "accessDesc", icon: KeyRound,
    requires: "full" },
];

/** Verktygen den här personen faktiskt kan öppna, i registrets ordning. */
export function adminDestinationsFor(access: AdminAccess): AdminDestination[] {
  return ADMIN_DESTINATIONS.filter((d) => hasCapability(access, d.requires));
}

export const CONTEXTUAL_ROUTES: Record<string, string> = {
  "/dashboard": "Omdirigerar bara vidare till /app.",
  "/app/venue-team/join/[token]": "Nås enbart via inbjudningslänken från lokalens ägare. Ska INTE finnas i någon meny — den som hittar den utan inbjudan har ingen inbjudan att acceptera.",
  "/app/lyssna": "Privat verktyg under utbrytning till egen app. Nås via direktlänk och är grindad i sidan (se lib/tts/access.ts) — den ska inte synas i menyerna.",
  "/app/events/[id]/bookings": "Nås från knappraden på eventsidan.",
  "/app/events/[id]/edit": "Nås genom att öppna ett event i listan.",
  "/app/events/[id]/crew": "Nås från knappraden på eventsidan.",
  "/app/events/[id]/live": "Nås från knappraden på eventsidan.",
  "/app/events/[id]/waitlist": "Nås från knappraden på eventsidan.",
  "/app/events/[id]/stats": "Nås från knappraden på eventsidan.",
  "/app/events/[id]/settlement": "Nås från knappraden på eventsidan.",
  "/app/events/[id]/broadcast": "Nås från väntelistan på eventsidan.",
  "/app/events/[id]/codes": "Nås från eventsidan.",
  "/app/events/[id]/entre": "Nås från knappraden på eventsidan; öppnas av den som står i dörren.",
  "/app/events/new": "Nås från Skapa-knappen i eventlistan.",
  "/app/events/open": "Nås från eventlistan.",
  "/app/events/insights": "Statistik för egna event — nås från Statistik-länken i eventlistans huvud. Det är en underrutt till Evenemang, inte en jämlike i menyn.",
  "/app/events/select-page": "Nås mitt i Facebook-inloggningen när kontot har flera sidor.",
  "/app/invites/[token]": "Nås via inbjudningslänk i mejl.",
  "/dashboard/listings/new": "Nås från tjänstelistan.",
  "/dashboard/listings/[id]/edit": "Nås genom att öppna en tjänst.",
  "/dashboard/gigs/new": "Nås från gig-listan, som i sin tur nås från Utbud.",
  "/dashboard/gigs/[id]": "Nås genom att öppna ett gig.",
  "/dashboard/admin/promo/new": "Nås från Ny kod-knappen i rabattkodslistan.",
  "/dashboard/profile": "Redigera profil — nås från profilmenyn.",
};

function roleMatches(dest: AppDestination, role: NavRole): boolean {
  return dest.roles === "all" || dest.roles.includes(role);
}

/** Destinationer för en roll på en given yta, i registrets ordning. */
export function destinationsFor(
  role: NavRole,
  surface: NavSurface,
  /**
   * Sidor som ska med oavsett roll, för att personen fått en behörighet som
   * låser upp dem. En teammedlem hos en lokal kan ha rollen customer men sköta
   * lokalens sida — utan det här hittar hen aldrig dit, och behörigheten blir en
   * kryssruta utan verkan.
   *
   * Undantaget är avsiktligt smalt: enskilda sökvägar, inte en andra
   * behörighetsmodell i navigationen.
   */
  extraPaths: readonly string[] = []
): AppDestination[] {
  return APP_DESTINATIONS.filter(
    (d) =>
      d.surfaces.includes(surface) &&
      (roleMatches(d, role) || extraPaths.includes(d.path))
  );
}

/** Samma, men grupperad — för Mer-griden. */
export function groupedDestinationsFor(
  role: NavRole,
  surface: NavSurface,
  extraPaths: readonly string[] = []
): { group: NavGroup; items: AppDestination[] }[] {
  const order: NavGroup[] = ["createSell", "finance", "explore", "myAccount"];
  return order
    .map((group) => ({
      group,
      items: destinationsFor(role, surface, extraPaths).filter((d) => d.group === group),
    }))
    .filter((g) => g.items.length > 0);
}
