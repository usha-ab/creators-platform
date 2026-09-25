import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Läser `calendar_min_supply` från app_config: hur många distinkta kommande
 * händelser (en serie = en) som krävs innan kalenderlänken visas i menyn.
 * Samma mönster som matching_access — ändra i databasen, ingen deploy.
 */
export const DEFAULT_CALENDAR_MIN_SUPPLY = 5;

const TTL_MS = 5 * 60_000;
let cached: { value: number; at: number } | null = null;

export async function getCalendarMinSupply(): Promise<number> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.value;

  let value = DEFAULT_CALENDAR_MIN_SUPPLY;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("app_config")
      .select("value")
      .eq("key", "calendar_min_supply")
      .maybeSingle();
    const n = Number(data?.value);
    if (Number.isFinite(n) && n >= 0) value = n;
  } catch {
    // behåll standardvärdet vid läsfel
  }

  cached = { value, at: now };
  return value;
}

/** Test/ops: töm cachen så nästa läsning går mot databasen. */
export function clearCalendarMinSupplyCache() {
  cached = null;
}
