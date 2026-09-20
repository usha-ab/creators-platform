import type { MemberRole } from "@/types/database";

export type PlanKey =
  | "publik_guld"
  | "publik_premium"
  | "kreator_guld"
  | "kreator_premium"
  | "upplevelse_guld"
  | "upplevelse_premium";

interface Plan {
  name: string;
  role: MemberRole;
  tier: "guld" | "premium";
  price: number;
  currency: string;
  interval: "month";
  description: string;
  popular?: boolean;
  features: string[];
  stripePriceId: string;
}

export const PLANS: Record<PlanKey, Plan> = {
  publik_guld: {
    name: "Guld",
    role: "customer",
    tier: "guld",
    price: 199,
    currency: "SEK",
    interval: "month",
    description: "Rabatter och tidig tillgång",
    features: [
      "10% rabatt på bokningar",
      "Tidig tillgång 48h före alla andra",
      "Prioriterad support",
      "Kalendersync",
    ],
    stripePriceId: process.env.STRIPE_PUBLIK_GULD_PRICE_ID || "",
  },
  publik_premium: {
    name: "Premium",
    role: "customer",
    tier: "premium",
    price: 499,
    currency: "SEK",
    interval: "month",
    popular: true,
    description: "VIP-upplevelse utan köer",
    features: [
      "20% rabatt på bokningar",
      "VIP — aldrig i kö",
      "Exklusivt innehåll",
      "Tidig tillgång 72h före alla andra",
      "Prioriterad support",
    ],
    stripePriceId: process.env.STRIPE_PUBLIK_PREMIUM_PRICE_ID || "",
  },
  kreator_guld: {
    name: "Guld",
    role: "creator",
    tier: "guld",
    price: 299,
    currency: "SEK",
    interval: "month",
    description: "Väx din verksamhet",
    popular: true,
    features: [
      "Upp till 15 tjänster",
      "8% kommission (istället för 15%)",
      "Egen profiladress (usha.se/dittnamn)",
      "Sälj digitalt material",
      "Skapa events",
      "Avancerad statistik",
      "Prioriterad synlighet",
    ],
    stripePriceId: process.env.STRIPE_KREATOR_GULD_PRICE_ID || "",
  },
  kreator_premium: {
    name: "Premium",
    role: "creator",
    tier: "premium",
    price: 599,
    currency: "SEK",
    interval: "month",
    description: "Full kontroll och maximal synlighet",
    features: [
      "Obegränsade tjänster",
      "3% kommission (istället för 15%)",
      "White label — egen logga & branding",
      "Egen profiladress (usha.se/dittnamn)",
      "Toppsynlighet + utvalda",
      "Facebook-sync",
      "Kalender läs + skriv",
      "Dedikerad support",
      "Statistikexport",
    ],
    stripePriceId: process.env.STRIPE_KREATOR_PREMIUM_PRICE_ID || "",
  },
  upplevelse_guld: {
    name: "Guld",
    role: "venue",
    tier: "guld",
    price: 299,
    currency: "SEK",
    interval: "month",
    description: "Väx din verksamhet",
    features: [
      "Upp till 15 events",
      "8% kommission (istället för 15%)",
      "Egen profiladress (usha.se/dittnamn)",
      "Boka kreatörer",
      "Sälj digitalt material",
      "Skapa events",
      "Avancerad statistik",
    ],
    stripePriceId: process.env.STRIPE_UPPLEVELSE_GULD_PRICE_ID || "",
  },
  upplevelse_premium: {
    name: "Premium",
    role: "venue",
    tier: "premium",
    price: 599,
    currency: "SEK",
    interval: "month",
    description: "Full kontroll och maximal synlighet",
    features: [
      "Obegränsade events",
      "3% kommission (istället för 15%)",
      "White label — egen logga & branding",
      "Egen profiladress (usha.se/dittnamn)",
      "Toppsynlighet + utvalda",
      "Facebook-sync",
      "Boka kreatörer + analys",
      "Dedikerad support",
    ],
    stripePriceId: process.env.STRIPE_UPPLEVELSE_PREMIUM_PRICE_ID || "",
  },
} as const;

export { type PlanKey as StripePlanKey };

/** Free tier definition (not a Stripe plan).
 * The default features are creator/experience-oriented (mention commission etc.).
 * For role-specific feature lists, use getGratisPlan(role) instead.
 */
export const GRATIS_PLAN = {
  name: "Gratis",
  tier: "gratis" as const,
  price: 0,
  currency: "SEK",
  description: "Perfekt för att komma igång",
  features: [
    "Skapa profil + tjänster/events (upp till 3)",
    "Synlig på marknadsplatsen",
    "15% kommission på bokningar",
    "Grundläggande statistik",
  ],
};

/** Grundarpartnerns variant av gratisplanen.
 *
 * Statusen ges till tidiga kreatörer i regioner där vi inte finns ännu. De
 * betalar självkostnad — bara Stripes avgift — och har inget tak på antal
 * utbud. Texten måste säga samma sak som verkligheten: lovar prissidan tre
 * event medan kontot tillåter nio, är det texten som är buggen.
 */
export const GRUNDARPARTNER_PLAN = {
  ...GRATIS_PLAN,
  name: "Grundarpartner",
  description: "För dig som är först på din ort",
  features: [
    "Skapa profil + obegränsat antal tjänster/events",
    "Synlig på marknadsplatsen",
    "Ingen provision – du betalar bara Stripes avgift",
    "Grundläggande statistik",
  ],
};

/** Role-aware Gratis plan. Publik doesn't pay commission and doesn't
 * create listings, so the feature list is reframed for that role.
 *
 * `foundingPartner` byter ut planen helt för kreatörer och venues — se
 * lib/partners/founding.ts för vem som har statusen.
 */
export function getGratisPlan(role: MemberRole, foundingPartner = false) {
  if (foundingPartner && role !== "customer") {
    return GRUNDARPARTNER_PLAN;
  }
  if (role === "customer") {
    return {
      ...GRATIS_PLAN,
      description: "Upptäck och boka utan kostnad",
      features: [
        "Skapa profil och logga in",
        "Bläddra i marknadsplatsen",
        "Boka utan extra avgifter",
      ],
    };
  }
  // creator/experience use the default features
  return GRATIS_PLAN;
}

/** Client-safe plan list, optionally filtered by role */
export function getPlanList(role?: MemberRole) {
  const plans = (Object.keys(PLANS) as PlanKey[]).map((key) => ({
    key,
    name: PLANS[key].name,
    role: PLANS[key].role,
    tier: PLANS[key].tier,
    price: PLANS[key].price,
    description: PLANS[key].description,
    features: PLANS[key].features,
    popular: PLANS[key].popular ?? false,
  }));

  if (role) {
    return plans.filter((p) => p.role === role);
  }
  return plans;
}

/** Legacy alias for backwards compatibility */
export const PLAN_LIST = getPlanList();
