import type { MetadataRoute } from "next";

/**
 * OBS: ?ref= och ?utm_ blockeras INTE här, trots att de pekar på sidor som
 * redan finns i sitemapen. En partnerlänk delas på Facebook, och Facebooks
 * crawler respekterar robots.txt — blockeras adressen får inlägget ingen
 * förhandsvisning, vilket vore att sabotera partnerprogrammet för att spara
 * crawlbudget. Dubbletterna löses i stället av canonical, som sedan #340 finns
 * på varje indexerbar sida och pekar på adressen utan parametrar.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Private/app surfaces that hold no indexable public content.
        disallow: [
          "/app/",
          "/api/",
          "/dashboard/",
          "/callback",
          "/offline",
          // Kvitton, engångslänkar och avregistreringar. De har noindex i sina
          // egna metadata också; det här sparar crawlbudget.
          "/biljett/",
          "/folj/",
          "/waitlist/",
          "/data-deletion/",
          "/onboarding",
        ],
      },
    ],
    sitemap: "https://usha.se/sitemap.xml",
    host: "https://usha.se",
  };
}
