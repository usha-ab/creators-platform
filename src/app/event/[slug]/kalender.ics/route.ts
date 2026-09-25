import { createClient } from "@/lib/supabase/server";
import { buildEventsCalendarIcs } from "@/lib/email/ics";
import { splitBilingualDescription } from "@/lib/listings/description";

/**
 * En kalenderpost för ett enskilt evenemang.
 *
 * Adressen slutar på .ics med flit: iOS och macOS känner igen ändelsen och
 * öppnar Kalender direkt, medan en /api-väg utan ändelse oftare landar som en
 * namnlös nedladdning.
 *
 * Tiderna skrivs som flytande lokaltid (ingen Z). Ett evenemang lagras utan
 * tidszon och 17:00 betyder 17:00 där kvällen hålls — skrev vi UTC skulle
 * posten flytta sig för den som har telefonen inställd på en annan zon.
 */
function isUUID(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: listing } = await supabase
    .from("listings")
    .select("id, title, slug, description, event_date, event_time, event_end_time, event_location")
    .eq(isUUID(slug) ? "id" : "slug", slug)
    .eq("is_active", true)
    .eq("is_public", true)
    .maybeSingle();

  if (!listing || !listing.event_date) {
    return new Response("Not found", { status: 404 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://usha.se";
  const url = `${appUrl}/event/${listing.slug || listing.id}`;

  // Bara förstaspråket. En tvåspråkig beskrivning skulle annars fylla
  // kalenderposten med samma text två gånger.
  const text = splitBilingualDescription(listing.description).primary;

  const ics = buildEventsCalendarIcs(listing.title, [
    {
      // Stabilt UID: lägger någon till posten igen uppdateras den befintliga
      // i stället för att en dubblett dyker upp i kalendern.
      uid: `event-${listing.id}@usha.se`,
      title: listing.title,
      dateStr: listing.event_date,
      timeStr: listing.event_time ? listing.event_time.slice(0, 5) : null,
      endTimeStr: listing.event_end_time ? listing.event_end_time.slice(0, 5) : null,
      location: listing.event_location,
      description: text ? `${text.slice(0, 600)}\n\n${url}` : url,
      url,
    },
  ]);

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${(listing.slug || listing.id).slice(0, 60)}.ics"`,
      // Tiderna ändras sällan, men en flyttad kväll ska slå igenom samma dag.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
