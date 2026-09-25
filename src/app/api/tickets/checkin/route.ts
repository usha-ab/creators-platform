import { NextRequest, NextResponse } from "next/server";
import { isPassBooking, passRemaining, passSeriesIds, pickOccurrence, seriesOccurrences } from "@/lib/passes/series-pass";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminById } from "@/lib/admin/check";
import { canScanListing } from "@/lib/scan-access";

export async function POST(request: NextRequest) {
  const t = await getTranslations("scanApi");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: t("notLoggedIn") },
      { status: 401 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: t("invalidRequest") },
      { status: 400 }
    );
  }
  const { bookingId, attendeeId } = body;

  if (!bookingId) {
    return NextResponse.json(
      { error: t("missingBookingId") },
      { status: 400 }
    );
  }

  // Use admin client to bypass RLS — we verify permissions manually below
  const admin = createAdminClient();

  // Fetch booking and verify the scanner is the creator of this listing
  const { data: booking, error: bookingError } = await admin
    .from("bookings")
    .select("id, status, creator_id, checked_in_at, listing_id, guest_count, sessions_total, sessions_redeemed, listings(title)")
    .eq("id", bookingId)
    .single();

  if (bookingError || !booking) {
    return NextResponse.json(
      { error: t("bookingNotFound") },
      { status: 404 }
    );
  }

  // The listing owner, an admin, or a crew member the host delegated scanning
  // to (can_scan) may check in guests for this booking's event.
  // Klippkort på en serie klipps mot kvällens tillfälle, inte mot kortet.
  if (isPassBooking(booking)) {
    return checkInSeriesPass({ admin, userId: user.id, booking, t });
  }

  const isOwnerOrAdmin =
    booking.creator_id === user.id || (await isAdminById(user.id));
  if (
    !isOwnerOrAdmin &&
    !(await canScanListing(admin, user.id, booking.listing_id))
  ) {
    return NextResponse.json(
      { error: t("noCheckinPermission") },
      { status: 403 }
    );
  }

  const title = (booking as any).listings?.title || t("bookingFallback");
  const isMulti = (booking.guest_count ?? 1) > 1;

  // Multi-ticket order: check in ONE attendee. The booking is only marked
  // completed once every attendee has been scanned.
  if (isMulti) {
    if (!attendeeId) {
      return NextResponse.json({
        success: false,
        error: t("scanIndividual"),
      });
    }
    if (booking.status === "canceled") {
      return NextResponse.json({ success: false, error: t("bookingCanceled"), status: "canceled" });
    }

    const { data: attendee } = await admin
      .from("ticket_attendees")
      .select("id, idx, name, checked_in_at")
      .eq("id", attendeeId)
      .eq("booking_id", booking.id)
      .maybeSingle();

    if (!attendee) {
      return NextResponse.json({ error: t("ticketNotFound") }, { status: 404 });
    }
    const label = attendee.name || t("guestLabel", { idx: attendee.idx, count: booking.guest_count ?? 1 });
    if (attendee.checked_in_at) {
      return NextResponse.json({
        success: false,
        alreadyCheckedIn: true,
        checkedInAt: attendee.checked_in_at,
        title,
        attendeeLabel: label,
      });
    }

    const now = new Date().toISOString();
    // Atomic: only claim the slot if still unchecked.
    const { data: claimed } = await admin
      .from("ticket_attendees")
      .update({ checked_in_at: now, scanned_by: user.id })
      .eq("id", attendee.id)
      .is("checked_in_at", null)
      .select("id")
      .maybeSingle();

    if (!claimed) {
      return NextResponse.json({ success: false, alreadyCheckedIn: true, title, attendeeLabel: label });
    }

    // Mark the whole booking completed once every attendee is in.
    const { count: remaining } = await admin
      .from("ticket_attendees")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", booking.id)
      .is("checked_in_at", null);
    if ((remaining ?? 0) === 0) {
      await admin.from("bookings").update({ checked_in_at: now, status: "completed" }).eq("id", booking.id);
    }

    return NextResponse.json({ success: true, title, checkedInAt: now, attendeeLabel: label });
  }

  // Already checked in
  if (booking.checked_in_at) {
    return NextResponse.json({
      success: false,
      alreadyCheckedIn: true,
      checkedInAt: booking.checked_in_at,
      title: (booking as any).listings?.title || t("bookingFallback"),
    });
  }

  // Must be confirmed to check in
  if (booking.status !== "confirmed") {
    return NextResponse.json({
      success: false,
      error: booking.status === "pending"
        ? t("notConfirmedYet")
        : booking.status === "canceled"
          ? t("bookingCanceled")
          : t("cannotCheckIn"),
      status: booking.status,
    });
  }

  // Mark as checked in and completed
  const { error: updateError } = await admin
    .from("bookings")
    .update({
      checked_in_at: new Date().toISOString(),
      status: "completed",
      scanned_by: user.id,
    })
    .eq("id", bookingId);

  if (updateError) {
    return NextResponse.json(
      { error: t("couldNotCheckIn") },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    title: (booking as any).listings?.title || t("bookingFallback"),
    checkedInAt: new Date().toISOString(),
  });
}

async function checkInSeriesPass(opts: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  booking: {
    id: string;
    status: string;
    creator_id: string;
    listing_id: string;
    sessions_total: number | null;
    sessions_redeemed: number | null;
  };
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const { admin, userId, booking, t } = opts;
  const { data: pass } = await admin
    .from("listings")
    .select("title, pass_series_id, pass_series_ids")
    .eq("id", booking.listing_id)
    .maybeSingle();
  const occurrences = await seriesOccurrences(admin, passSeriesIds(pass));
  const { today } = pickOccurrence(occurrences);

  const isOwnerOrAdmin = booking.creator_id === userId || (await isAdminById(userId));
  if (!isOwnerOrAdmin && !(await canScanListing(admin, userId, today?.id ?? booking.listing_id))) {
    return NextResponse.json({ error: t("noCheckinPermission") }, { status: 403 });
  }

  const title = today?.title ?? pass?.title ?? t("bookingFallback");
  if (booking.status !== "confirmed") {
    return NextResponse.json({
      success: false,
      error: booking.status === "canceled" ? t("bookingCanceled") : t("cannotCheckIn"),
      status: booking.status,
    });
  }
  if (!today) {
    return NextResponse.json({ success: false, error: t("passNoEventToday") });
  }
  const total = booking.sessions_total ?? 0;
  if (passRemaining(booking) <= 0) {
    return NextResponse.json({ success: false, error: t("passUsedUp") });
  }

  // Ett klipp per kväll: unika nyckeln (booking, tillfälle) är spärren mot
  // dubbelskanning, oavsett hur många telefoner som står i dörren.
  const now = new Date().toISOString();
  const { error: clipError } = await admin
    .from("pass_redemptions")
    .insert({ booking_id: booking.id, listing_id: today.id, scanned_by: userId, redeemed_at: now });
  if (clipError) {
    if (clipError.code === "23505") {
      const { data: prev } = await admin
        .from("pass_redemptions")
        .select("redeemed_at")
        .eq("booking_id", booking.id)
        .eq("listing_id", today.id)
        .maybeSingle();
      return NextResponse.json({ success: false, alreadyCheckedIn: true, checkedInAt: prev?.redeemed_at ?? now, title });
    }
    return NextResponse.json({ error: t("couldNotCheckIn") }, { status: 500 });
  }

  // Räknaren härleds ur loggen i stället för att räknas upp: då kan två
  // samtidiga klipp aldrig tappa bort varandra.
  const { count } = await admin
    .from("pass_redemptions")
    .select("id", { count: "exact", head: true })
    .eq("booking_id", booking.id);
  const redeemed = count ?? (booking.sessions_redeemed ?? 0) + 1;
  await admin
    .from("bookings")
    .update({ sessions_redeemed: redeemed, ...(redeemed >= total ? { status: "completed" } : {}) })
    .eq("id", booking.id);

  return NextResponse.json({ success: true, title, checkedInAt: now, passRemaining: Math.max(0, total - redeemed) });
}
