import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { getResend, getFromEmail } from "@/lib/email/resend";
import { createClient } from "@supabase/supabase-js";
import { findGaps, type NightInput, type VenueDefault, type SeriesRules } from "@/lib/settlements/gaps";

/**
 * Skyddsnät: kvällar där en stående regel inte gäller trots att den borde.
 *
 * Arvet (trigger på listings) ger varje ny kväll lokalens avtal, seriens
 * stående koder och dess medarrangörer. Men arvet sker vid skapandet. En kväll
 * som kopplas till lokalen i efterhand, får en serie tilldelad senare, eller
 * vars avräkning ändras för hand, faller utanför. Det här jobbet letar upp
 * just de fallen.
 *
 * Skickar bara mejl när något avviker. Ett larm som går varje natt slutar
 * läsas — storage-backupen låg nere i trettio dagar för att ingen fick veta,
 * och motgiftet mot det är inte fler mejl utan mejl som betyder något.
 *
 * Fönstret är kommande kvällar plus de sju senaste. Passerade kvällar tas med
 * för att avräkningen betalas ut dagen efter: en kväll som varit i går kan
 * fortfarande rättas innan pengarna går.
 */

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function recipients(): string[] {
  const raw = process.env.PLATFORM_SALE_ALERT_TO || "pablo.acosta@usha.se";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  const today = new Date();
  const from = new Date(today.getTime() - 7 * 86400000).toISOString().slice(0, 10);

  const [defaultsRes, seriesCodesRes, seriesCollabRes, listingsRes] = await Promise.all([
    admin.from("venue_revenue_share_defaults").select("venue_profile_id, partner_percent, vat_rate, payout_delay_days"),
    admin.from("series_access_codes").select("series_slug, code").eq("is_active", true),
    admin.from("series_collaborators").select("series_slug, user_id"),
    admin
      .from("listings")
      .select("id, title, event_date, venue_profile_id, series_slug")
      .eq("is_active", true)
      .not("event_date", "is", null)
      .gte("event_date", from),
  ]);

  const listings = listingsRes.data ?? [];
  if (listings.length === 0) {
    return NextResponse.json({ checked: 0, gaps: 0 });
  }

  const ids = listings.map((l) => l.id);
  const [sharesRes, codesRes, collabRes] = await Promise.all([
    admin
      .from("event_revenue_shares")
      .select("listing_id, partner_profile_id, partner_percent, vat_rate, payout_delay_days")
      .in("listing_id", ids),
    admin.from("event_access_codes").select("listing_id, code").in("listing_id", ids).eq("is_active", true),
    admin
      .from("listing_collaborators")
      .select("listing_id, user_id")
      .in("listing_id", ids)
      .eq("status", "accepted"),
  ]);

  const shareByListing = new Map(
    (sharesRes.data ?? []).map((s) => [
      s.listing_id,
      {
        partnerProfileId: s.partner_profile_id as string,
        partnerPercent: s.partner_percent as number,
        vatRate: Number(s.vat_rate),
        payoutDelayDays: s.payout_delay_days as number,
      },
    ])
  );
  const codesByListing = new Map<string, string[]>();
  for (const c of codesRes.data ?? []) {
    codesByListing.set(c.listing_id, [...(codesByListing.get(c.listing_id) ?? []), c.code]);
  }
  const collabByListing = new Map<string, string[]>();
  for (const c of collabRes.data ?? []) {
    collabByListing.set(c.listing_id, [...(collabByListing.get(c.listing_id) ?? []), c.user_id]);
  }

  const nights: NightInput[] = listings.map((l) => ({
    id: l.id,
    title: l.title,
    eventDate: l.event_date as string,
    venueProfileId: l.venue_profile_id,
    seriesSlug: l.series_slug,
    share: shareByListing.get(l.id) ?? null,
    codes: codesByListing.get(l.id) ?? [],
    collaboratorUserIds: collabByListing.get(l.id) ?? [],
  }));

  const defaultRows = (defaultsRes.data ?? []) as unknown as {
    venue_profile_id: string; partner_percent: number; vat_rate: number | string; payout_delay_days: number;
  }[];
  const venueDefaults: VenueDefault[] = defaultRows.map((d) => ({
    venueProfileId: d.venue_profile_id,
    partnerPercent: d.partner_percent,
    vatRate: Number(d.vat_rate),
    payoutDelayDays: d.payout_delay_days,
  }));

  // De tre arvstabellerna kom till efter den senaste typgenereringen, och
  // src/types/database.ts har handskrivna exporter som en regenerering skulle
  // radera. Därför beskrivs raderna här i stället.
  const seriesCodeRows = (seriesCodesRes.data ?? []) as unknown as { series_slug: string; code: string }[];
  const seriesCollabRows = (seriesCollabRes.data ?? []) as unknown as { series_slug: string; user_id: string }[];

  const seriesMap = new Map<string, SeriesRules>();
  for (const c of seriesCodeRows) {
    const r = seriesMap.get(c.series_slug) ?? { seriesSlug: c.series_slug, codes: [], collaboratorUserIds: [] };
    r.codes.push(c.code);
    seriesMap.set(c.series_slug, r);
  }
  for (const c of seriesCollabRows) {
    const r = seriesMap.get(c.series_slug) ?? { seriesSlug: c.series_slug, codes: [], collaboratorUserIds: [] };
    r.collaboratorUserIds.push(c.user_id);
    seriesMap.set(c.series_slug, r);
  }

  const gaps = findGaps({ nights, venueDefaults, seriesRules: [...seriesMap.values()] });

  if (gaps.length === 0) {
    return NextResponse.json({ checked: nights.length, gaps: 0 });
  }

  for (const g of gaps) console.warn(`[settlement-gaps] ${g.eventDate} ${g.title}: ${g.detalj}`);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://usha.se";
  const rows = gaps
    .map(
      (g) =>
        `<tr><td style="padding:6px 10px;white-space:nowrap">${esc(g.eventDate)}</td>` +
        `<td style="padding:6px 10px"><a href="${appUrl}/app/events/${g.listingId}/settlement">${esc(g.title)}</a></td>` +
        `<td style="padding:6px 10px">${esc(g.detalj)}</td></tr>`
    )
    .join("");

  const { error } = await getResend().emails.send({
    from: getFromEmail(),
    to: recipients(),
    subject: `Usha: ${gaps.length} kväll${gaps.length === 1 ? "" : "ar"} följer inte en stående regel`,
    html:
      `<h2>Stående regler som inte gäller</h2>` +
      `<p>Nya kvällar ärver lokalens avtal och seriens stående regler när de skapas. ` +
      `Kvällarna nedan gör det inte — de har antagligen ändrats i efterhand.</p>` +
      `<table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">${rows}</table>` +
      `<p style="color:#666;font-size:12px">Det här mejlet skickas bara när något avviker. Tystnad betyder att allt stämmer.</p>`,
  });

  if (error) {
    console.error("[settlement-gaps] kunde inte skicka mejl:", error);
    return NextResponse.json({ checked: nights.length, gaps: gaps.length, mailed: false }, { status: 500 });
  }

  return NextResponse.json({ checked: nights.length, gaps: gaps.length, mailed: true });
}
