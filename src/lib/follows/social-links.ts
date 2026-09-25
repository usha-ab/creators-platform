import { createAdminClient } from "@/lib/supabase/admin";

/**
 * "Följ oss"-länkarna, från app_config.social_links. Null/tom = visas inte,
 * så Instagram kan tändas den dag kontot finns utan deploy. Cachat 5 min som
 * övriga flaggor.
 */
export interface SocialLinks {
  facebook?: string;
  instagram?: string;
  tiktok?: string;
}

const TTL_MS = 5 * 60_000;
let cached: { value: SocialLinks; at: number } | null = null;

function clean(v: unknown): string | undefined {
  return typeof v === "string" && /^https:\/\//.test(v.trim()) ? v.trim() : undefined;
}

export async function getSocialLinks(): Promise<SocialLinks> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.value;

  let value: SocialLinks = {};
  try {
    const { data } = await createAdminClient().from("app_config").select("value").eq("key", "social_links").maybeSingle();
    const v = (data?.value ?? {}) as Record<string, unknown>;
    value = { facebook: clean(v.facebook), instagram: clean(v.instagram), tiktok: clean(v.tiktok) };
  } catch {
    // inga länkar vid läsfel
  }
  cached = { value, at: now };
  return value;
}

export function clearSocialLinksCache() {
  cached = null;
}
