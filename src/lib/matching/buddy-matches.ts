import { createAdminClient } from "@/lib/supabase/admin";
import {
  type ActivityDomain,
  domainsForActivities,
  isInDomain,
  sharesDomain,
} from "@/lib/matching/activity-domains";

/**
 * Training-buddy matching: user→user ranking for the practice-partner pool.
 * Adapts the event matcher (user-matches.ts) to score other opted-in members.
 *
 * Poolen är domänindelad: en löpare matchas inte mot en dansare. Överlappet i
 * aktiviteter POÄNGSÄTTS inom domänen, men domänen i sig är ett HÅRT filter —
 * annars hamnar fel folk i listan, bara längre ner.
 * All ranking is server-side; the client only receives a public-safe, distance-
 * rounded payload (never raw coordinates).
 */

export type BuddyRole = "leader" | "follower" | "both";

export interface BuddyCandidate {
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
  score: number;
  match_reasons: string[];
}

interface BuddyRow {
  profile_id: string;
  is_active: boolean;
  dance_styles: string[] | null;
  style_levels: Record<string, string> | null;
  buddy_role: BuddyRole;
  availability: { days?: string[]; windows?: string[] } | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  radius_km: number | null;
  bio: string | null;
}

const WEIGHTS = { style: 30, role: 20, distance: 20, level: 12, availability: 10, trust: 8 };
const norm = (s: string) => s.trim().toLowerCase();

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach((x) => { if (b.has(x)) inter++; });
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// profile_preferences.skill_level uses these three values.
const LEVEL_ORDER = ["nyborjare", "medel", "avancerad"];
function levelScore(a?: string, b?: string): number {
  if (!a || !b) return 0.5;
  const ia = LEVEL_ORDER.indexOf(norm(a));
  const ib = LEVEL_ORDER.indexOf(norm(b));
  if (ia < 0 || ib < 0) return 0.5;
  const d = Math.abs(ia - ib);
  return d === 0 ? 1 : d === 1 ? 0.6 : 0.3;
}

function roleScore(a: BuddyRole, b: BuddyRole): number {
  if ((a === "leader" && b === "follower") || (a === "follower" && b === "leader")) return 1;
  if (a === "both" || b === "both") return 0.7;
  return 0.2; // same fixed role — can still practice, just less complementary
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const STYLE_LABEL: Record<string, string> = {
  kizomba: "Kizomba", "urban kiz": "Urban Kiz", bachata: "Bachata",
  salsa: "Salsa", afrobeats: "Afrobeats", zouk: "Zouk", tango: "Tango",
  tarraxo: "Tarraxo", compa: "Compa",
};
const pretty = (s: string) => STYLE_LABEL[norm(s)] ?? s.charAt(0).toUpperCase() + s.slice(1);

export interface BuddyFilter {
  style?: string;
  level?: string;
  city?: string;
  limit?: number;
  /** Visa bara en domän. Ignoreras om användaren inte själv tillhör den. */
  domain?: ActivityDomain;
}

/** Domänerna användaren tillhör — driver växlaren i gränssnittet. */
export async function getMyDomains(userId: string): Promise<ActivityDomain[]> {
  const { data } = await createAdminClient()
    .from("training_buddy_profiles")
    .select("dance_styles, is_active")
    .eq("profile_id", userId)
    .maybeSingle();
  const row = data as { dance_styles: string[] | null; is_active: boolean } | null;
  if (!row || !row.is_active) return [];
  return domainsForActivities(row.dance_styles);
}

/**
 * Ranked buddy candidates for a user. Requires the user to have an active
 * buddy profile (opted in). Degrades gracefully with sparse data.
 */
export async function getBuddyCandidates(userId: string, opts: BuddyFilter = {}): Promise<BuddyCandidate[]> {
  const admin = createAdminClient();

  const { data: meRaw } = await admin
    .from("training_buddy_profiles")
    .select("*")
    .eq("profile_id", userId)
    .maybeSingle();
  const me = meRaw as BuddyRow | null;
  if (!me || !me.is_active) return [];

  // Exclusion set: self, everyone I've already actioned, blocks (both ways), existing matches.
  const [{ data: myLikes }, { data: blocksOut }, { data: blocksIn }, { data: myMatches }] = await Promise.all([
    admin.from("buddy_likes").select("to_user").eq("from_user", userId),
    admin.from("user_blocks").select("blocked_id").eq("blocker_id", userId),
    admin.from("user_blocks").select("blocker_id").eq("blocked_id", userId),
    admin.from("buddy_matches").select("user_a, user_b").or(`user_a.eq.${userId},user_b.eq.${userId}`),
  ]);
  const excluded = new Set<string>([userId]);
  (myLikes ?? []).forEach((r: { to_user: string }) => excluded.add(r.to_user));
  (blocksOut ?? []).forEach((r: { blocked_id: string }) => excluded.add(r.blocked_id));
  (blocksIn ?? []).forEach((r: { blocker_id: string }) => excluded.add(r.blocker_id));
  (myMatches ?? []).forEach((r: { user_a: string; user_b: string }) => { excluded.add(r.user_a); excluded.add(r.user_b); });

  const { data: poolRaw } = await admin
    .from("training_buddy_profiles")
    .select("*")
    .eq("is_active", true)
    .limit(300);
  const pool = ((poolRaw ?? []) as BuddyRow[]).filter((c) => !excluded.has(c.profile_id));
  if (pool.length === 0) return [];

  const ids = pool.map((c) => c.profile_id);
  const { data: profs } = await admin
    .from("profiles")
    .select("id, full_name, avatar_url, bankid_verified_at")
    .in("id", ids);
  const profMap = new Map((profs ?? []).map((p: { id: string }) => [p.id, p]));

  const myStyles = new Set((me.dance_styles ?? []).map(norm));
  const myLevels = me.style_levels ?? {};
  const myDays = new Set((me.availability?.days ?? []).map(norm));
  const myWindows = new Set((me.availability?.windows ?? []).map(norm));
  // Domänen är hårt filter, inte poäng. Utan aktiviteter alls: ingen pool —
  // hellre tomt än att matcha någon mot främlingar hen inte delar något med.
  const myDomains = domainsForActivities(me.dance_styles);
  if (myDomains.length === 0) return [];
  const filterDomain: ActivityDomain | null =
    opts.domain && myDomains.includes(opts.domain) ? opts.domain : null;

  const filterStyle = opts.style ? norm(opts.style) : null;
  const filterLevel = opts.level ? norm(opts.level) : null;
  const filterCity = opts.city ? norm(opts.city) : null;

  const scored: BuddyCandidate[] = [];
  for (const c of pool) {
    const p = profMap.get(c.profile_id) as
      | { full_name: string | null; avatar_url: string | null; bankid_verified_at: string | null }
      | undefined;
    // Domängrinden. Med växlaren aktiv visas bara den valda domänen; utan
    // den räcker det att vi delar någon domän alls.
    if (filterDomain) {
      if (!isInDomain(c.dance_styles, filterDomain)) continue;
    } else if (!sharesDomain(me.dance_styles, c.dance_styles)) {
      continue;
    }

    const candStyles = (c.dance_styles ?? []).map(norm);
    const candStyleSet = new Set(candStyles);

    // Filters (hard).
    if (filterStyle && !candStyleSet.has(filterStyle)) continue;
    if (filterCity && !(c.city && norm(c.city).includes(filterCity))) continue;
    if (filterLevel) {
      const levels = Object.values(c.style_levels ?? {}).map(norm);
      if (!levels.includes(filterLevel)) continue;
    }

    const reasons: string[] = [];

    // Style overlap.
    const styleScore = jaccard(myStyles, candStyleSet);
    const shared = candStyles.filter((s) => myStyles.has(s));
    if (shared.length) reasons.push(shared.slice(0, 2).map(pretty).join(", "));

    // Role complementarity (the dating-style hook).
    const rScore = roleScore(me.buddy_role, c.buddy_role);
    if (rScore >= 1) reasons.push("Leder söker följer");

    // Distance decay + hard radius filter when both have coords.
    let distScore = 0.4;
    let distanceKm: number | null = null;
    if (me.lat != null && me.lon != null && c.lat != null && c.lon != null) {
      const d = haversineKm(me.lat, me.lon, c.lat, c.lon);
      distanceKm = Math.round(d);
      const maxR = Math.min(me.radius_km ?? 25, c.radius_km ?? 25);
      if (d > maxR) continue; // outside both radii
      distScore = Math.max(0, 1 - d / (me.radius_km ?? 25));
      if (d <= 10) reasons.push(`Nära dig (${distanceKm} km)`);
    } else if (c.city && me.city && norm(c.city) === norm(me.city)) {
      distScore = 0.8;
      reasons.push(c.city);
    }

    // Per-shared-style level compatibility (average over shared styles).
    let lvlScore = 0.5;
    if (shared.length) {
      const perStyle = shared.map((s) => levelScore(myLevels[s], (c.style_levels ?? {})[s]));
      lvlScore = perStyle.reduce((a, b) => a + b, 0) / perStyle.length;
    }

    // Availability overlap (days + time windows).
    const candDays = new Set((c.availability?.days ?? []).map(norm));
    const candWindows = new Set((c.availability?.windows ?? []).map(norm));
    const availScore = (jaccard(myDays, candDays) + jaccard(myWindows, candWindows)) / 2;

    // Trust — everyone in the pool is BankID-verified, but keep the dimension.
    const bankid = !!p?.bankid_verified_at;
    const trustScore = bankid ? 1 : 0;
    if (bankid) reasons.push("BankID-verifierad");

    const score =
      WEIGHTS.style * styleScore +
      WEIGHTS.role * rScore +
      WEIGHTS.distance * distScore +
      WEIGHTS.level * lvlScore +
      WEIGHTS.availability * availScore +
      WEIGHTS.trust * trustScore;

    scored.push({
      id: c.profile_id,
      name: p?.full_name ?? null,
      avatar: p?.avatar_url ?? null,
      city: c.city,
      bio: c.bio,
      buddy_role: c.buddy_role,
      dance_styles: candStyles,
      style_levels: c.style_levels ?? {},
      distance_km: distanceKm,
      bankid_verified: bankid,
      score,
      match_reasons: reasons.slice(0, 3),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.min(opts.limit ?? 20, 20));
}

/**
 * Record a like or pass. On a reciprocal like, materialize a canonical
 * buddy_matches row and report the match so the caller can notify both users.
 * Idempotent.
 */
export async function recordBuddyLike(
  fromUser: string,
  toUser: string,
  action: "like" | "pass"
): Promise<{ matched: boolean; isNew?: boolean; matchId?: string }> {
  const admin = createAdminClient();

  await admin
    .from("buddy_likes")
    .upsert({ from_user: fromUser, to_user: toUser, action }, { onConflict: "from_user,to_user" });

  if (action !== "like") return { matched: false };

  const { data: recip } = await admin
    .from("buddy_likes")
    .select("id")
    .eq("from_user", toUser)
    .eq("to_user", fromUser)
    .eq("action", "like")
    .maybeSingle();
  if (!recip) return { matched: false };

  const [a, b] = fromUser < toUser ? [fromUser, toUser] : [toUser, fromUser];
  // ignoreDuplicates → the insert returns a row ONLY when it actually created
  // the match. Two simultaneous mutual likes both see the reciprocal like, but
  // only one insert wins; the other returns null, so exactly one call reports
  // isNew and the caller notifies both users once (no duplicate match pings).
  const { data: created } = await admin
    .from("buddy_matches")
    .upsert({ user_a: a, user_b: b }, { onConflict: "user_a,user_b", ignoreDuplicates: true })
    .select("id")
    .maybeSingle();

  if (created) {
    return { matched: true, isNew: true, matchId: (created as { id: string }).id };
  }

  // Match already existed — report matched but not new (no notification).
  const { data: existing } = await admin
    .from("buddy_matches")
    .select("id")
    .eq("user_a", a)
    .eq("user_b", b)
    .maybeSingle();
  return { matched: true, isNew: false, matchId: (existing as { id: string } | null)?.id };
}
