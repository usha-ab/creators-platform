import { useTranslations } from "next-intl";
import { FollowUs } from "@/components/follow-us";

/** Shared site footer for the home page and perspective pages. */
export function Footer() {
  const t = useTranslations("landing");

  // Sidfoten bär det toppmenyn inte längre gör. Menyn har en enda ingång till
  // utbudet; den som vill förstå ekosystemet, sälja biljetter eller handla i
  // shoppen hittar det här i stället.
  const FOOTER_LINKS = {
    [t("footer.discover")]: [
      { label: t("nav.experiences"), href: "/upplevelser" },
      { label: t("nav.calendar"), href: "/kalender" },
      { label: t("footer.marketplace"), href: "/marketplace" },
      { label: t("nav.feed"), href: "/flode" },
    ],
    [t("footer.platform")]: [
      { label: t("nav.forCreators"), href: "/for-kreatorer" },
      { label: t("nav.forVenues"), href: "/for-platser" },
      { label: t("nav.forAudience"), href: "/for-publik" },
      { label: t("nav.sellTickets"), href: "/salj-biljetter" },
      { label: t("nav.shop"), href: "https://shop.usha.se" },
      { label: t("footer.about"), href: "/om" },
      { label: t("footer.partner"), href: "/partner" },
    ],
    [t("footer.legal")]: [
      { label: t("footer.terms"), href: "/terms" },
      { label: t("footer.privacy"), href: "/privacy" },
      { label: t("footer.cookies"), href: "/cookies" },
    ],
  };

  return (
    <footer className="border-t border-[var(--usha-border)] pt-12 pb-8 px-4 sm:pt-16 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--usha-gold)] to-[var(--usha-accent)]">
                <span className="text-sm font-bold text-black">U</span>
              </div>
              <span className="text-lg font-bold tracking-tight">Usha Platform</span>
            </div>
            <p className="max-w-xs text-sm leading-relaxed text-[var(--usha-muted)]">
              {t("footer.description")}
            </p>
            <FollowUs className="mt-5" />
          </div>

          {Object.entries(FOOTER_LINKS).map(([title, links]) => (
            <div key={title}>
              <h4 className="mb-4 text-sm font-semibold">{title}</h4>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-sm text-[var(--usha-muted)] transition-colors hover:text-[var(--usha-white)]"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center justify-between gap-4 border-t border-[var(--usha-border)] pt-8 sm:flex-row">
          <p className="font-mono text-xs text-[var(--usha-muted)]">{t("footer.copyright")}</p>
          <p className="text-xs text-[var(--usha-muted)]">{t("footer.builtWith")}</p>
        </div>
      </div>
    </footer>
  );
}
