// Automatisk uppdatering av Facebook-inlägget när ett evenemang ändras.
//
// Bakgrund: appen skapar INTE Facebook-evenemang — Facebook stängde det
// API:et. Den publicerar sidinlägg, och kolumnen heter facebook_event_id
// trots att den håller ett inläggs-id (sidId_inläggsId).
//
// Synken har krävt ett knapptryck, vilket är lätt att glömma. Då står ett
// inlägg kvar med gammal tid eller fel pris medan appen säger något annat.
//
// TVÅ MEDVETNA BEGRÄNSNINGAR:
//
// 1. Vi UPPDATERAR bara inlägg som redan finns. Att publicera automatiskt
//    vid varje nytt evenemang vore att posta på sidan utan att någon valt
//    det. Att hålla ett löfte man redan gett är en annan sak än att ge ett
//    nytt. Första publiceringen förblir knappen.
//
// 2. Bara när texten faktiskt skulle ändras. buildListingPostMessage läser
//    title, description, price och slug — ändras inget av dem blir inlägget
//    identiskt, och då rör vi inte Facebook alls.
//
// Fel här får aldrig stoppa en sparning. Anroparen väntar inte in oss.

import { buildListingPostMessage } from "@/lib/facebook/listing-post";

/** Fälten som påverkar inläggstexten. Ändras inget av dem finns inget att synka. */
export const POST_RELEVANT_FIELDS = ["title", "description", "price", "slug"] as const;

/**
 * Skulle den här uppdateringen ändra inläggets text?
 *
 * updateData innehåller bara de fält som faktiskt skrivs, så det räcker att
 * se efter om någon av de textbärande nycklarna finns med.
 */
export function touchesPost(updateData: Record<string, unknown>): boolean {
  return POST_RELEVANT_FIELDS.some((f) => f in updateData);
}

interface ListingRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  price: number | null;
  slug: string | null;
  is_active: boolean;
  facebook_event_id: string | null;
}

interface AdminLike {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: unknown }>;
      };
    };
  };
}

/**
 * Uppdatera sidinlägget så det matchar evenemanget. Tyst no-op när något
 * saknas — inget inlägg, ingen koppling, inaktivt evenemang.
 *
 * Returnerar vad som hände, så anroparen kan logga utan att tolka.
 */
export async function syncListingPost(
  admin: AdminLike,
  listingId: string,
  appUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ status: "uppdaterad" | "hoppades_över" | "fel"; skäl?: string }> {
  const { data } = await admin
    .from("listings")
    .select("id, user_id, title, description, price, slug, is_active, facebook_event_id")
    .eq("id", listingId)
    .maybeSingle();

  const listing = data as ListingRow | null;
  if (!listing) return { status: "hoppades_över", skäl: "evenemanget hittades inte" };
  if (!listing.facebook_event_id) {
    return { status: "hoppades_över", skäl: "aldrig publicerat på Facebook" };
  }
  if (!listing.is_active) {
    // Ett avpublicerat evenemang lämnar vi. Att tyst ändra ett inlägg som
    // folk redan sett är inte vår sak att göra automatiskt.
    return { status: "hoppades_över", skäl: "evenemanget är inte aktivt" };
  }

  const { data: connRaw } = await admin
    .from("social_connections")
    .select("facebook_page_access_token")
    .eq("user_id", listing.user_id)
    .maybeSingle();

  const token = (connRaw as { facebook_page_access_token: string | null } | null)
    ?.facebook_page_access_token;
  if (!token) return { status: "hoppades_över", skäl: "ingen Facebook-sida ansluten" };

  const message = buildListingPostMessage(listing, appUrl);

  try {
    const res = await fetchImpl(
      `https://graph.facebook.com/v22.0/${listing.facebook_event_id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, access_token: token }),
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return {
        status: "fel",
        skäl: (err as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`,
      };
    }
    return { status: "uppdaterad" };
  } catch (e) {
    return { status: "fel", skäl: e instanceof Error ? e.message : "okänt fel" };
  }
}
