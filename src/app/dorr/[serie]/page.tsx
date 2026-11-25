import type { Metadata } from "next";
import { stockholmToday } from "@/lib/time";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { canonicalSeriesSlug } from "@/lib/listings/series-aliases";
import { pickOccurrence } from "@/lib/entrance/door-link";
import { hamtaKort, hamtaKvallar, platsFor, platsForKort, type DoorScreenTicket } from "@/lib/entrance/door-occurrences";
import { DoorScreen } from "./door-screen";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { canOperateEntrance } from "@/lib/scan-access";
import { entryCountsLabels } from "@/lib/tickets/entry-counts-labels";

/**
 * Dörrskärmen: /dorr/<serie>
 *
 * Plattan i dörren. Visar kvällens biljetter som stora knappar; ett tryck ger
 * en QR-kod som gästen skannar och betalar i sin egen telefon.
 *
 * Läses ur databasen vid varje sidladdning. Tidigare låg skärmen som en
 * fristående sida med biljetterna inskrivna för hand, och den visade det gamla
 * programmet (practica/workshop/social/allt) långt efter att kvällarna blivit
 * "hela kvällen". Nu räcker det att ladda om för att se det som faktiskt säljs.
 *
 * Koderna pekar på /dorr/<serie>/<plats>, som myntar en egen betalning per
 * skanning — samma kod fungerar för hur många gäster som helst.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dörren – Usha",
  robots: { index: false, follow: false },
};

type Params = { params: Promise<{ serie: string }> };

export default async function DoorScreenPage({ params }: Params) {
  const { serie } = await params;
  const kanonisk = canonicalSeriesSlug(serie);
  const supabase = await createClient();

  const kvallar = await hamtaKvallar(supabase, kanonisk, serie);
  const kvall = pickOccurrence(kvallar, stockholmToday()) as (typeof kvallar)[number] | null;

  if (!kvall) {
    return <DoorScreen title={null} dateLabel={null} isToday={false} tickets={[]} passes={[]} />;
  }

  const { data: typer } = await supabase
    .from("ticket_types")
    .select("id, name, price, sort_order, capacity, tickets_sold")
    .eq("listing_id", kvall.id)
    .order("sort_order", { ascending: true });

  const alla = ((typer ?? []) as (DoorScreenTicket & { capacity: number | null; tickets_sold: number | null })[]);
  const kopbara = alla.filter((t) => t.capacity == null || (t.tickets_sold ?? 0) < t.capacity);

  const bas = (process.env.NEXT_PUBLIC_APP_URL || "https://usha.se").replace(/\/$/, "");
  // Felkorrigering M: tål reflexer på en skärm i en bar utan att mönstret
  // blir så tätt att en gammal telefonkamera tappar det.
  const qr = (url: string) =>
    QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 4, color: { dark: "#0B0A0D", light: "#FFFFFF" } });

  const tickets = await Promise.all(
    kopbara.map(async (t) => {
      const url = `${bas}/dorr/${kanonisk}/${platsFor(t, alla)}`;
      return { id: t.id, name: t.name, price: t.price, sub: null, url, svg: await qr(url) };
    })
  );

  // Klippkorten säljs på kvällens eventsida; koden tar gästen dit med kortet valt.
  const kort = await hamtaKort(supabase, kvall.series_id ?? null);
  const passes = await Promise.all(
    kort.map(async (k) => {
      const url = `${bas}/dorr/${kanonisk}/${platsForKort(k.id)}`;
      return {
        id: k.id,
        name: k.title.replace(/^.*?–\s*/, ""),
        price: k.price,
        sub: `${Math.round(k.price / k.session_count)} kr per kväll`,
        url,
        svg: await qr(url),
      };
    })
  );

  // Räknaren och kvällens färg bara för den som får sköta entrén. Sidan är
  // publik (plattan vänd mot gästerna), och en färg som vem som helst kan slå
  // upp i förväg vore ingen kontroll. Är plattan inloggad med skanningsrätt
  // syns de; annars ser sidan ut som förut.
  const user = await getCurrentUser();
  const entry =
    user && kvall.user_id && (await canOperateEntrance(createAdminClient(), user.id, { id: kvall.id, user_id: kvall.user_id }))
      ? { listingId: kvall.id, labels: await entryCountsLabels() }
      : null;

  const datum = String(kvall.event_date).slice(0, 10);
  const dateLabel = new Date(`${datum}T12:00:00`).toLocaleDateString("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <DoorScreen
      title={kvall.title}
      dateLabel={dateLabel}
      isToday={datum === stockholmToday()}
      tickets={tickets}
      passes={passes}
      entry={entry}
    />
  );
}
