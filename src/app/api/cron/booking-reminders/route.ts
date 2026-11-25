import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { createClient } from "@supabase/supabase-js";
import { sendBookingReminderEmail } from "@/lib/email/send-booking-reminder";
import { shouldSendEmail } from "@/lib/email/check-preferences";
import { sendPassExpiryReminders } from "@/lib/passes/expiry-reminders";

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Cron job: Send a reminder for confirmed bookings scheduled the next day.
 * Runs daily at 07:00 UTC (09:00 CEST). Idempotent via bookings.reminder_sent_at.
 */
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  // Klippkort som går ut om 30 eller 7 dagar med klipp kvar. Samma dagliga
  // körning, så inget nytt jobb behöver läggas i usha-cron.
  const passReminders = await sendPassExpiryReminders(admin);

  // Window: bookings scheduled on the next UTC calendar day.
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() + 1);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  const { data: bookings } = await admin
    .from("bookings")
    .select("id, scheduled_at, customer_id, creator_id, listing_id, guest_email, guest_name")
    .eq("status", "confirmed")
    .is("reminder_sent_at", null)
    .gte("scheduled_at", start.toISOString())
    .lt("scheduled_at", end.toISOString());

  if (!bookings?.length) return NextResponse.json({ sent: 0, passReminders });

  let sent = 0;

  for (const b of bookings) {
    // Resolve recipient: registered customer (respect opt-out) or guest (always — transactional).
    let to: string | null = null;
    let customerName = "Kund";

    if (b.customer_id) {
      if (!(await shouldSendEmail(b.customer_id, "notif_booking_confirmed"))) continue;
      const { data: cust } = await admin
        .from("profiles")
        .select("email, full_name")
        .eq("id", b.customer_id)
        .single();
      if (!cust?.email) continue;
      to = cust.email;
      customerName = cust.full_name || "Kund";
    } else if (b.guest_email) {
      to = b.guest_email;
      customerName = b.guest_name || "Gäst";
    }

    if (!to) continue;

    const { data: listing } = await admin
      .from("listings")
      .select("title, event_location, duration_minutes, organizer_name")
      .eq("id", b.listing_id)
      .single();
    const { data: creator } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", b.creator_id)
      .single();

    try {
      await sendBookingReminderEmail({
        to,
        customerName,
        serviceName: listing?.title || "Din bokning",
        scheduledAt: new Date(b.scheduled_at),
        creatorName: listing?.organizer_name || creator?.full_name || "Arrangör",
        location: listing?.event_location || undefined,
        bookingId: b.id,
        durationMinutes: listing?.duration_minutes || undefined,
        customerId: b.customer_id,
      });
      await admin
        .from("bookings")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", b.id);
      sent++;
    } catch (err) {
      console.error(`Booking reminder failed for ${b.id}:`, err);
    }
  }

  return NextResponse.json({ sent, passReminders });
}
