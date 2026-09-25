"use client";

import { useEffect, useState } from "react";
import { useRole } from "@/components/mobile/role-context";
import { useTranslations } from "next-intl";
import { LevelBadge } from "@/components/level-badge";
import {
  getLevelProgress,
  getNextLevelThreshold,
} from "@/lib/points/constants";
import { useLevelName } from "@/lib/points/level-name";
import {
  User,
  Edit2,
  Eye,
  CreditCard,
  Bell,
  Shield,
  ShieldCheck,
  ShieldAlert,
  HelpCircle,
  LogOut,
  ChevronRight,
  Star,
  Calendar,
  Heart,
  BookOpen,
  Users,
  DollarSign,
  Award,
  Building2,
  Ticket,
  Crown,
  Trophy,
  Gift,
  Link2,
  Lock,
  Wallet,
  Languages,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { InstallAppRow } from "@/components/install-app-row";

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
  slug?: string | null;
  tier: string | null;
  stripe_account_id: string | null;
  created_at: string;
  updated_at: string;
  bankid_verified_at?: string | null;
  bankid_name?: string | null;
}

interface ProfileContentProps {
  profile: Profile | null;
  email: string;
  listingsCount: number;
  bookingsCount: number;
  completedCoursesCount?: number;
  favoritesCount?: number;
  averageRating?: number | null;
}

export function ProfileContent({
  profile,
  email,
  listingsCount,
  bookingsCount,
  completedCoursesCount = 0,
  favoritesCount = 0,
  averageRating = null,
}: ProfileContentProps) {
  const { role } = useRole();
  const t = useTranslations("profile");
  const tc = useTranslations("common");
  const tp = useTranslations("appProfile");
  const tr = useTranslations("roles");
  const levelNameOf = useLevelName();
  const [userPoints, setUserPoints] = useState<{
    total_points: number;
    current_level: number;
  } | null>(null);

  useEffect(() => {
    fetch("/api/points")
      .then((r) => r.json())
      .then((data) => setUserPoints(data.points))
      .catch(() => {});
  }, []);

  const totalPoints = userPoints?.total_points ?? 0;
  const currentLevel = userPoints?.current_level ?? 1;
  const progress = getLevelProgress(totalPoints, currentLevel);
  const nextThreshold = getNextLevelThreshold(currentLevel);

  return (
    <div className="px-4 py-6 space-y-6 md:max-w-2xl md:mx-auto">
      {/* Avatar & Name */}
      <div className="flex flex-col items-center">
        <div className="relative mb-3">
          <div className="h-20 w-20 rounded-full border-2 border-[var(--usha-gold)] p-0.5">
            <div className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-[var(--usha-gold)]/20 to-[var(--usha-accent)]/20">
              <span className="text-2xl font-bold text-[var(--usha-gold)]">
                {(profile?.full_name || "U")[0]}
              </span>
            </div>
          </div>
          {role === "creator" && (
            <div className="absolute -bottom-1 -right-1 rounded-full bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] p-1">
              <Award size={12} className="text-black" />
            </div>
          )}
        </div>
        <h1 className="text-xl font-bold">
          {profile?.full_name || tp("defaultName")}
        </h1>
        <p className="text-sm text-[var(--usha-muted)]">{email}</p>
        {profile?.category && (
          <p className="mt-0.5 text-xs text-[var(--usha-gold)]">
            {role === "creator" ? tr("creator") : role === "venue" ? tr("venue") : tr("customer")} · {profile.category}
          </p>
        )}
      </div>

      {/* Membership card */}
      <div className="rounded-2xl bg-gradient-to-br from-[var(--usha-gold)]/20 via-[var(--usha-gold)]/10 to-[var(--usha-accent)]/10 border border-[var(--usha-gold)]/30 p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-bold text-[var(--usha-gold)]">
            {role === "creator"
              ? t("topCreator")
              : role === "venue"
                ? t("premiumVenue")
                : t("goldMember")}
          </span>
          <Star size={16} className="fill-[var(--usha-gold)] text-[var(--usha-gold)]" />
        </div>
        <p className="text-xs text-[var(--usha-muted)]">
          {t("memberSince")}{" "}
          {profile?.created_at
            ? new Date(profile.created_at).toLocaleDateString("sv", {
                month: "long",
                year: "numeric",
              })
            : tp("memberSinceFallback")}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <LevelBadge level={currentLevel} size="md" showName />
          <span className="text-xs text-[var(--usha-muted)]">
            {tp("points", { points: totalPoints.toLocaleString("sv-SE") })}
          </span>
        </div>
        {nextThreshold && (
          <div className="mt-2">
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--usha-gold)] transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-1 text-[10px] text-[var(--usha-muted)]">
              {t("pointsToNext", { points: (nextThreshold - totalPoints).toLocaleString("sv-SE"), level: levelNameOf(currentLevel + 1) })}
            </p>
          </div>
        )}
      </div>

      {/* BankID verification status */}
      <BankIdStatusRow
        verifiedAt={profile?.bankid_verified_at ?? null}
        bankidName={profile?.bankid_name ?? null}
        verifiedLabel={tp("bankidVerifiedTitle")}
        verifyTitle={tp("bankidVerifyTitle")}
        verifyDesc={tp("bankidVerifyDesc")}
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {role === "customer" && (
          <>
            <StatBox icon={Calendar} label={t("events")} value={String(bookingsCount)} />
            <StatBox icon={BookOpen} label={t("courses")} value={String(completedCoursesCount)} />
            <StatBox icon={Heart} label={t("favorites")} value={String(favoritesCount)} />
          </>
        )}
        {role === "creator" && (
          <>
            <StatBox icon={BookOpen} label={t("courses")} value={String(listingsCount)} />
            <StatBox icon={Users} label={t("students")} value={String(bookingsCount)} />
            <StatBox icon={Star} label={t("rating")} value={averageRating != null ? `${averageRating}/5` : "-"} />
          </>
        )}
        {role === "venue" && (
          <>
            <StatBox icon={Ticket} label={t("events")} value={String(listingsCount)} />
            <StatBox icon={Users} label={t("visitors")} value={String(bookingsCount)} />
            <StatBox icon={Star} label={t("rating")} value={averageRating != null ? `${averageRating}/5` : "-"} />
          </>
        )}
      </div>

      {/* Revenue card (for creator and venue) */}
      {(role === "creator" || role === "venue") && (
        <div className="rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-[var(--usha-muted)]">{t("revenueThisMonth")}</p>
              <p className="text-2xl font-bold">
                - kr
              </p>
            </div>
            <DollarSign size={24} className="text-[var(--usha-gold)]" />
          </div>
        </div>
      )}

      {/* Settings list */}
      <div className="space-y-1 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] overflow-hidden">
        <SettingsRow icon={Gift} label={t("partner")} href="/app/partner" />
        <SettingsRow icon={Trophy} label={t("leaderboard")} href="/app/leaderboard" />
        <SettingsRow icon={Gift} label={t("rewards")} href="/app/rewards" />
        {profile && (
          <SettingsRow
            icon={Eye}
            label={t("viewMyPage")}
            href={`/creators/${profile.slug || profile.id}`}
            external
          />
        )}
        <SettingsRow icon={Edit2} label={t("editProfile")} href="/dashboard/profile" />
        <SettingsRow icon={Crown} label={t("myPlan")} href="/dashboard/billing" />
        {/* Säljarens väg till "hur får jag betalt". Låg tidigare bara under Mer,
            som är dold på desktop, och i onboarding-steget — som pekade fel. */}
        {role !== "customer" && (
          <SettingsRow icon={Wallet} label={t("payouts")} href="/dashboard/payouts" />
        )}
        {/* Den här listan länkar direkt till varje settings-sida i stället för
            till hubben /app/settings, som bara nås från en token-gate. Nya
            settings-sidor måste därför läggas till HÄR också, annars blir de
            oåtkomliga i appen — vilket hände både Kopplingar och Login &
            säkerhet. */}
        <SettingsRow icon={Languages} label={t("language")} href="/app/settings/language" />
        <SettingsRow icon={Link2} label={t("connections")} href="/app/settings/connections" />
        <SettingsRow icon={Lock} label={t("loginSecurity")} href="/app/settings/security" />
        <SettingsRow icon={Bell} label={t("notifications")} href="/app/settings/notifications" />
        <SettingsRow icon={Shield} label={t("privacySettings")} href="/app/settings/privacy" />
        <SettingsRow icon={HelpCircle} label={t("helpSupport")} href="/app/settings/help" />
        <InstallAppRow />
        <form action="/api/auth/signout" method="POST">
          <button
            type="submit"
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-red-400 transition-colors hover:bg-[var(--usha-card-hover)]"
          >
            <LogOut size={18} />
            <span className="flex-1 text-sm font-medium">{tc("logout")}</span>
          </button>
        </form>
      </div>
    </div>
  );
}

function BankIdStatusRow({
  verifiedAt,
  bankidName,
  verifiedLabel,
  verifyTitle,
  verifyDesc,
}: {
  verifiedAt: string | null;
  bankidName: string | null;
  verifiedLabel: string;
  verifyTitle: string;
  verifyDesc: string;
}) {
  if (verifiedAt) {
    const formatted = new Date(verifiedAt).toLocaleDateString("sv-SE", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    return (
      <div className="flex items-center gap-3 rounded-xl border border-green-500/30 bg-green-500/5 px-4 py-3">
        <ShieldCheck size={20} className="shrink-0 text-green-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-green-400">
            {verifiedLabel}
          </p>
          <p className="truncate text-xs text-[var(--usha-muted)]">
            {bankidName ? `${bankidName} · ${formatted}` : formatted}
          </p>
        </div>
      </div>
    );
  }
  return (
    <a
      href="/signup"
      className="flex items-center gap-3 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 transition hover:border-[var(--usha-gold)]/40"
    >
      <ShieldAlert size={20} className="shrink-0 text-[var(--usha-muted)]" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{verifyTitle}</p>
        <p className="truncate text-xs text-[var(--usha-muted)]">
          {verifyDesc}
        </p>
      </div>
      <ChevronRight size={16} className="shrink-0 text-[var(--usha-muted)]" />
    </a>
  );
}

function StatBox({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-3 text-center">
      <Icon size={18} className="mx-auto mb-1 text-[var(--usha-gold)]" />
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[10px] text-[var(--usha-muted)]">{label}</p>
    </div>
  );
}

function SettingsRow({
  icon: Icon,
  label,
  href,
  external,
  comingSoon,
  comingSoonLabel,
}: {
  icon: LucideIcon;
  label: string;
  href?: string;
  /** Öppna i ny flik — för länkar som lämnar appen, så att man inte tappar sin plats i den. */
  external?: boolean;
  comingSoon?: boolean;
  comingSoonLabel?: string;
}) {
  const inner = (
    <>
      <Icon size={18} className="text-[var(--usha-muted)]" />
      <span className="flex-1 text-sm font-medium">
        {label}
        {comingSoon && (
          <span className="ml-2 text-[10px] font-normal text-[var(--usha-muted)]">
            {comingSoonLabel}
          </span>
        )}
      </span>
      <ChevronRight size={16} className="text-[var(--usha-muted)]" />
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-[var(--usha-card-hover)]"
      >
        {inner}
      </a>
    );
  }

  return (
    <div className={`flex w-full items-center gap-3 px-4 py-3.5${comingSoon ? " opacity-50 cursor-default" : " cursor-pointer transition-colors hover:bg-[var(--usha-card-hover)]"}`}>
      {inner}
    </div>
  );
}
