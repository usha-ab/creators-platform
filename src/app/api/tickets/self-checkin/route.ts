import { NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit, getRateLimitKey } from "@/lib/rate-limit";
import {
  CHECKIN_BOOKING_SELECT,
  checkInAttendees,
  checkInBooking,
  checkInSeriesPass,
  isPaidBooking,
  isPassBooking,
  notPaid,
  type CheckinBooking,
  type CheckinResult,
} from "@/lib/tickets/checkin";
import { selfCheckinWindow, type EveningLike } from "@/lib/tickets/evening";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ATTENDEES = 50;

/**
 * POST /api/tickets/self-checkin — gästen checkar in sig själv.
 * { bookingId, attendeeIds?: string[] }
 *
 * Behörigheten är biljettlänken: den som har bokningens id (en icke gissbar
 * UUID, samma som /biljett/[id]) får checka in den. Ingen inloggning — de
 * flesta gäster har inget konto. Det är samma rätt som att visa QR-koden i
 * dörren, och incheckningen kan bara göras en gång.
 *
 * Allt avgörs här på servern, inte i telefonen:
 *  - Fönstret: kvällens starttid minus 30 minuter till kvällens slut
 *    (lib/tickets/evening.ts). Före = "för tidigt", efter = "kvällen är slut".
 *  - Betald bokning: confirmed/completed, aldrig en vilande Swish eller
 *    obetald Stripe (lib/tickets/checkin.ts).
 *  - Flerbiljett: attendeeIds väljer vilka i sällskapet som checkas in.
 *    Utan lista checkas alla som inte redan är inne.
 *
 * scanned_by skrivs som null: ingen i dörren skannade, gästen gjorde det.
 */
export async function POST(req: NextRequest) {
  const t = await getTranslations("scanApi");
  const s = await getTranslations("selfCheckin");

  const ipLimit = rateLimit(getRateLimitKey(req, "self-checkin"), 20, 60_000);
  if (!ipLimit.allowed) return NextResponse.json({ error: s("tooMany") }, { status: 429 });

  let payload: { bookingId?: unknown; attendeeIds?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: t("invalidRequest") }, { status: 400 });
  }
  const bookingId = String(payload.bookingId ?? "");
  if (!UUID.test(bookingId)) return NextResponse.json({ error: t("missingBookingId") }, { status: 400 });

  let attendeeIds: string[] | null = null;
  if (payload.attendeeIds !== undefined) {
    if (!Array.isArray(payload.attendeeIds) || payload.attendeeIds.length > MAX_ATTENDEES) {
      return NextResponse.json({ error: t("invalidRequest") }, { status: 400 });
    }
    attendeeIds = payload.attendeeIds.map(String);
    if (attendeeIds.some((id) => !UUID.test(id))) return NextResponse.json({ error: t("invalidRequest") }, { status: 400 });
  }

  // Per bokning också: en länk som delats vidare ska inte kunna hamras.
  const bookingLimit = rateLimit(`self-checkin:booking:${bookingId}`, 10, 60_000);
  if (!bookingLimit.allowed) return NextResponse.json({ error: s("tooMany") }, { status: 429 });

  const admin = createAdminClient();
  const { data } = await admin.from("bookings").select(CHECKIN_BOOKING_SELECT).eq("id", bookingId).maybeSingle();
  const booking = data as unknown as CheckinBooking | null;
  if (!booking) return NextResponse.json({ error: t("bookingNotFound") }, { status: 404 });

  const reply = (r: CheckinResult) => NextResponse.json(r.body, { status: r.status });
  const now = new Date();
  const windowError = (ev: EveningLike): CheckinResult | null => {
    const w = selfCheckinWindow(ev, now);
    if (w.state === "open") return null;
    if (w.state === "before") {
      return { status: 200, body: { success: false, error: s("tooEarly", { time: hhmm(w.opensAt) }), window: "before", opensAt: w.opensAt.toISOString() } };
    }
    return { status: 200, body: { success: false, error: s("eveningOver"), window: w.state } };
  };

  // Klippkort: fönstret gäller kvällens tillfälle i serien.
  if (isPassBooking(booking)) {
    return reply(
      await checkInSeriesPass({
        admin,
        booking,
        actorId: null,
        t,
        now,
        gate: async (today) => (today ? windowError(today) : null),
      })
    );
  }

  const listing = Array.isArray(booking.listings) ? booking.listings[0] : booking.listings;
  const stop = windowError(listing ?? {});
  if (stop) return reply(stop);

  if ((booking.guest_count ?? 1) > 1) {
    // Swish-bokningar har inga deltagarrader (en QR för hela sällskapet);
    // då checkas bokningen in som en helhet, som i dörren.
    const { data: rows } = await admin
      .from("ticket_attendees")
      .select("id, checked_in_at")
      .eq("booking_id", booking.id);
    const all = (rows ?? []) as { id: string; checked_in_at: string | null }[];
    if (all.length > 0) {
      if (!isPaidBooking(booking)) return reply(notPaid(booking, t));
      const chosen = attendeeIds ?? all.filter((r) => !r.checked_in_at).map((r) => r.id);
      if (chosen.length === 0) {
        return NextResponse.json({ success: false, alreadyCheckedIn: true, checkedInAt: booking.checked_in_at });
      }
      return reply(await checkInAttendees({ admin, booking, attendeeIds: chosen, actorId: null, t, now }));
    }
  }

  return reply(await checkInBooking({ admin, booking, actorId: null, t, now }));
}

function hhmm(d: Date): string {
  return d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" });
}
