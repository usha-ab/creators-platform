import type { SupabaseClient } from "@supabase/supabase-js";
import { stockholmDay } from "@/lib/tickets/event-day";
import { passRemaining } from "./series-pass";

/**
 * Förlängd giltighet när säljaren ställer in en kväll (Pablos beslut 3,
 * 2026-11-25, och juristens text i villkoren punkt 5).
 *
 * Klipp som köparen själv inte använder brinner inne. Men när det är säljaren
 * som inte erbjuder kvällen får förfallet inte slå igenom (direktiv 93/13,
 * bilagan p. 1 b och f): då förlängs kortet med motsvarande tid.
 *
 * "Inställd" i Plattformen = en kväll i serien som avpubliceras (is_active
 * sätts till false) innan den har ägt rum. En egen knapp för att ställa in
 * finns inte. Serierna går en gång i veckan, så motsvarande tid är en vecka per
 * inställd kväll. Varje kort förlängs högst en gång per kväll, även om kvällen
 * avpubliceras och publiceras igen (unique i pass_expiry_extensions).
 */
export const CANCELED_EVENING_EXTENSION_DAYS = 7;

export interface ExtensionCandidate {
  id: string;
  status: string | null;
  created_at: string | null;
  pass_expires_at: string | null;
  sessions_total: number | null;
  sessions_redeemed: number | null;
}

/**
 * Ska kortet förlängas för en inställd kväll den `eventDate`? Bara aktiva kort
 * med klipp kvar, köpta före kvällen och giltiga på kvällen. Kort utan
 * slutdatum gäller tills vidare och behöver ingen förlängning.
 */
export function shouldExtend(b: ExtensionCandidate, eventDate: string): boolean {
  if (b.status !== "confirmed") return false;
  if (!b.pass_expires_at || (b.sessions_total ?? 0) <= 0) return false;
  if (passRemaining(b) <= 0) return false;
  if (b.created_at && stockholmDay(new Date(b.created_at)) > eventDate) return false;
  return stockholmDay(new Date(b.pass_expires_at)) >= eventDate;
}

export function extendedExpiry(expiresAt: string, days = CANCELED_EVENING_EXTENSION_DAYS): string {
  return new Date(new Date(expiresAt).getTime() + days * 24 * 3600_000).toISOString();
}

/**
 * Förläng alla berörda kort när kvällen `listingId` ställs in. Returnerar hur
 * många kort som förlängdes. Fel loggas och stoppar aldrig avpubliceringen.
 */
export async function extendPassesForCanceledEvening(
  admin: SupabaseClient,
  listingId: string,
  now: Date = new Date()
): Promise<number> {
  try {
    const { data: evening } = await admin
      .from("listings")
      .select("id, series_id, event_date")
      .eq("id", listingId)
      .maybeSingle();
    const seriesId = evening?.series_id as string | null | undefined;
    const eventDate = evening?.event_date ? String(evening.event_date).slice(0, 10) : null;
    // En kväll som redan varit ställs inte in i efterhand.
    if (!seriesId || !eventDate || eventDate < stockholmDay(now)) return 0;

    const { data: passes } = await admin
      .from("listings")
      .select("id")
      .or(`pass_series_id.eq.${seriesId},pass_series_ids.cs.{${seriesId}}`);
    const passIds = (passes ?? []).map((p: { id: string }) => p.id);
    if (passIds.length === 0) return 0;

    const { data: cards } = await admin
      .from("bookings")
      .select("id, status, created_at, pass_expires_at, sessions_total, sessions_redeemed")
      .in("listing_id", passIds)
      .eq("status", "confirmed")
      .not("pass_expires_at", "is", null);

    let extended = 0;
    for (const card of (cards ?? []) as ExtensionCandidate[]) {
      if (!shouldExtend(card, eventDate)) continue;
      const { error: insErr } = await admin.from("pass_expiry_extensions").insert({
        booking_id: card.id,
        listing_id: listingId,
        days: CANCELED_EVENING_EXTENSION_DAYS,
        previous_expires_at: card.pass_expires_at,
      });
      // 23505: kortet är redan förlängt för den här kvällen.
      if (insErr) {
        if ((insErr as { code?: string }).code !== "23505") console.error("Förlängningen kunde inte antecknas:", insErr);
        continue;
      }
      const { error: updErr } = await admin
        .from("bookings")
        .update({ pass_expires_at: extendedExpiry(card.pass_expires_at!) })
        .eq("id", card.id);
      if (updErr) console.error("Kortets giltighet kunde inte förlängas:", updErr);
      else extended++;
    }
    return extended;
  } catch (err) {
    console.error("Förlängning av klippkort vid inställd kväll misslyckades:", err);
    return 0;
  }
}
