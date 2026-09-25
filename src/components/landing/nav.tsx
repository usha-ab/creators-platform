"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import UschjaLogo from "@/components/UschjaLogo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { createClient } from "@/lib/supabase/client";
import { Menu, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function Nav() {
  const t = useTranslations("landing");
  const ta = useTranslations("a11y");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const installPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    createClient().auth.getUser().then(({ data: { user } }) => {
      setIsLoggedIn(!!user);
    });
  }, []);

  useEffect(() => {
    if (showInstallModal) installPanelRef.current?.focus();
  }, [showInstallModal]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowInstallModal(false);
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);

  useEffect(() => {
    // PWA install state: capture the deferred install prompt (Android/Chrome),
    // detect iOS (no beforeinstallprompt — needs manual Add to Home Screen),
    // and whether we're already running as an installed app.
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) setIsInstalled(true);
    setIsIOS(/iphone|ipad|ipod/i.test(window.navigator.userAgent));

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Menyn hade åtta länkar, varav fem vände sig till någon som vill SÄLJA:
  // Kreatör, Plats, Publik, Sälj biljetter, Shop. Den som bara undrar vad som
  // händer fick leta fram Upplevelser på sjunde plats, i en grupp med Flöde och
  // Marketplace — ord som beskriver systemets delar, inte besökarens fråga.
  //
  // Nu är utgångspunkten att en besökare främst vill se vad som händer.
  // Upplevelser rymmer både kvällarna och kurserna, och är därför den enda
  // ingång som behövs i toppen. Kalendern är en vy av samma sak och nås från
  // sidan; flöde, marknadsplats och säljarsidorna bor i sidfoten, där den som
  // vill förstå ekosystemet hittar dem.
  // Menyn och sidan har olika jobb. Sidan övertalar och får ta plats; menyn
  // navigerar och finns på VARJE sida, även ett evenemang eller en profil där
  // sidans argument inte syns. Därför ligger rollvalet ("Jag är kreatör" …) på
  // startsidan som dörrar, och menyn bär bara det man ska kunna nå varifrån
  // som helst: utbudet och sitt eget konto. Om oss bor i sidfoten, där den
  // som vill veta vilka vi är letar efter den.
  //
  // Upplevelser måste ligga kvar: står du på ett evenemang är menyn den enda
  // vägen tillbaka till utbudet.
  const pageLinks = [
    { href: "/upplevelser", label: t("nav.experiences") },
  ];

  async function handleInstallClick(e: React.MouseEvent) {
    e.preventDefault();
    setMobileOpen(false);

    // Logged in or already installed — just open the app.
    if (isLoggedIn || isInstalled) {
      window.location.href = "/app";
      return;
    }

    // Android/Chrome (and desktop Chromium) — fire the native install dialog.
    if (installPrompt) {
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === "accepted") setInstallPrompt(null);
      return;
    }

    // iOS Safari and anything without a deferred prompt — show manual
    // Add-to-Home-Screen / install instructions instead of dead-ending at login.
    setShowInstallModal(true);
  }

  return (
    <>
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-[var(--usha-border)] bg-[var(--usha-black)]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a
          href={isLoggedIn ? "/app" : "/"}
          aria-label={t("nav.homeAriaLabel")}
          className="flex items-center gap-2 outline-none transition-opacity duration-150 focus:outline-none focus-visible:outline-none active:opacity-50"
        >
          <UschjaLogo size={40} />
          <span className="text-lg font-bold tracking-tight">Usha Platform</span>
        </a>

        <div className="hidden items-center gap-5 whitespace-nowrap text-sm lg:flex">
          {pageLinks.map((l) => (
            <a key={l.href} href={l.href} className="font-medium text-[var(--usha-white)] transition hover:opacity-80">
              {l.label}
            </a>
          ))}
          <button
            onClick={handleInstallClick}
            className="text-[var(--usha-white)] transition hover:text-[var(--usha-white)]"
          >
            {isLoggedIn ? t("nav.openApp") : t("nav.downloadApp")}
          </button>
          {!isLoggedIn && (
            <a
              href="/login"
              className="font-bold text-[var(--usha-white)] transition hover:opacity-80"
            >
              {t("nav.login")}
            </a>
          )}
          <ThemeToggle />
          <LanguageSwitcher />
        </div>

        <div className="flex items-center gap-3">
          <a
            href={isLoggedIn ? "/app" : "/signup"}
            className="hidden rounded-lg bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90 sm:block"
          >
            {isLoggedIn ? t("nav.openApp") : t("nav.getStarted")}
          </a>
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="ml-1 flex h-11 w-11 items-center justify-center rounded-lg text-[var(--usha-muted)] transition hover:text-[var(--usha-white)] lg:hidden"
            aria-label={t("nav.menuAriaLabel")}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-[var(--usha-border)] bg-[var(--usha-black)] px-6 py-4 lg:hidden">
          <div className="flex flex-col gap-3">
            {pageLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setMobileOpen(false)}
                className="py-2 text-base font-semibold text-[var(--usha-white)] transition hover:opacity-80"
              >
                {l.label}
              </a>
            ))}
            <div className="my-1 h-px bg-[var(--usha-border)]" />
            {!isLoggedIn && (
              <a
                href="/signup"
                onClick={() => setMobileOpen(false)}
                className="rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-4 py-2.5 text-center text-sm font-bold text-black transition hover:opacity-90"
              >
                {t("nav.getStarted")}
              </a>
            )}
            {!isLoggedIn && (
              <a
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="py-2 text-base font-bold text-[var(--usha-white)] transition hover:opacity-80"
              >
                {t("nav.login")}
              </a>
            )}
            <button
              onClick={handleInstallClick}
              className="py-2 text-left text-sm text-[var(--usha-white)] transition hover:text-[var(--usha-white)]"
            >
              {isLoggedIn ? t("nav.openApp") : t("nav.downloadApp")}
            </button>
            <div className="my-1 h-px bg-[var(--usha-border)]" />
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <LanguageSwitcher />
            </div>
          </div>
        </div>
      )}
    </nav>

    {/* Install modal — desktop */}
    {showInstallModal && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowInstallModal(false)} />
        <div
          ref={installPanelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="install-modal-title"
          tabIndex={-1}
          className="relative w-full max-w-md rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-black)] p-8 shadow-2xl"
        >
          <button
            onClick={() => setShowInstallModal(false)}
            aria-label={ta("close")}
            className="absolute right-4 top-4 rounded p-1 text-[var(--usha-muted)] transition hover:text-[var(--usha-white)]"
          >
            <X size={16} />
          </button>

          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--usha-gold)] to-[var(--usha-accent)]">
            <span className="text-xl font-bold text-black">U</span>
          </div>

          <h3 id="install-modal-title" className="mb-2 text-xl font-bold">{t("install.title")}</h3>
          <p className="mb-6 text-sm leading-relaxed text-[var(--usha-muted)]">
            {t("install.description")}
          </p>

          <div className="space-y-4">
            {isIOS ? (
              <div className="rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4">
                <p className="mb-1 text-sm font-semibold">iPhone / iPad (Safari)</p>
                <p className="text-xs text-[var(--usha-muted)]">
                  {t("install.iosHelp")}
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4">
                  <p className="mb-1 text-sm font-semibold">{t("install.chromeEdge")}</p>
                  <p className="text-xs text-[var(--usha-muted)]">
                    {t("install.chromeEdgeInstructions")}
                  </p>
                </div>

                <div className="rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4">
                  <p className="mb-1 text-sm font-semibold">{t("install.safariMac")}</p>
                  <p className="text-xs text-[var(--usha-muted)]">
                    {t("install.safariMacInstructions")}
                  </p>
                </div>

                <div className="rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4">
                  <p className="mb-1 text-sm font-semibold">Android</p>
                  <p className="text-xs text-[var(--usha-muted)]">
                    {t("install.otherHelp")}
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => setShowInstallModal(false)}
              className="flex-1 rounded-xl border border-[var(--usha-border)] py-3 text-sm font-medium text-[var(--usha-muted)] transition hover:text-[var(--usha-white)]"
            >
              {t("install.close")}
            </button>
            <a
              href={isLoggedIn ? "/app" : "/signup"}
              className="flex-1 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] py-3 text-center text-sm font-bold text-black transition hover:opacity-90"
            >
              {isLoggedIn ? t("install.openInBrowser") : t("nav.getStarted")}
            </a>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
