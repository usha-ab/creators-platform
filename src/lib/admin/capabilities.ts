import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminById } from "./check";

/**
 * The slices the admin surface can be granted in.
 *
 * Kept in step with the check constraint on `admin_capabilities.capability` —
 * adding one is a migration on purpose, so a new admin tool can't quietly widen
 * what a partner is able to do.
 */
export const ADMIN_CAPABILITIES = ["creators", "promo", "partners"] as const;
export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number];

/**
 * What a page or action demands. A capability can be delegated to a partner;
 * `"full"` cannot — it means the caller must be a full admin. Granting
 * permissions is `"full"`, because a partner who can widen their own grant has
 * no grant at all.
 */
export type AdminRequirement = AdminCapability | "full";

export function isAdminCapability(value: unknown): value is AdminCapability {
  return typeof value === "string" && (ADMIN_CAPABILITIES as readonly string[]).includes(value);
}

/** Everything a full admin holds — used so one list serves both cases. */
export const ALL_CAPABILITIES: readonly AdminCapability[] = ADMIN_CAPABILITIES;

export interface AdminAccess {
  /** Full admin: everything, including granting capabilities to others. */
  full: boolean;
  /** What this person may actually open. Full admins hold all of them. */
  capabilities: AdminCapability[];
}

export const NO_ACCESS: AdminAccess = { full: false, capabilities: [] };

/**
 * Reads a user's admin access from the server. `is_admin` still means full
 * admin — it is what gates ticket check-in and the role switcher — and it
 * implies every capability, so a full admin never needs explicit grants.
 */
export async function adminAccessFor(userId: string | null | undefined): Promise<AdminAccess> {
  if (!userId) return NO_ACCESS;

  if (await isAdminById(userId)) {
    return { full: true, capabilities: [...ALL_CAPABILITIES] };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("admin_capabilities")
    .select("capability")
    .eq("user_id", userId);

  if (error) {
    // A failed lookup must read as "no access", never as "everything".
    console.error("adminAccessFor failed:", error);
    return NO_ACCESS;
  }

  const capabilities = (data ?? [])
    .map((row) => row.capability)
    .filter(isAdminCapability);

  return { full: false, capabilities };
}

export function hasCapability(access: AdminAccess, required: AdminRequirement): boolean {
  return required === "full" ? access.full : access.capabilities.includes(required);
}

/** True when there is any reason to show this person the admin area at all. */
export function hasAnyAdminAccess(access: AdminAccess): boolean {
  return access.full || access.capabilities.length > 0;
}

/**
 * Whether one admin may change another's level.
 *
 * The single rule is that you may not change your own. A full admin who demotes
 * themselves may be the last one, and then nobody can grant anything again —
 * the recovery is a database console, which is not where a mis-click belongs.
 */
export function canChangeAdminLevel(
  actorId: string | null | undefined,
  targetId: string | null | undefined
): boolean {
  if (!actorId || !targetId) return false;
  return actorId !== targetId;
}
