import type { SupabaseClient } from "@supabase/supabase-js";

/** Kreatörens serier (en rad per serie, senaste titeln), för klippkortsformuläret. */
export async function creatorSeriesOptions(
  supabase: SupabaseClient,
  userId: string
): Promise<{ id: string; title: string }[]> {
  const { data } = await supabase
    .from("listings")
    .select("series_id, title")
    .eq("user_id", userId)
    .not("series_id", "is", null)
    .order("event_date", { ascending: false });
  const seen = new Map<string, { id: string; title: string }>();
  for (const r of (data ?? []) as { series_id: string | null; title: string }[]) {
    if (r.series_id && !seen.has(r.series_id)) seen.set(r.series_id, { id: r.series_id, title: r.title });
  }
  return [...seen.values()];
}
