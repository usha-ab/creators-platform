import { NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminById } from "@/lib/admin/check";
import { canScanListing } from "@/lib/scan-access";
import {
  CHECKIN_BOOKING_SELECT,
  checkInAttendees,
  checkInBooking,
  checkInSeriesPass,
  isPassBooking,
  type CheckinBooking,
  type CheckinResult,
} from "@/lib/tickets/checkin";

/**
 * Dörrens incheckning: skannern och kiosken. Reglerna bor i
 * lib/tickets/checkin.ts (samma som gästens självincheckning); här avgörs
 * bara VEM som får checka in — ägaren, en admin eller crew med can_scan.
 */
export async function POST(request: NextRequest) {
  const t = await getTranslations("scanApi");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: t("notLoggedIn") }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t("invalidRequest") }, { status: 400 });
  }
  const { bookingId, attendeeId } = body;

  if (!bookingId) {
    return NextResponse.json({ error: t("missingBookingId") }, { status: 400 });
  }

  // Use admin client to bypass RLS — we verify permissions manually below
  const admin = createAdminClient();

  const { data, error: bookingError } = await admin
    .from("bookings")
    .select(CHECKIN_BOOKING_SELECT)
    .eq("id", bookingId)
    .single();
  const booking = data as unknown as CheckinBooking | null;

  if (bookingError || !booking) {
    return NextResponse.json({ error: t("bookingNotFound") }, { status: 404 });
  }

  const reply = (r: CheckinResult) => NextResponse.json(r.body, { status: r.status });
  const isOwnerOrAdmin = booking.creator_id === user.id || (await isAdminById(user.id));

  // Klippkort på en serie klipps mot kvällens tillfälle, inte mot kortet —
  // och skanningsrätten gäller kvällens tillfälle.
  if (isPassBooking(booking)) {
    return reply(
      await checkInSeriesPass({
        admin,
        booking,
        actorId: user.id,
        t,
        gate: async (today) =>
          isOwnerOrAdmin || (await canScanListing(admin, user.id, today?.id ?? booking.listing_id))
            ? null
            : { status: 403, body: { error: t("noCheckinPermission") } },
      })
    );
  }

  if (!isOwnerOrAdmin && !(await canScanListing(admin, user.id, booking.listing_id))) {
    return NextResponse.json({ error: t("noCheckinPermission") }, { status: 403 });
  }

  // Flerbiljettsorder: dörren checkar in EN deltagare per skanning.
  if ((booking.guest_count ?? 1) > 1) {
    if (!attendeeId) {
      return NextResponse.json({ success: false, error: t("scanIndividual") });
    }
    return reply(await checkInAttendees({ admin, booking, attendeeIds: [String(attendeeId)], actorId: user.id, t }));
  }

  return reply(await checkInBooking({ admin, booking, actorId: user.id, t }));
}
