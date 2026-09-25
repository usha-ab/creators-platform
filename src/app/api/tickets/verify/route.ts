import { NextRequest, NextResponse } from "next/server";
import { isPassBooking, passRemaining, passSeriesIds, pickOccurrence, seriesOccurrences } from "@/lib/passes/series-pass";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminById } from "@/lib/admin/check";
import { canScanListing } from "@/lib/scan-access";
import { isEventDay } from "@/lib/tickets/event-day";

export async function GET(request: NextRequest) {
  const t = await getTranslations("scanApi");
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const id = searchParams.get("id");
  const att = searchParams.get("att"); // attendee id (multi-ticket orders)

  if (!code && !id) {
    return NextResponse.json(
      { error: t("missingCodeOrId") },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  // Require authentication
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: t("notLoggedInVerify") },
      { status: 401 }
    );
  }

  // Extract booking ID prefix: from code "USH-XXXXXXXX" take the 8 hex chars,
  // or use the id param directly (first 8 chars of the booking UUID)
  let idPrefix: string;
  if (id) {
    idPrefix = id.slice(0, 8).toLowerCase();
  } else if (code) {
    const match = code.match(/^USH-([A-Fa-f0-9]{8})$/i);
    if (!match) {
      return NextResponse.json({
        valid: false,
        status: "not_found",
        ticket: {
          code: code || "",
          title: t("unknownTitle"),
          date: "",
          time: null,
          location: null,
        },
      });
    }
    idPrefix = match[1].toLowerCase();
  } else {
    idPrefix = "";
  }

  // Use admin client to bypass RLS — we verify permissions manually below
  const admin = createAdminClient();

  let bookingQuery = admin
    .from("bookings")
    .select("id, listing_id, creator_id, status, scheduled_at, notes, amount_paid, booking_type, guest_count, ticket_type_name, guest_name, sessions_total, sessions_redeemed");

  // The QR encodes the FULL booking UUID as `id` — match it exactly. Only the
  // code-only path (USH-XXXXXXXX, 8 hex) needs the prefix range. Using
  // maybeSingle() (not single()) means a prefix collision or no match returns
  // cleanly instead of a PGRST116 error that showed a valid ticket as not_found.
  const isFullUuid = !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (isFullUuid) {
    bookingQuery = bookingQuery.eq("id", id!);
  } else {
    // UUID columns don't support ilike; build a UUID range covering the prefix.
    const paddedStart = idPrefix + "0".repeat(32 - idPrefix.length);
    const uuidStart = `${paddedStart.slice(0,8)}-${paddedStart.slice(8,12)}-${paddedStart.slice(12,16)}-${paddedStart.slice(16,20)}-${paddedStart.slice(20,32)}`;
    const paddedEnd = idPrefix + "f".repeat(32 - idPrefix.length);
    const uuidEnd = `${paddedEnd.slice(0,8)}-${paddedEnd.slice(8,12)}-${paddedEnd.slice(12,16)}-${paddedEnd.slice(16,20)}-${paddedEnd.slice(20,32)}`;
    bookingQuery = bookingQuery.gte("id", uuidStart).lte("id", uuidEnd);
  }

  const { data: booking, error: bookingError } = await bookingQuery.limit(1).maybeSingle();

  const ticketCode = code || `USH-${idPrefix.toUpperCase()}`;

  if (bookingError || !booking) {
    return NextResponse.json({
      valid: false,
      status: "not_found",
      ticket: {
        code: ticketCode,
        title: t("unknownTitle"),
        date: "",
        time: null,
        location: null,
      },
    });
  }

  // Klippkort på en serie: giltigt vilken kväll som helst i serien, ett klipp
  // per kväll. Har sin egen väg eftersom "rätt dag" inte är kortets datum
  // utan seriens nästa kväll.
  if (isPassBooking(booking)) {
    return verifySeriesPass({ admin, userId: user.id, booking, ticketCode, t });
  }

  // The listing owner, an admin, or a crew member the host delegated scanning
  // to (can_scan) may verify tickets for this booking's event.
  const isOwnerOrAdmin =
    booking.creator_id === user.id || (await isAdminById(user.id));
  if (
    !isOwnerOrAdmin &&
    !(await canScanListing(admin, user.id, booking.listing_id))
  ) {
    return NextResponse.json(
      { error: t("noVerifyPermission") },
      { status: 403 }
    );
  }

  // Fetch listing details
  const { data: listing } = await admin
    .from("listings")
    .select("title, event_date, event_time, event_location")
    .eq("id", booking.listing_id)
    .single();

  // Determine date and time display values
  const scheduledDate = new Date(booking.scheduled_at);
  let displayDate: string;
  let displayTime: string | null;

  if (listing?.event_date) {
    displayDate = new Date(listing.event_date + "T00:00").toLocaleDateString(
      "sv-SE",
      { day: "numeric", month: "long", year: "numeric" }
    );
  } else {
    displayDate = scheduledDate.toLocaleDateString("sv-SE", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  if (listing?.event_time) {
    displayTime = (listing.event_time as string).slice(0, 5);
  } else {
    displayTime = scheduledDate.toLocaleTimeString("sv-SE", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const displayLocation = listing?.event_location || null;
  const title = listing?.title || t("unknownTitle");

  // Determine validity based on booking status
  let valid: boolean;
  let status: string;

  switch (booking.status) {
    case "confirmed":
      valid = true;
      status = "confirmed";
      break;
    case "completed":
      valid = false;
      status = "already_used";
      break;
    case "canceled":
      valid = false;
      status = "canceled";
      break;
    case "pending":
      valid = false;
      status = "pending";
      break;
    default:
      valid = false;
      status = "unknown";
      break;
  }

  // Multi-ticket order: validity is per attendee. A canceled/pending booking
  // still blocks all its attendees; otherwise each attendee is valid until its
  // own check-in. The booking-level `status=completed` here just means every
  // attendee was already scanned.
  let attendeeId: string | null = null;
  let attendeeLabel: string | null = null;
  if (att && (booking.guest_count ?? 1) > 1) {
    const { data: attendee } = await admin
      .from("ticket_attendees")
      .select("id, idx, name, checked_in_at")
      .eq("id", att)
      .eq("booking_id", booking.id)
      .maybeSingle();

    if (!attendee) {
      return NextResponse.json({
        valid: false,
        status: "not_found",
        bookingId: booking.id,
        ticket: { code: ticketCode, title, date: displayDate, time: displayTime, location: displayLocation },
      });
    }

    attendeeId = attendee.id;
    attendeeLabel = attendee.name || t("guestLabel", { idx: attendee.idx, count: booking.guest_count ?? 1 });
    if (booking.status === "canceled") {
      valid = false;
      status = "canceled";
    } else if (booking.status === "pending") {
      valid = false;
      status = "pending";
    } else if (attendee.checked_in_at) {
      valid = false;
      status = "already_used";
    } else {
      valid = true;
      status = "confirmed";
    }
  }

  // Rätt dag? En bekräftad, oanvänd biljett för den 21:a lyste grön i dörren
  // den 7:e. Statusen var korrekt — datumet var det ingen jämförde. En biljett
  // på fel dag är inte giltig; vill arrangören ändå släppa in kan det göras i
  // efterhand från bokningslistan.
  if (valid && !isEventDay(listing?.event_date)) {
    valid = false;
    status = "wrong_date";
  }

  // Biljettypen är det dörren faktiskt behöver. En Practica-biljett och en
  // Allt-biljett gav tidigare exakt samma gröna ruta — och Practica-gästen
  // ska inte in på socialen. Namnet står med så värden kan tilltala rätt
  // person när flera kommer på samma bokning.
  return NextResponse.json({
    valid,
    status,
    bookingId: booking.id,
    attendeeId,
    attendeeLabel,
    ticket: {
      code: `USH-${booking.id.slice(0, 8).toUpperCase()}`,
      title,
      date: displayDate,
      time: displayTime,
      location: displayLocation,
      ticketType: booking.ticket_type_name ?? null,
      holder: booking.guest_name ?? null,
      seats: booking.guest_count ?? 1,
    },
  });
}

async function verifySeriesPass(opts: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  booking: {
    id: string;
    listing_id: string;
    creator_id: string;
    status: string;
    guest_name: string | null;
    sessions_total: number | null;
    sessions_redeemed: number | null;
  };
  ticketCode: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const { admin, userId, booking, ticketCode, t } = opts;
  const { data: pass } = await admin
    .from("listings")
    .select("title, pass_series_id, pass_series_ids, pass_covers")
    .eq("id", booking.listing_id)
    .maybeSingle();
  const passSeries = passSeriesIds(pass);
  const occurrences = await seriesOccurrences(admin, passSeries);
  const { today, next } = pickOccurrence(occurrences);

  // Behörigheten prövas mot kvällens tillfälle: den som får skanna i dörren
  // i kväll får klippa kort i kväll.
  const isOwnerOrAdmin = booking.creator_id === userId || (await isAdminById(userId));
  if (!isOwnerOrAdmin && !(await canScanListing(admin, userId, today?.id ?? booking.listing_id))) {
    return NextResponse.json({ error: t("noVerifyPermission") }, { status: 403 });
  }

  const total = booking.sessions_total ?? 0;
  const remaining = passRemaining(booking);
  let valid = false;
  let status: string;
  if (booking.status === "canceled") status = "canceled";
  else if (booking.status === "pending") status = "pending";
  else if (passSeries.length === 0) status = "pass_not_series";
  else if (remaining <= 0) status = "already_used";
  else if (!today) status = "wrong_date";
  else {
    const { data: clipped } = await admin
      .from("pass_redemptions")
      .select("id")
      .eq("booking_id", booking.id)
      .eq("listing_id", today.id)
      .maybeSingle();
    if (clipped) status = "already_used";
    else {
      status = "confirmed";
      valid = true;
    }
  }

  const shown = today ?? next;
  const displayDate = shown
    ? new Date(shown.event_date + "T00:00").toLocaleDateString("sv-SE", { day: "numeric", month: "long", year: "numeric" })
    : "";

  return NextResponse.json({
    valid,
    status,
    bookingId: booking.id,
    attendeeId: null,
    attendeeLabel: null,
    ticket: {
      code: ticketCode,
      title: shown?.title ?? pass?.title ?? t("unknownTitle"),
      date: displayDate,
      time: shown?.event_time ? shown.event_time.slice(0, 5) : null,
      location: shown?.event_location ?? null,
      ticketType: t("passType", { covers: pass?.pass_covers ?? pass?.title ?? "", remaining, total }),
      holder: booking.guest_name ?? null,
      seats: 1,
    },
    pass: { total, remaining, occurrenceId: today?.id ?? null },
  });
}
