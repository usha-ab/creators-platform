const createNextIntlPlugin = require('next-intl/plugin');
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Usha Games (Skuggspelet) bor på en egen domän sedan 2026-10-27: ushagames.se,
// en Cloudflare Worker. usha.se/spel och usha.se/games skickar vidare dit, så att
// gamla länkar och QR-koder fortsätter fungera. Repo: usha-ab/skuggspelet.
const USHA_GAMES_ORIGIN = process.env.USHA_GAMES_ORIGIN || "https://ushagames.se";

// Cookies och parametrar som gör ett svar personligt eller sätter cookies.
// Auth-cookien heter sb-<projekt>-auth-token (låst i #491). En stor session
// chunkas till .0, .1 … och har då ALLTID en .0-del, så basnamnet + .0 räcker
// för att fånga varje session; .1 är hängslen. PKCE-verifieraren följer samma
// prefix. Vercel tillåter högst 16 villkor per regel (deploy #531 föll på 21).
const SUPABASE_AUTH_COOKIE = "sb-hiurrvorwqfihtdfhbhv-auth-token";
const ANON_CACHE_MISSING = [
  ...["", ".0", ".1"].map((s) => ({ type: "cookie", key: `${SUPABASE_AUTH_COOKIE}${s}` })),
  { type: "cookie", key: `${SUPABASE_AUTH_COOKIE}-code-verifier` },
  { type: "cookie", key: "usha-theme" },
  { type: "query", key: "ref" },
  { type: "query", key: "lang" },
  ...["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].map((k) => ({ type: "query", key: k })),
];
if (ANON_CACHE_MISSING.length > 16) throw new Error("Vercel tillåter högst 16 has/missing-villkor per regel");

// Förhandsbygge mot produktionsdatabasen stoppas när grenar per PR är på (supabase/BRANCHING.md).
const previewFel = require("./scripts/db/preview-vakt.cjs").previewVakt(process.env);
if (previewFel) throw new Error(previewFel);

/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // Kort adress till registreringen, för ytor där en query-sträng inte går
      // att läsa: projicerad på en vägg, uppläst i en story, tryckt på ett
      // flygblad. "usha.se/signup?role=customer" fungerar men går inte att säga
      // högt.
      //
      // permanent: false (307) med flit. En 308 cachas av webbläsaren i
      // praktiken för alltid, och den här adressen ska kunna peka någon
      // annanstans den dag välkomstavdraget ändras eller tas bort — annars
      // sitter besökare fast på ett erbjudande som inte finns.
      //
      // Redirects körs före routingen, så /join vinner över [slug] (kreatörernas
      // egna adresser) utan att någon av dem behöver veta om den andra.
      // Medvärdar skriver "samarbeten" — sidan heter my-collaborations.
      { source: "/app/samarbeten", destination: "/app/my-collaborations", permanent: false },
      { source: "/samarbeten", destination: "/app/my-collaborations", permanent: false },
      { source: "/join", destination: "/signup?role=customer", permanent: false },
      { source: "/konto", destination: "/signup?role=customer", permanent: false },
      { source: "/konto/insta", destination: "/signup?role=customer&utm_source=instagram&utm_medium=social&utm_campaign=konto&utm_content=reel", permanent: false },
      { source: "/konto/chatt", destination: "/signup?role=customer&utm_source=chatt&utm_medium=dm&utm_campaign=konto", permanent: false },
      // Korta rekryteringslänkar för reels och chattar. Kanalen (UTM) följer med
      // i omdirigeringen och fångas av middlewaren på målsidan, så länken som
      // delas kan vara kort och snygg. Värdena följer docs/utm-rutin.md i
      // usha-marknadsforing.
      { source: "/taxi/insta", destination: "/taxi?utm_source=instagram&utm_medium=social&utm_campaign=taxidansare&utm_content=reel", permanent: false },
      { source: "/taxi/chatt", destination: "/taxi?utm_source=chatt&utm_medium=dm&utm_campaign=taxidansare", permanent: false },
      { source: "/undervisa/insta", destination: "/undervisa?utm_source=instagram&utm_medium=social&utm_campaign=instruktor&utm_content=reel", permanent: false },
      { source: "/undervisa/chatt", destination: "/undervisa?utm_source=chatt&utm_medium=dm&utm_campaign=instruktor", permanent: false },
      // Lokaler kallar sig lokaler, inte platser: "usha.se/for-lokaler" ska
      // fungera när någon säger det högt. Utan regeln tolkades den som en
      // kreatörsadress ([slug]) och gav 404.
      { source: "/for-lokaler", destination: "/for-platser", permanent: false },
      // Jämförelsen med Tickster och Billetto: "usha.se/vs" går att säga högt.
      { source: "/vs", destination: "/jamfor", permanent: false },
      { source: "/vs/insta", destination: "/jamfor?utm_source=instagram&utm_medium=social&utm_campaign=jamfor&utm_content=reel", permanent: false },
      // Dörren: kioskläget för kvällens evenemang (sidan /dorr väljer kvällen).
      { source: "/kiosk", destination: "/dorr", permanent: false },
      // The Lab: alltid nästa torsdag (/event/the-lab-torsdag följer serien).
      { source: "/thelab", destination: "/event/the-lab-torsdag", permanent: false },
      { source: "/thelab/insta", destination: "/event/the-lab-torsdag?utm_source=instagram&utm_medium=social&utm_campaign=thelab&utm_content=reel", permanent: false },
      // Tyck till: DJ-röstningen och enkäterna. Hashen följer med till sidan.
      { source: "/dj", destination: "/tyck-till#dj", permanent: false },
      { source: "/tyck", destination: "/tyck-till", permanent: false },
      { source: "/thelab/chatt", destination: "/event/the-lab-torsdag?utm_source=chatt&utm_medium=dm&utm_campaign=thelab", permanent: false },
      // Spelen har flyttat till ushagames.se. Query-strängen (t.ex. ?vuxen eller
      // ?kod=) följer med. Redirects körs före sidorna, så /spel tolkas aldrig som
      // en kreatörs adress ([slug]). 307 av samma skäl som ovan.
      { source: "/spel", destination: `${USHA_GAMES_ORIGIN}/spel/`, permanent: false },
      { source: "/spel/:path*", destination: `${USHA_GAMES_ORIGIN}/spel/:path*`, permanent: false },
      { source: "/games", destination: `${USHA_GAMES_ORIGIN}/spel/`, permanent: false },
      { source: "/games/:path*", destination: `${USHA_GAMES_ORIGIN}/spel/:path*`, permanent: false },
    ];
  },
  async headers() {
    return [
      // Edge-cache för utloggade (regeln i src/lib/cache/public-pages.ts).
      // Direktivet måste sitta på funktionens eget svar: satt från middleware
      // nådde det aldrig CDN:ens bedömning (allt blev MISS). Men headers-regler
      // utvärderas mot den URSPRUNGLIGA adressen, före middlewarens omskrivning
      // till ?_anon=<språk>, så villkoren upprepas här: inga auth-cookies,
      // inget valt tema, inga parametrar som sätter cookies. Middleware skriver
      // om exakt samma anrop, så den cachade posten har alltid språket i
      // nyckeln. Next skriver över Cache-Control för dynamiska sidor men
      // lämnar CDN-namnen ifred. Håll i synk med CACHEABLE_PATHS/decidePublicCache.
      ...["/", "/(upplevelser|kalender|instruktorer|taxidansare|for-kreatorer|for-platser|for-publik|om|platser|guide|insta)"].map(
        (source) => ({
          source,
          missing: ANON_CACHE_MISSING,
          headers: [
            { key: "Vercel-CDN-Cache-Control", value: "s-maxage=60, stale-while-revalidate=600" },
            { key: "CDN-Cache-Control", value: "s-maxage=60, stale-while-revalidate=600" },
          ],
        })
      ),
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "https://usha.se" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
          { key: "Access-Control-Max-Age", value: "86400" },
          // API responses are per-user/authenticated — never let a shared or
          // browser cache store them (the framework default was
          // "public, max-age=0, must-revalidate", which served stale balances
          // and could serve one user's data to another).
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Reporting endpoint for the Report-Only CSP below (modern Reporting API).
          { key: "Reporting-Endpoints", value: 'csp-endpoint="https://usha.se/api/csp-report"' },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(self), payment=(self), interest-cohort=()",
          },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com https://*.signicat.com https://usha-ab.app.signicat.com",
          },
          {
            // Full policy in Report-Only first — monitor for violations, then
            // promote to an enforced Content-Security-Policy.
            key: "Content-Security-Policy-Report-Only",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://maps.googleapis.com https://js.stripe.com https://va.vercel-scripts.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com data:",
              "img-src 'self' data: blob: https://*.supabase.co https://auth.usha.se https://images.unsplash.com https://*.cdninstagram.com https://*.fbcdn.net https://*.tiktokcdn.com https://www.googletagmanager.com https://*.googleapis.com https://*.gstatic.com https://*.google-analytics.com",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://auth.usha.se wss://auth.usha.se https://maps.googleapis.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://api.stripe.com https://api.signicat.com https://vitals.vercel-insights.com",
              "frame-src 'self' https://js.stripe.com https://checkout.stripe.com https://*.signicat.com",
              "media-src 'self'",
              "worker-src 'self' blob:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self' https://checkout.stripe.com https://*.signicat.com https://usha-ab.app.signicat.com",
              // Collect violations so we can review before promoting to enforced.
              // report-uri = legacy/broadest support; report-to = modern Reporting API.
              "report-uri /api/csp-report",
              "report-to csp-endpoint",
            ].join("; "),
          },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
      {
        // Supabase via egen domän (Custom Domain) — samma lagring, ny adress.
        protocol: "https",
        hostname: "auth.usha.se",
      },
      {
        // Google-inloggade kreatörers profilbilder (profiles.avatar_url).
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        // Reservbilden på eventsidan när annonsen saknar egen bild.
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "**.cdninstagram.com",
      },
      {
        protocol: "https",
        hostname: "**.fbcdn.net",
      },
      {
        protocol: "https",
        hostname: "**.tiktokcdn.com",
      },
    ],
  },
};

let exported = withNextIntl(nextConfig);

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  const { withSentryConfig } = require("@sentry/nextjs");
  exported = withSentryConfig(exported, {
    silent: true,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    widenClientFileUpload: true,
    tunnelRoute: "/monitoring",
    disableLogger: true,
    automaticVercelMonitors: false,
  });
}

module.exports = exported;
