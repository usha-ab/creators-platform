"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Home,
  Ticket,
  BookOpen,
  User,
  Building2,
  MessageCircle,
  ScanLine,
  FileText,
  BookMarked,
  Trophy,
  CalendarDays,
  ShoppingBag,
  Flame,
} from "lucide-react";
import { useRole } from "./role-context";
import { useSubscription } from "@/lib/subscription/context";
import { BASTU_URL, isBastuLinkVisible } from "@/lib/bastu";
import { LanguageSwitcher } from "@/components/language-switcher";
import UschjaLogo from "@/components/UschjaLogo";

export function SidebarNav() {
  const pathname = usePathname();
  const { role } = useRole();
  const { tier } = useSubscription();
  const t = useTranslations("nav");

  const tabs =
    role === "customer"
      ? [
          { href: "/app", label: t("home"), icon: Home },
          { href: "/app/posts", label: t("myPosts"), icon: FileText },
          { href: "/app/library", label: t("library"), icon: BookMarked },
          { href: "/app/messages", label: t("messages"), icon: MessageCircle },
          { href: "/app/tickets", label: t("tickets"), icon: Ticket },
          { href: "/app/leaderboard", label: t("leaderboard"), icon: Trophy },
          { href: "/app/calendar", label: t("calendar"), icon: CalendarDays },
            { href: "/app/profile", label: t("profile"), icon: User },
        ]
      : role === "creator"
        ? [
            { href: "/app", label: t("home"), icon: Home },
            { href: "/app/posts", label: t("myPosts"), icon: FileText },
            { href: "/app/messages", label: t("messages"), icon: MessageCircle },
            { href: "/app/tickets", label: t("tickets"), icon: Ticket },
            { href: "/app/scan", label: t("scan"), icon: ScanLine },
            { href: "/app/events", label: t("events"), icon: Building2 },
            { href: "/app/courses", label: t("content"), icon: BookOpen },
            { href: "/app/library", label: t("library"), icon: BookMarked },
            { href: "/app/leaderboard", label: t("leaderboard"), icon: Trophy },
            { href: "/app/calendar", label: t("calendar"), icon: CalendarDays },
            { href: "/app/profile", label: t("profile"), icon: User },
          ]
        : [
            { href: "/app", label: t("home"), icon: Home },
            { href: "/app/posts", label: t("myPosts"), icon: FileText },
            { href: "/app/messages", label: t("messages"), icon: MessageCircle },
            { href: "/app/tickets", label: t("tickets"), icon: Ticket },
            { href: "/app/scan", label: t("scan"), icon: ScanLine },
            { href: "/app/events", label: t("events"), icon: Building2 },
            { href: "/app/library", label: t("library"), icon: BookMarked },
            { href: "/app/leaderboard", label: t("leaderboard"), icon: Trophy },
            { href: "/app/calendar", label: t("calendar"), icon: CalendarDays },
            { href: "/app/profile", label: t("profile"), icon: User },
          ];

  return (
    <aside className="hidden md:flex md:w-56 lg:w-64 flex-shrink-0 sticky top-0 h-screen flex-col justify-between border-r border-[var(--usha-border)] bg-[var(--usha-black)]">
      <div>
        {/* Logo */}
        <a
          href="/app"
          aria-label="Usha Platform – hem"
          className="flex items-center gap-2.5 px-6 py-6 transition-opacity duration-150 active:opacity-50"
        >
          <UschjaLogo size={36} />
          <span className="text-xl font-bold tracking-tight">Usha Platform</span>
        </a>

        {/* Navigation */}
        <nav className="space-y-0.5 px-4">
          {tabs.map((tab) => {
            const isActive =
              tab.href === "/app"
                ? pathname === "/app"
                : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-[var(--usha-gold)]/10 text-[var(--usha-gold)]"
                    : "text-[var(--usha-muted)] hover:bg-[var(--usha-card)] hover:text-[var(--usha-white)]"
                }`}
              >
                <tab.icon size={20} strokeWidth={isActive ? 2.5 : 1.5} />
                {tab.label}
              </Link>
            );
          })}

          {/* Usha Shop — separate storefront on the shop.usha.se subdomain.
              External link, so a plain <a> (not next/link) and its own group. */}
          <div className="my-1.5 h-px bg-[var(--usha-border)]" />
          <a
            href="https://shop.usha.se"
            className="flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-[var(--usha-muted)] transition-colors hover:bg-[var(--usha-card)] hover:text-[var(--usha-white)]"
          >
            <ShoppingBag size={20} strokeWidth={1.5} />
            {t("shop")}
          </a>

          {/* Usha Bastu — hidden until the sauna is permitted. See lib/bastu.ts. */}
          {isBastuLinkVisible() && (
            <a
              href={BASTU_URL}
              className="flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-[var(--usha-muted)] transition-colors hover:bg-[var(--usha-card)] hover:text-[var(--usha-white)]"
            >
              <Flame size={20} strokeWidth={1.5} />
              {t("bastu")}
            </a>
          )}
        </nav>
      </div>

      {/* Language switcher at bottom */}
      <div className="px-4 pb-6">
        <LanguageSwitcher />
      </div>
    </aside>
  );
}
