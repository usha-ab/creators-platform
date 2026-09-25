/**
 * Beta mode — when active, all paid features are unlocked for everyone.
 *
 * Two controls, ANDed together:
 *  - NEXT_PUBLIC_BETA_MODE === "true"  — master switch (kill switch).
 *  - NEXT_PUBLIC_BETA_END_DATE         — optional ISO timestamp. Beta auto-ends
 *    at this instant; afterwards tier gating (Gratis/Guld/Premium) is enforced.
 *
 * Note: NEXT_PUBLIC_* values are inlined into the client bundle at build time,
 * but the comparison against Date.now() runs where the module loads — so both
 * the browser and a server cold start flip on their own at the end instant.
 *
 * What does NOT flip on its own is already-rendered output: pages generated or
 * cached while beta was live keep serving beta-era markup afterwards. There is
 * NO scheduled redeploy (checked 2026-09-24: neither .github/workflows nor
 * vercel.json contains one), so a manual redeploy after the end instant is what
 * clears that cache. An earlier version of this comment claimed the redeploy was
 * scheduled; it never was.
 */
const BETA_SWITCH_ON = process.env.NEXT_PUBLIC_BETA_MODE === "true";

/** The beta end instant in ms, or NaN when unset/invalid (→ no auto-end). */
export const BETA_END_MS = process.env.NEXT_PUBLIC_BETA_END_DATE
  ? new Date(process.env.NEXT_PUBLIC_BETA_END_DATE).getTime()
  : NaN;

const beforeBetaEnd = Number.isNaN(BETA_END_MS) || Date.now() < BETA_END_MS;

export const BETA_MODE = BETA_SWITCH_ON && beforeBetaEnd;

/** ISO date (yyyy-mm-dd) the beta ends, or null. For display on landing/billing. */
export const BETA_END_DATE: string | null = Number.isNaN(BETA_END_MS)
  ? null
  : new Date(BETA_END_MS).toISOString().slice(0, 10);
