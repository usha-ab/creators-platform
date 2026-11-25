import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canonicalSeriesSlug } from "@/lib/listings/series-aliases";
import {
  pickOccurrence,
  pickTicketType,
  doorTarget,
  type DoorOccurrence,
  type DoorTicketType,
} from "@/lib/entrance/door-link";
import { stockholmToday } from "@/lib/time";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLateCheckoutSession } from "@/lib/tickets/late-checkout";
import { getStripeLocale } from "@/lib/i18n/stripe-locale";
import { hamtaKort, hamtaKvallar, KORT_PREFIX } from "@/lib/entrance/door-occurrences";

/**
 * Dörrlänk: /dorr/<serie>/<plats>
 *
 * En adress som aldrig behöver bytas ut. Den slår upp nästa kväll i serien och
 * biljettypen på den platsen, och skickar gästen rakt till köpet. Se
 * lib/entrance/door-link.ts för varför den inte pekar på en kväll.
 *
 * Exempel: /dorr/the-lab-torsdag/workshop
 */

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ serie: string; plats: string }> };

export default async function DoorLinkPage({ params }: Params) {
  const { serie, plats } = await params;
  const supabase = await createClient();

  // Samma aliashantering som seriesidan: gamla serienycklar sitter på
  // utskrivna koder och får inte dö. Se lib/listings/series-aliases.ts.
  const kanonisk = canonicalSeriesSlug(serie);
  const occurrences = await hamtaKvallar(supabase, kanonisk, serie);
  if (occurrences.length === 0) notFound();

  const kvall = pickOccurrence(occurrences, stockholmToday());
  // Serien har tagit slut, eller allt som återstår är inställt. Seriesidan
  // säger det bättre än en 404 gör.
  if (!kvall) redirect(`/series/${kanonisk}`);

  // Klippkort säljs på kvällens eventsida, inte via genvägen nedan. Gästen
  // landar med kortet förvalt; hittas det inte, på biljettrutan ändå.
  if (plats.startsWith(KORT_PREFIX)) {
    const prefix = plats.slice(KORT_PREFIX.length).toLowerCase();
    const kort = prefix
      ? (await hamtaKort(supabase, (kvall as { series_id?: string | null }).series_id ?? null)).find((k) =>
          k.id.startsWith(prefix)
        )
      : undefined;
    redirect(kort ? `/event/${kvall.slug}?kort=${kort.id}#biljetter` : doorTarget(kvall.slug, null));
  }

  const { data: typer } = await supabase
    .from("ticket_types")
    .select("id, name, sort_order, capacity, tickets_sold")
    .eq("listing_id", (kvall as DoorOccurrence & { id: string }).id)
    .order("sort_order", { ascending: true });

  const vald = pickTicketType((typer as DoorTicketType[] | null) ?? [], plats);

  // GENVÄGEN: skapa betalningen här och skicka gästen rakt till Stripe.
  //
  // Vägen hit var tidigare omdirigering → eventsida (136 kB, ~2,8 s) → fyll i
  // mejladress → tryck köp → ännu en omdirigering → Stripe. I en dörr, på en
  // telefon i dunkelt ljus, tog det långt över en minut. Nu blir det skanna,
  // betala, klart — och med plånbok utan ett enda tecken att skriva.
  //
  // Varje skanning myntar sin EGEN session, så samma QR-kod på skärmen kan
  // användas av hur många gäster som helst. Det är därför koden pekar hit och
  // inte på en färdig Stripe-adress.
  const kortvag = await dorrGenvag(kvall as DoorOccurrence & { id: string }, vald);
  if (kortvag) redirect(kortvag);

  redirect(doorTarget(kvall.slug, vald?.id ?? null));
}

/**
 * Betalningslänken för en skanning, eller null när genvägen inte gäller.
 *
 * Faller medvetet tillbaka på eventsidan i stället för att visa ett fel. En
 * gäst som står i dörren ska aldrig mötas av en återvändsgränd — hellre den
 * långa vägen än ingen väg.
 */
async function dorrGenvag(
  kvall: DoorOccurrence & { id: string },
  vald: DoorTicketType | null
): Promise<string | null> {
  // Utan träffad biljettyp vet vi inte vad gästen ska betala för.
  if (!vald) return null;

  const admin = createAdminClient();
  const { data: listing } = await admin
    .from("listings")
    .select(
      "id, title, price, user_id, event_date, event_time, event_end_time, series_slug, service_fee_mode, capacity, vat_rate"
    )
    .eq("id", kvall.id)
    .maybeSingle();
  if (!listing) return null;

  // Kvällar med tak går den gamla vägen.
  //
  // Den publika kassan reserverar platsen INNAN betalningen och släpper den om
  // köpet rinner ut i sanden. Genvägen gör inte det — den räknar upp först när
  // pengarna kommit — vilket är rätt när taket är obegränsat men skulle kunna
  // sälja fler biljetter än det finns plats för när det inte är det.
  if (listing.capacity !== null) return null;

  const { data: creator } = await admin
    .from("profiles")
    .select(
      "stripe_account_id, stripe_card_payments_enabled, is_usha_owned_seller, " +
        "company_name, org_number, full_name, company_verified_at, tier, creator_subcategory, terms_url"
    )
    .eq("id", listing.user_id)
    .maybeSingle();
  if (!creator) return null;

  const { data: tt } = await admin
    .from("ticket_types")
    .select("id, name, price")
    .eq("id", vald.id)
    .maybeSingle();

  const result = await createLateCheckoutSession({
    listing: listing as unknown as Parameters<typeof createLateCheckoutSession>[0]["listing"],
    creator: creator as unknown as Parameters<typeof createLateCheckoutSession>[0]["creator"],
    ticketType: (tt as { id: string; name: string; price: number } | null) ?? null,
    appUrl: process.env.NEXT_PUBLIC_APP_URL || "https://usha.se",
    locale: await getStripeLocale(),
    mode: "dorr",
  });

  return result.ok ? result.url : null;
}
