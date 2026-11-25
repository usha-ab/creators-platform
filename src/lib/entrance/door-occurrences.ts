import type { createClient } from "@/lib/supabase/server";
import type { DoorOccurrence } from "@/lib/entrance/door-link";

/**
 * Seriens aktiva, publika kvällar i datumordning. Faller tillbaka på den råa
 * serienyckeln när aliaset inte ger något — gamla nycklar sitter på utskrivna
 * koder och får inte dö (se lib/listings/series-aliases.ts).
 */
export async function hamtaKvallar(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kanonisk: string,
  rå: string
): Promise<(DoorOccurrence & { id: string; series_id: string | null; user_id: string })[]> {
  const fraga = (slug: string) =>
    supabase
      .from("listings")
      .select("id, slug, title, event_date, series_id, user_id")
      .eq("series_slug", slug)
      .eq("is_active", true)
      .eq("is_public", true)
      .order("event_date", { ascending: true });

  const { data } = await fraga(kanonisk);
  const rader = (data as (DoorOccurrence & { id: string; series_id: string | null; user_id: string })[] | null) ?? [];
  if (rader.length > 0 || kanonisk === rå) return rader;
  const { data: fallback } = await fraga(rå);
  return (fallback as (DoorOccurrence & { id: string; series_id: string | null; user_id: string })[] | null) ?? [];
}

export interface DoorScreenTicket {
  id: string;
  name: string;
  price: number;
  sort_order: number | null;
}

/**
 * Vad dörrlänken för en biljettyp ska heta. Sorteringsnumret när det är unikt
 * för kvällen — då spelar namnet ingen roll och koden överlever att typen döps
 * om. Annars namnet, som dörrlänken matchar på början av.
 */
export function platsFor(t: DoorScreenTicket, alla: readonly DoorScreenTicket[]): string {
  const sammaNummer = alla.filter((x) => (x.sort_order ?? 0) === (t.sort_order ?? 0)).length;
  return sammaNummer === 1 ? String(t.sort_order ?? 0) : encodeURIComponent(t.name);
}

export interface DoorPass {
  id: string;
  title: string;
  price: number;
  session_count: number;
}

/** Seriens klippkort som går att köpa, billigast först. Samma urval som eventsidan. */
export async function hamtaKort(
  supabase: Awaited<ReturnType<typeof createClient>>,
  seriesId: string | null
): Promise<DoorPass[]> {
  if (!seriesId) return [];
  const { data } = await supabase
    .from("listings")
    .select("id, title, price, session_count")
    .or(`pass_series_id.eq.${seriesId},pass_series_ids.cs.{${seriesId}}`)
    .eq("is_active", true)
    .eq("is_public", true)
    .order("price", { ascending: true });
  return ((data ?? []) as { id: string; title: string; price: number | null; session_count: number | null }[])
    .filter((k) => (k.session_count ?? 0) > 0)
    .map((k) => ({ id: k.id, title: k.title, price: k.price ?? 0, session_count: k.session_count ?? 0 }));
}

/**
 * Dörrlänkens plats för ett klippkort: "kort-" + början av id:t. Kortets namn
 * ändras när antalet klipp räknas om, så namnet duger inte som adress.
 */
export const KORT_PREFIX = "kort-";
export function platsForKort(id: string): string {
  return `${KORT_PREFIX}${id.slice(0, 8)}`;
}
