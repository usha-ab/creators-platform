"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ActivityDomain } from "@/lib/matching/activity-domains";
import {
  Users, Heart, X, MessageCircle, ShieldCheck, MapPin, Sparkles,
  Loader2, MoreVertical, Flag, Ban, Check, SlidersHorizontal, Share2,
} from "lucide-react";
import PlacesAutocomplete from "@/components/places-autocomplete";
import { useToast } from "@/components/ui/toaster";

const STYLES = ["kizomba", "bachata", "salsa", "zouk", "urban kiz", "afrobeats", "tango", "tarraxo", "compa"];
const LEVELS = ["nyborjare", "medel", "avancerad"];
const ROLES = ["leader", "follower", "both"] as const;
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WINDOWS = ["morning", "lunch", "evening", "weekend"];

type BuddyRole = (typeof ROLES)[number];

interface BuddyProfile {
  is_active: boolean;
  dance_styles: string[];
  style_levels: Record<string, string>;
  buddy_role: BuddyRole;
  availability: { days?: string[]; windows?: string[] } | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  radius_km: number | null;
  bio: string | null;
}

interface Candidate {
  id: string;
  name: string | null;
  avatar: string | null;
  city: string | null;
  bio: string | null;
  buddy_role: BuddyRole;
  dance_styles: string[];
  style_levels: Record<string, string>;
  distance_km: number | null;
  bankid_verified: boolean;
  match_reasons: string[];
}

interface Match {
  id: string;
  user: { id: string; name: string | null; avatar: string | null };
}

export function TrainingBuddiesContent() {
  const t = useTranslations("trainingBuddies");
  const { toast } = useToast();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<BuddyProfile | null>(null);
  const [bankidVerified, setBankidVerified] = useState(false);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<"suggestions" | "matches">("suggestions");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [poolSize, setPoolSize] = useState<number | null>(null);
  // Domänerna användaren själv tillhör, och den valda. Med bara en domän visas
  // ingen växlare — den som bara dansar ska inte behöva välja "Dans" varje gång.
  const [domains, setDomains] = useState<ActivityDomain[]>([]);
  const [domain, setDomain] = useState<ActivityDomain | null>(null);

  // Texten följer domänen: en löpare ska inte läsa "inga andra dansare".
  // Utan vald domän används den första man tillhör, annars dans som förr.
  const textDomain: ActivityDomain = domain ?? domains[0] ?? "dans";
  const td = (key: "subtitle" | "firstInPool" | "invite") =>
    t(`domains.${textDomain}.${key}`);
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchModal, setMatchModal] = useState<Candidate | null>(null);
  const matchDialogRef = useRef<HTMLDivElement>(null);

  const closeMatchModal = useCallback(() => setMatchModal(null), []);

  useEffect(() => {
    if (matchModal) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") closeMatchModal();
      };
      document.addEventListener("keydown", handleKeyDown);
      matchDialogRef.current?.focus();
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [matchModal, closeMatchModal]);

  const styleLabel = (s: string) => (STYLES.includes(s) ? t(`styles.${s.replace(/\s/g, "")}`) : s);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/training-buddies/profile");
      const data = await res.json();
      setBankidVerified(!!data.bankidVerified);
      if (data.profile) {
        setProfile(data.profile);
        setEditing(false);
      } else {
        setProfile({ ...(data.prefill ?? {}), is_active: false });
        setEditing(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFeed = useCallback(async (forDomain?: ActivityDomain | null) => {
    const qs = forDomain ? `?domain=${encodeURIComponent(forDomain)}` : "";
    const [c, m] = await Promise.all([
      fetch(`/api/training-buddies${qs}`).then((r) => (r.ok ? r.json() : { buddies: [] })),
      fetch("/api/training-buddies/matches").then((r) => (r.ok ? r.json() : { matches: [] })),
    ]);
    setCandidates(c.buddies ?? []);
    setPoolSize(typeof c.poolSize === "number" ? c.poolSize : null);
    const mine: ActivityDomain[] = Array.isArray(c.domains) ? c.domains : [];
    setDomains(mine);
    // Servern bestämmer vilken domän som gäller — den avvisar en domän
    // användaren inte tillhör, och då ska knappen inte se vald ut.
    setDomain(c.domain ?? (mine.length === 1 ? mine[0] : null));
    setMatches(m.matches ?? []);
  }, []);

  const bytDomän = useCallback((d: ActivityDomain | null) => {
    setDomain(d);
    loadFeed(d);
  }, [loadFeed]);

  // Invite dancers to the pool (Web Share where available, else copy the link).
  const invite = useCallback(async () => {
    const url = `${window.location.origin}/app/training-buddies`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Usha Platform", text: td("invite"), url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success(t("linkCopied"));
      }
    } catch {
      /* user dismissed the share sheet — nothing to do */
    }
  }, [t, toast]);

  useEffect(() => { loadProfile(); }, [loadProfile]);
  useEffect(() => { if (profile?.is_active && !editing) loadFeed(); }, [profile?.is_active, editing, loadFeed]);

  async function act(toUserId: string, action: "like" | "pass") {
    const cand = candidates.find((c) => c.id === toUserId) || null;
    setCandidates((prev) => prev.filter((c) => c.id !== toUserId));
    try {
      const res = await fetch("/api/training-buddies/like", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toUserId, action }),
      });
      const data = await res.json();
      if (data.matched && cand) {
        setMatchModal(cand);
        loadFeed();
      }
    } catch {
      toast.error(t("saveError"));
    }
  }

  async function block(userId: string) {
    setCandidates((prev) => prev.filter((c) => c.id !== userId));
    await fetch("/api/users/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, type: "block" }),
    }).catch(() => {});
    toast.success(t("blocked"));
  }

  async function report(userId: string) {
    const reason = window.prompt(t("reportPrompt"));
    if (!reason || reason.trim().length < 10) return;
    await fetch("/api/users/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, type: "report", reason }),
    }).catch(() => {});
    toast.success(t("reported"));
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="animate-spin text-[var(--usha-muted)]" />
      </div>
    );
  }

  // ── Onboarding / edit ──
  if (!profile?.is_active || editing) {
    if (!bankidVerified) {
      return (
        <Shell t={t} subtitle={td("subtitle")}>
          <div className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6 text-center">
            <ShieldCheck className="mx-auto mb-3 text-[var(--usha-gold)]" size={32} />
            <h2 className="text-lg font-bold">{t("bankidGateTitle")}</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--usha-muted)]">{t("bankidGateDesc")}</p>
            <a
              href="/dashboard/profile?bankid_next=/app/training-buddies"
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-6 py-2.5 text-sm font-bold text-black"
            >
              {t("bankidGateCta")}
            </a>
          </div>
        </Shell>
      );
    }
    return (
      <Shell t={t} subtitle={td("subtitle")}>
        <BuddyForm
          t={t}
          initial={profile}
          styleLabel={styleLabel}
          onSaved={loadProfile}
          onCancel={profile?.is_active ? () => setEditing(false) : undefined}
        />
      </Shell>
    );
  }

  // ── Active pool member ──
  return (
    <Shell t={t} subtitle={td("subtitle")}>
      {domains.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label={t("title")}>
          {domains.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => bytDomän(domain === d ? null : d)}
              aria-pressed={domain === d}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                domain === d
                  ? "border-[var(--usha-gold)] bg-[var(--usha-gold)]/15 text-[var(--usha-gold)]"
                  : "border-[var(--usha-border)] text-[var(--usha-muted)] hover:text-[var(--usha-white)]"
              }`}
            >
              {t(`domains.${d}.label`)}
            </button>
          ))}
        </div>
      )}

      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => setTab("suggestions")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${tab === "suggestions" ? "bg-[var(--usha-gold)]/15 text-[var(--usha-gold)]" : "text-[var(--usha-muted)]"}`}
        >
          {t("tabSuggestions")}
        </button>
        <button
          onClick={() => setTab("matches")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${tab === "matches" ? "bg-[var(--usha-gold)]/15 text-[var(--usha-gold)]" : "text-[var(--usha-muted)]"}`}
        >
          {t("tabMatches")}{matches.length ? ` (${matches.length})` : ""}
        </button>
        <button
          onClick={invite}
          className="rounded-lg p-2 text-[var(--usha-muted)] hover:text-[var(--usha-gold)]"
          aria-label={t("inviteFriends")}
          title={t("inviteFriends")}
        >
          <Share2 size={18} />
        </button>
        <button
          onClick={() => setEditing(true)}
          className="rounded-lg p-2 text-[var(--usha-muted)] hover:text-[var(--usha-white)]"
          aria-label={t("editProfile")}
        >
          <SlidersHorizontal size={18} />
        </button>
      </div>

      {tab === "suggestions" ? (
        candidates.length === 0 ? (
          poolSize === 0 ? (
            // Nobody else has joined yet — invite instead of "check back".
            <Empty
              icon={Sparkles}
              text={t("firstInPoolTitle")}
              subtext={td("firstInPool")}
              action={
                <button
                  onClick={invite}
                  className="rounded-lg bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-4 py-2 text-sm font-bold text-black"
                >
                  {t("inviteFriends")}
                </button>
              }
            />
          ) : (
            <Empty icon={Sparkles} text={t("emptySuggestions")} />
          )
        ) : (
          <div className="space-y-4">
            {candidates.map((c) => (
              <CandidateCard key={c.id} c={c} t={t} styleLabel={styleLabel} onAct={act} onBlock={block} onReport={report} />
            ))}
          </div>
        )
      ) : matches.length === 0 ? (
        <Empty icon={Users} text={t("emptyMatches")} />
      ) : (
        <div className="space-y-3">
          {matches.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-3">
              <Avatar name={m.user.name} avatar={m.user.avatar} />
              <span className="flex-1 text-sm font-semibold">{m.user.name || "Dansare"}</span>
              <button
                onClick={() => router.push(`/app/messages?to=${m.user.id}`)}
                className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-3 py-2 text-xs font-bold text-black"
              >
                <MessageCircle size={14} /> {t("message")}
              </button>
            </div>
          ))}
        </div>
      )}

      {matchModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-6" onClick={() => setMatchModal(null)}>
          <div
            ref={matchDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="match-modal-title"
            tabIndex={-1}
            className="w-full max-w-sm rounded-2xl border border-[var(--usha-gold)]/40 bg-[var(--usha-card)] p-6 text-center outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            <Heart className="mx-auto mb-2 text-[var(--usha-accent)]" size={40} />
            <h3 id="match-modal-title" className="text-xl font-bold">{t("itsAMatch")}</h3>
            <p className="mt-1 text-sm text-[var(--usha-muted)]">{t("itsAMatchDesc", { name: matchModal.name || "" })}</p>
            <button
              onClick={() => router.push(`/app/messages?to=${matchModal.id}`)}
              className="mt-4 w-full rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] py-3 text-sm font-bold text-black"
            >
              {t("sayHi")}
            </button>
            <button onClick={() => setMatchModal(null)} className="mt-2 w-full py-2 text-sm text-[var(--usha-muted)]">
              {t("keepBrowsing")}
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({
  t,
  subtitle,
  children,
}: {
  t: ReturnType<typeof useTranslations>;
  /** Domänanpassad underrubrik — "Hitta en danspartner", "Hitta en träningskompis". */
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-6 md:max-w-2xl md:mx-auto">
      <div className="mb-5 flex items-center gap-3">
        <Users size={24} className="text-[var(--usha-gold)]" />
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-[var(--usha-muted)]">{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function Empty({
  icon: Icon,
  text,
  subtext,
  action,
}: {
  icon: typeof Users;
  text: string;
  subtext?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-6 py-16 text-center">
      <Icon size={36} className="mb-3 text-[var(--usha-gold)]" />
      <p className="text-sm font-medium text-[var(--usha-white)]">{text}</p>
      {subtext && <p className="mt-1.5 max-w-xs text-xs text-[var(--usha-muted)]">{subtext}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function Avatar({ name, avatar }: { name: string | null; avatar: string | null }) {
  return avatar ? (
    <Image src={avatar} alt={name || ""} width={44} height={44} className="h-11 w-11 rounded-full object-cover" />
  ) : (
    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--usha-border)] text-sm font-bold text-[var(--usha-muted)]">
      {(name || "?").charAt(0).toUpperCase()}
    </div>
  );
}

function CandidateCard({
  c, t, styleLabel, onAct, onBlock, onReport,
}: {
  c: Candidate;
  t: ReturnType<typeof useTranslations>;
  styleLabel: (s: string) => string;
  onAct: (id: string, a: "like" | "pass") => void;
  onBlock: (id: string) => void;
  onReport: (id: string) => void;
}) {
  const ta = useTranslations("a11y");
  const [menu, setMenu] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)]">
      <div className="flex items-start gap-3 p-4">
        <Avatar name={c.name} avatar={c.avatar} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate font-semibold">{c.name || "Dansare"}</h3>
            {c.bankid_verified && <ShieldCheck size={14} className="shrink-0 text-[var(--usha-gold)]" />}
          </div>
          <p className="mt-0.5 flex items-center gap-2 text-xs text-[var(--usha-muted)]">
            <span>{t(`roles.${c.buddy_role}`)}</span>
            {c.distance_km != null && (
              <span className="flex items-center gap-0.5"><MapPin size={11} />{t("kmAway", { km: c.distance_km })}</span>
            )}
            {c.distance_km == null && c.city && <span className="flex items-center gap-0.5"><MapPin size={11} />{c.city}</span>}
          </p>
        </div>
        <div className="relative">
          <button onClick={() => setMenu((v) => !v)} className="rounded-lg p-1.5 text-[var(--usha-muted)] hover:bg-[var(--usha-card-hover)]" aria-label={ta("options")}>
            <MoreVertical size={16} />
          </button>
          {menu && (
            <div className="absolute right-0 top-8 z-10 w-40 overflow-hidden rounded-lg border border-[var(--usha-border)] bg-[var(--usha-card)] shadow-xl">
              <button onClick={() => { setMenu(false); onBlock(c.id); }} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-[var(--usha-card-hover)]">
                <Ban size={14} /> {t("block")}
              </button>
              <button onClick={() => { setMenu(false); onReport(c.id); }} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-red-400 hover:bg-[var(--usha-card-hover)]">
                <Flag size={14} /> {t("report")}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 px-4">
        {c.dance_styles.slice(0, 4).map((s) => (
          <span key={s} className="rounded-full bg-[var(--usha-gold)]/10 px-2.5 py-0.5 text-[11px] font-medium text-[var(--usha-gold)]">
            {styleLabel(s)}{c.style_levels?.[s] ? ` · ${t(`levels.${c.style_levels[s]}`)}` : ""}
          </span>
        ))}
      </div>

      {c.bio && <p className="mt-3 px-4 text-sm text-[var(--usha-muted)]">{c.bio}</p>}

      {c.match_reasons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 px-4">
          {c.match_reasons.map((r, i) => (
            <span key={i} className="rounded-md bg-[var(--usha-border)] px-2 py-0.5 text-[10px] text-[var(--usha-muted)]">{r}</span>
          ))}
        </div>
      )}

      <div className="mt-4 flex gap-2 p-4 pt-3">
        <button onClick={() => onAct(c.id, "pass")} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[var(--usha-border)] py-2.5 text-sm font-semibold text-[var(--usha-muted)] transition hover:text-[var(--usha-white)]">
          <X size={16} /> {t("pass")}
        </button>
        <button onClick={() => onAct(c.id, "like")} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] py-2.5 text-sm font-bold text-black transition hover:opacity-90">
          <Heart size={16} /> {t("like")}
        </button>
      </div>
    </div>
  );
}

function chip(active: boolean) {
  return `rounded-full border px-3 py-1.5 text-xs font-medium transition ${active ? "border-[var(--usha-gold)] bg-[var(--usha-gold)]/15 text-[var(--usha-gold)]" : "border-[var(--usha-border)] text-[var(--usha-muted)]"}`;
}

function BuddyForm({
  t, initial, styleLabel, onSaved, onCancel,
}: {
  t: ReturnType<typeof useTranslations>;
  initial: BuddyProfile | null;
  styleLabel: (s: string) => string;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const { toast } = useToast();
  const [styles, setStyles] = useState<string[]>(initial?.dance_styles ?? []);
  const [levels, setLevels] = useState<Record<string, string>>(initial?.style_levels ?? {});
  const [role, setRole] = useState<BuddyRole>(initial?.buddy_role ?? "both");
  const [days, setDays] = useState<string[]>(initial?.availability?.days ?? []);
  const [windows, setWindows] = useState<string[]>(initial?.availability?.windows ?? []);
  const [city, setCity] = useState<string | null>(initial?.city ?? null);
  const [lat, setLat] = useState<number | null>(initial?.lat ?? null);
  const [lon, setLon] = useState<number | null>(initial?.lon ?? null);
  const [radius, setRadius] = useState<number>(initial?.radius_km ?? 25);
  const [bio, setBio] = useState<string>(initial?.bio ?? "");
  const [agreed, setAgreed] = useState<boolean>(!!initial?.is_active);
  const [saving, setSaving] = useState(false);

  const toggle = (arr: string[], set: (v: string[]) => void, v: string) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  async function save() {
    if (styles.length === 0) { toast.error(t("needStyle")); return; }
    if (!agreed) { toast.error(t("needAdult")); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/training-buddies/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dance_styles: styles, style_levels: levels, buddy_role: role,
          availability: { days, windows }, city, lat, lon, radius_km: radius, bio,
          agreed_adult: agreed,
        }),
      });
      if (!res.ok) { toast.error(t("saveError")); setSaving(false); return; }
      onSaved();
    } catch { toast.error(t("saveError")); setSaving(false); }
  }

  return (
    <div className="space-y-6 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-5">
      <p className="text-sm text-[var(--usha-muted)]">{t("onboardTitle")}</p>

      <div>
        <label className="mb-2 block text-sm font-semibold">{t("onboardStyles")}</label>
        <div className="flex flex-wrap gap-2">
          {STYLES.map((s) => (
            <button key={s} type="button" onClick={() => toggle(styles, setStyles, s)} className={chip(styles.includes(s))}>
              {styleLabel(s)}
            </button>
          ))}
        </div>
        {styles.map((s) => (
          <div key={s} className="mt-2 flex items-center gap-2">
            <span className="w-24 text-xs text-[var(--usha-muted)]">{styleLabel(s)}</span>
            <div className="flex gap-1.5">
              {LEVELS.map((lv) => (
                <button key={lv} type="button" onClick={() => setLevels((p) => ({ ...p, [s]: lv }))} className={chip(levels[s] === lv)}>
                  {t(`levels.${lv}`)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div>
        <label className="mb-2 block text-sm font-semibold">{t("onboardRole")}</label>
        <div className="flex gap-2">
          {ROLES.map((r) => (
            <button key={r} type="button" onClick={() => setRole(r)} className={chip(role === r)}>{t(`roles.${r}`)}</button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-semibold">{t("onboardAvailability")}</label>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d) => (
            <button key={d} type="button" onClick={() => toggle(days, setDays, d)} className={chip(days.includes(d))}>{t(`days.${d}`)}</button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {WINDOWS.map((w) => (
            <button key={w} type="button" onClick={() => toggle(windows, setWindows, w)} className={chip(windows.includes(w))}>{t(`windows.${w}`)}</button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-semibold">{t("onboardCity")}</label>
        <PlacesAutocomplete
          latName="buddy_lat" lngName="buddy_lng" cityName="buddy_city"
          defaultValue={city ?? ""} defaultLat={lat ?? undefined} defaultLng={lon ?? undefined} defaultCity={city ?? undefined}
          onPlaceSelect={(p) => { setLat(p?.lat ?? null); setLon(p?.lng ?? null); setCity(p?.city ?? null); }}
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-semibold">{t("onboardRadius", { km: radius })}</label>
        <input type="range" min={1} max={100} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="w-full accent-[var(--usha-gold)]" />
      </div>

      <div>
        <label className="mb-2 block text-sm font-semibold">{t("onboardBio")}</label>
        <textarea value={bio} maxLength={500} onChange={(e) => setBio(e.target.value)} rows={3}
          className="w-full rounded-lg border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2 text-sm outline-none focus:border-[var(--usha-gold)]/50" />
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-[var(--usha-muted)]">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--usha-gold)]" />
        <span>{t("adult18")}</span>
      </label>

      <div className="flex gap-2">
        {onCancel && (
          <button onClick={onCancel} className="rounded-xl border border-[var(--usha-border)] px-4 py-3 text-sm font-medium text-[var(--usha-muted)]">
            {t("cancel")}
          </button>
        )}
        <button onClick={save} disabled={saving} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] py-3 text-sm font-bold text-black disabled:opacity-60">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          {saving ? t("onboardSaving") : t("onboardSave")}
        </button>
      </div>
    </div>
  );
}
