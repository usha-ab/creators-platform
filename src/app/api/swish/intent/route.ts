import { NextRequest, NextResponse } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { swishIntentGate } from "@/lib/swish/intent-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { rateLimit, getRateLimitKey } from "@/lib/rate-limit";
import { notifyEntranceSwishRequest } from "@/lib/notifications/event-owner";
import { swishOfferForListing } from "@/lib/swish/availability";
import { swishPaymentUrl } from "@/lib/swish/config";
import { sendSwishPendingEmail } from "@/lib/email/send-swish-pending";
import { stockholmLocalToUtcISO } from "@/lib/time";
import { isCommerceEnabled } from "@/lib/swish/commerce/config";
import { loadSeatCounts, pendingSwishSeats, swishSeatsLeft, type SeatResult } from "@/lib/swish/seats";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Fler obekräftade Swish-köp än så på samma adress är ett fel, inte ett köp. */
const MAX_PENDING_PER_EMAIL = 3;

/**
 * POST /api/swish/intent — "Jag har swishat" på eventsidan.
 * { listingId, ticketTypeId?, quantity?, name?, email }
 *
 * Swish Företag har inget API vi kan fråga, så betalningen syns bara i
 * bolagets Swish-app. Här skapas därför en VILANDE bokning (status pending,
 * payment_method swish) med namnet och adressen gästen angav, INNAN gästen
 * swishar: biljettsidan /biljett/[id] är där betalningen görs och där QR-koden
 * sedan dyker upp. Ett mejl går direkt med samma instruktioner, så att gästen
 * har något i handen. Den som sköter entrén ser bokningen under "Swish att
 * bekräfta", jämför mot Swish-appen och bekräftar — först då räknas
 * biljetten, mejlas QR-koden och kan skannas.
 *
 * Inget räknas i tickets_sold här: en vilande bokning är ett löfte från
 * gästen, inte en betalning.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(getRateLimitKey(req, "swish-intent"), 10, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let payload: { listingId?: string; ticketTypeId?: string | null; quantity?: number; name?: string; email?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "badRequest" }, { status: 400 });
  }
  const listingId = String(payload.listingId ?? "");
  if (!UUID.test(listingId)) return NextResponse.json({ error: "badRequest" }, { status: 400 });
  const quantity = Math.min(10, Math.max(1, Math.round(Number(payload.quantity) || 1)));
  const name = String(payload.name ?? "").trim().slice(0, 120) || null;
  const email = String(payload.email ?? "").trim().toLowerCase().slice(0, 254);
  if (!EMAIL.test(email)) return NextResponse.json({ error: "invalidEmail" }, { status: 400 });

  const admin = createAdminClient();
  const { data: listing } = await admin
    .from("listings")
    .select(
      "id, user_id, title, price, event_date, event_time, event_end_time, is_active, is_public, capacity, tickets_sold, early_bird_start, early_bird_end, early_bird_price, public_sale_at"
    )
    .eq("id", listingId)
    .maybeSingle();
  if (!listing || !listing.is_active || !listing.is_public) return NextResponse.json({ error: "notFound" }, { status: 404 });

  // Samma köpgräns som kortkassan: aldrig en passerad kväll, inte före
  // släppet, inte slutsålt. Efterköp ("Var du där?") går bara med kort.
  const gate = swishIntentGate(listing, new Date());
  if (!gate.ok) {
    const te = await getTranslations("eventErrors");
    return NextResponse.json({ error: gate.code, message: te(gate.code) }, { status: gate.status });
  }

  const offer = await swishOfferForListing(admin, listing);
  if (!offer) return NextResponse.json({ error: "swishUnavailable" }, { status: 400 });

  let ticketType: { id: string; name: string; price: number; capacity: number | null; tickets_sold: number | null } | null = null;
  if (payload.ticketTypeId) {
    if (!UUID.test(payload.ticketTypeId)) return NextResponse.json({ error: "badRequest" }, { status: 400 });
    const { data: tt } = await admin
      .from("ticket_types")
      .select("id, name, price, capacity, tickets_sold")
      .eq("id", payload.ticketTypeId)
      .eq("listing_id", listingId)
      .maybeSingle();
    if (!tt) return NextResponse.json({ error: "badRequest" }, { status: 400 });
    ticketType = tt as { id: string; name: string; price: number; capacity: number | null; tickets_sold: number | null };
  }
  // Som kortkassan: biljettypens pris, annars sale-states (förköpspris under fönstret).
  const unit = ticketType ? Number(ticketType.price) : gate.price;
  if (unit <= 0) return NextResponse.json({ error: "noPrice" }, { status: 400 });
  const amountOre = Math.round(unit * 100) * quantity;

  // Samma adress och samma kväll: återanvänd den vilande bokningen i stället
  // för att lägga en ny för varje tryck. Och fler än några vilande på samma
  // adress är inte köp utan brus.
  const { data: pending } = await admin
    .from("bookings")
    .select("id, listing_id")
    .eq("guest_email", email)
    .eq("payment_method", "swish")
    .eq("status", "pending");
  const existing = (pending ?? []).find((b) => b.listing_id === listing.id);
  if (existing) return NextResponse.json({ bookingId: existing.id, amountOre, reused: true, ticketUrl: `/biljett/${existing.id}` });
  if ((pending ?? []).length >= MAX_PENDING_PER_EMAIL) return NextResponse.json({ error: "tooManyPending" }, { status: 429 });

  // Platser kvar, som kortkassan: kapacitet minus sålda och reserverade
  // (tickets_sold) — och här även de vilande Swish-köpen, som inte finns i
  // tickets_sold förrän entrén bekräftar dem. Se lib/swish/seats.ts.
  const seatsFor = async (ownBookingId?: string): Promise<SeatResult> => {
    const [counts, pending] = await Promise.all([
      loadSeatCounts(admin, listing.id, ticketType?.id ?? null),
      pendingSwishSeats(admin, listing.id),
    ]);
    return swishSeatsLeft({ ...counts, pending, quantity, ownBookingId });
  };
  const seatsDenied = async (left: number) => {
    const te = await getTranslations("eventErrors");
    return left > 0
      ? NextResponse.json({ error: "notEnoughSeats", left, message: te("notEnoughSeats", { left }) }, { status: 409 })
      : NextResponse.json({ error: "soldOut", left: 0, message: te("soldOut") }, { status: 409 });
  };
  let before: SeatResult;
  try {
    before = await seatsFor();
  } catch (e) {
    console.error("Swish intent seat check failed:", e);
    return NextResponse.json({ error: "createFailed" }, { status: 500 });
  }
  if (!before.ok) return seatsDenied(before.left);

  const user = await getCurrentUser();
  const scheduledAt =
    (listing.event_date && stockholmLocalToUtcISO(`${listing.event_date}T${listing.event_time ?? "00:00:00"}`)) || new Date().toISOString();

  const { data: booking, error } = await admin
    .from("bookings")
    .insert({
      listing_id: listing.id,
      creator_id: listing.user_id,
      customer_id: user?.id ?? null,
      guest_name: name,
      guest_email: email,
      status: "pending",
      scheduled_at: scheduledAt,
      booking_type: "ticket",
      payment_method: "swish",
      amount_paid: amountOre,
      platform_fee_amount: 0,
      guest_count: quantity,
      ticket_type_id: ticketType?.id ?? null,
      ticket_type_name: ticketType?.name ?? null,
      notes: "Swish via eventsidan, väntar på att kvittot bekräftas",
    })
    .select("id")
    .single();
  if (error || !booking) {
    console.error("Swish intent insert failed:", error);
    return NextResponse.json({ error: "createFailed" }, { status: 500 });
  }

  // Kapplöpningen: två köp kan ha passerat kontrollen ovan samtidigt. Räkna
  // igen med bara de vilande som kom före den här bokningen; hamnar den över
  // gränsen avbokas den, innan något mejl eller någon notis gått ut.
  let after: SeatResult;
  try {
    after = await seatsFor(booking.id);
  } catch (e) {
    console.error("Swish intent seat recheck failed:", e);
    after = { ok: true, left: null }; // Första kontrollen höll; bokningen är bara vilande.
  }
  if (!after.ok) {
    await admin
      .from("bookings")
      .update({ status: "canceled", notes: "Swish via eventsidan, avbokad direkt: platserna tog slut under köpet" })
      .eq("id", booking.id)
      .eq("status", "pending");
    return seatsDenied(after.left);
  }

  const service = ticketType ? `${listing.title} · ${ticketType.name}` : listing.title;
  // Swish Handel: betalningen görs och bekräftas på biljettsidan, inte i dörren.
  const commerce = isCommerceEnabled();
  sendSwishPendingEmail({
    to: email,
    customerName: name || "Gäst",
    serviceName: service,
    scheduledAt: new Date(scheduledAt),
    amountSek: amountOre / 100,
    swishNumber: offer.formatted,
    swishMessage: offer.message,
    swishUrl: swishPaymentUrl({ number: offer.number, amountSek: amountOre / 100, message: offer.message }),
    bookingId: booking.id,
    commerce,
    customerId: user?.id ?? null,
    // Gästen har inget konto att läsa språket ur; sidan hen stod på får avgöra.
    preferredLocale: await getLocale().catch(() => null),
  }).catch((e) => console.error("Swish pending email failed:", e));

  // Entrén behöver bara veta om köpet när den själv ska bekräfta det (Swish Företag).
  if (!commerce) await notifyEntranceSwishRequest(admin, {
    listingId: listing.id,
    ownerId: listing.user_id,
    bookingId: booking.id,
    eventDate: listing.event_date,
    name: name || email,
    service,
    amountOre,
  }).catch((e) => console.error("Swish intent notification failed:", e));

  return NextResponse.json({ bookingId: booking.id, amountOre, ticketUrl: `/biljett/${booking.id}` });
}
