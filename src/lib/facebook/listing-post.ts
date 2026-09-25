interface ListingForPost {
  id: string;
  title: string;
  description: string | null;
  price: number | null;
  slug: string | null;
}

/**
 * The text used when publishing a listing as a Facebook page post — shared by
 * the manual "Publicera på Facebook" action and the auto-reminder cron so the
 * "Boka här" link and formatting stay identical in one place.
 *
 * Inga emoji. Texten härifrån kopieras vidare för hand — in i ett riktigt
 * Facebook-evenemang, som vi inte kan skapa via API sedan Events-API:t stängdes.
 * På den vägen tappade 💰 och 👉 sin kodning och blev ersättningstecken (�) i
 * ett publicerat evenemang. Ett par ikoner är inte värda den risken när texten
 * ändå ska läsas av besökare, så etiketterna står i klartext i stället.
 */
export function buildListingPostMessage(listing: ListingForPost, appUrl: string): string {
  const priceText = listing.price ? `\nPrice: ${listing.price} SEK` : "\nFree entry";
  const eventUrl = listing.slug
    ? `${appUrl}/event/${listing.slug}`
    : `${appUrl}/listing/${listing.id}`;
  return `${listing.title}\n\n${listing.description ?? ""}${priceText}\n\nReserve your spot: ${eventUrl}`;
}
