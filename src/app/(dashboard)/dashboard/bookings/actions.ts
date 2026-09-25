"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { handleCapacityReached, autoPromoteFromQueue, addToQueue, getQueuePosition } from "@/lib/bookings/queue";
import { requirePaidSubscription } from "@/lib/subscription/check";
import { refundBookingCharge } from "@/lib/tickets/refund";
import { voidRewardsForBooking } from "@/lib/affiliate/rewards";
import { stockholmLocalToUtcISO } from "@/lib/time";
import { sendBookingConfirmationEmail, sendBookingCancellationEmail } from "@/lib/email/send-booking";
import { shouldSendEmail } from "@/lib/email/check-preferences";
import { isGoldExclusive } from "@/lib/listings/early-bird";
import { BETA_MODE } from "@/lib/beta";
import { notifyNewBooking, notifyBookingConfirmed, notifyBookingCanceled } from "@/lib/notifications/create";

export async function createBooking(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Du måste vara inloggad för att boka." };

  // Require paid subscription to create bookings
  try {
    await requirePaidSubscription();
  } catch {
    return { error: "Du behöver en Guld- eller Premium-prenumeration för att boka." };
  }

  const listing_id = formData.get("listing_id") as string;
  const creator_id = formData.get("creator_id") as string;
  const scheduled_at = formData.get("scheduled_at") as string;
  const notes = (formData.get("notes") as string)?.trim() || null;
  const guestCountRaw = formData.get("guest_count") as string;
  const guest_count = guestCountRaw ? (parseInt(guestCountRaw, 10) || 1) : 1;
  const special_requests = (formData.get("special_requests") as string)?.trim() || null;
  const autoConfirm = formData.get("auto_confirm") === "true";
  const attendeesRaw = (formData.get("attendees") as string)?.trim();
  let attendees: unknown[] = [];
  if (attendeesRaw) {
    try { attendees = JSON.parse(attendeesRaw); } catch { /* ignore */ }
  }
  const agreedPriceRaw = formData.get("agreed_price") as string | null;
  const agreedPriceParsed = agreedPriceRaw ? parseInt(agreedPriceRaw, 10) : NaN;
  const agreed_price = Number.isFinite(agreedPriceParsed) && agreedPriceParsed >= 0
    ? agreedPriceParsed
    : null;

  if (!listing_id || !creator_id) {
    return { error: "Fyll i alla obligatoriska fält." };
  }

  if (!scheduled_at && !autoConfirm) {
    return { error: "Välj datum och tid." };
  }

  if (creator_id === user.id) {
    return { error: "Du kan inte boka din egen tjänst." };
  }

  let scheduledDate = scheduled_at ? new Date(scheduled_at) : new Date();
  if (!autoConfirm && scheduledDate <= new Date()) {
    return { error: "Välj ett datum i framtiden." };
  }
  // For fixed-date events, allow booking on the event day (block only past dates)
  if (autoConfirm) {
    const today = new Date().toISOString().slice(0, 10);
    const eventDay = scheduledDate.toISOString().slice(0, 10);
    if (eventDay < today) {
      return { error: "Detta event har redan passerat." };
    }
  }

  // Check capacity and validate guest count
  const { data: listing } = await supabase
    .from("listings")
    .select("id, user_id, duration_minutes, release_to_gold_at, listing_type, min_guests, max_guests, is_active, event_date, event_time")
    .eq("id", listing_id)
    .single();

  if (!listing || !listing.is_active) {
    return { error: "Tjänsten är inte aktiv eller hittades inte." };
  }

  // Verify creator_id matches the listing owner
  if (listing.user_id !== creator_id) {
    return { error: "Ogiltig kreatör för denna tjänst." };
  }

  // For fixed-date events, derive scheduled_at server-side from the listing's
  // own event_date/event_time instead of trusting the client's value, which is
  // parsed in the browser's timezone and drifts for non-Stockholm users.
  if (autoConfirm && listing.event_date) {
    const evListing = listing as { event_date?: string | null; event_time?: string | null };
    // event_date/event_time are Stockholm wall-clock; convert to UTC (DST-aware).
    const utc = stockholmLocalToUtcISO(`${evListing.event_date}T${evListing.event_time || "00:00"}`);
    scheduledDate = utc ? new Date(utc) : new Date();
  }

  // B2B offerings can only be booked by experience-role users (arrangörer).
  if (listing.listing_type === "b2b_offering") {
    const { data: viewerProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if ((viewerProfile as { role?: string | null } | null)?.role !== "venue") {
      return { error: "Endast arrangörer kan boka B2B-tjänster." };
    }
  }

  // Validate guest count against listing constraints
  if (listing?.min_guests && guest_count < listing.min_guests) {
    return { error: `Minst ${listing.min_guests} gäster krävs.` };
  }
  if (listing?.max_guests && guest_count > listing.max_guests) {
    return { error: `Max ${listing.max_guests} gäster tillåtna.` };
  }

  if (listing?.duration_minutes) {
    const isFull = await handleCapacityReached(listing_id, listing.duration_minutes);
    if (isFull) {
      return { error: "Denna tjänst är fullbokad." };
    }
  }

  // Early bird: block gratis users during Gold-exclusive window
  if (listing?.release_to_gold_at) {
    const releaseDate = new Date(listing.release_to_gold_at);
    if (isGoldExclusive(releaseDate)) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("tier")
        .eq("id", user.id)
        .single();
      const tier = profile?.tier ?? "gratis";
      if (!BETA_MODE && tier !== "guld" && tier !== "premium") {
        const hours = Math.ceil((releaseDate.getTime() - Date.now()) / (60 * 60 * 1000));
        return { error: `Detta event är exklusivt för Guld/Premium-medlemmar i ${hours} timmar till.` };
      }
    }
  }

  // Idempotency for fixed-date events (tickets): a user should hold ONE ticket
  // per event. A fast double-tap or a retry was creating duplicate bookings —
  // and thus a duplicate "Bokning bekräftad" confirmation. If they already have
  // a non-canceled booking for this listing, treat it as already booked instead
  // of inserting a duplicate. (Service bookings — non auto-confirm — can repeat.)
  if (autoConfirm) {
    const { data: existing } = await supabase
      .from("bookings")
      .select("id")
      .eq("listing_id", listing_id)
      .eq("customer_id", user.id)
      .neq("status", "canceled")
      .limit(1)
      .maybeSingle();
    if (existing) {
      revalidatePath("/dashboard/bookings");
      return { success: true };
    }
  }

  // Only persist agreed_price for B2B-offerings.
  const persistAgreedPrice = listing.listing_type === "b2b_offering" && agreed_price !== null;

  const { error } = await supabase.from("bookings").insert({
    listing_id,
    creator_id,
    customer_id: user.id,
    scheduled_at: scheduledDate.toISOString(),
    notes,
    guest_count,
    special_requests,
    attendees,
    ...(persistAgreedPrice ? { agreed_price } : {}),
    ...(autoConfirm ? { status: "confirmed" } : {}),
  });

  if (error) {
    return { error: "Kunde inte skapa bokningen. Försök igen." };
  }

  // Send booking confirmation email (non-blocking)
  sendBookingNotification({
    supabase,
    customerEmail: user.email!,
    customerId: user.id,
    creatorId: creator_id,
    listingId: listing_id,
    scheduledAt: scheduledDate,
  }).catch(err => console.error("Email send failed:", err));

  // In-app notification for the creator (non-blocking)
  const { data: listingData } = await supabase.from("listings").select("title").eq("id", listing_id).single();
  const { data: customerProfile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
  notifyNewBooking(
    creator_id,
    customerProfile?.full_name || "En användare",
    listingData?.title || "Tjänst"
  ).catch(err => console.error("Notification failed:", err));

  revalidatePath("/dashboard/bookings");
  return { success: true };
}

export async function updateBookingStatus(
  bookingId: string,
  status: "confirmed" | "canceled" | "completed"
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Ej inloggad" };

  // Verify the user is the creator or customer of this booking
  const { data: booking } = await supabase
    .from("bookings")
    .select("creator_id, customer_id, status, listing_id, scheduled_at, stripe_payment_id, amount_paid, booking_type, ticket_type_id, guest_count")
    .eq("id", bookingId)
    .single();

  if (!booking) return { error: "Bokning hittades inte." };

  const isCreator = booking.creator_id === user.id;
  const isCustomer = booking.customer_id === user.id;

  // Only creators can confirm/complete, both can cancel
  if (status === "confirmed" || status === "completed") {
    if (!isCreator) return { error: "Bara skaparen kan bekräfta bokningar." };
  }
  if (status === "canceled") {
    if (!isCreator && !isCustomer)
      return { error: "Du har inte behörighet att avboka." };
  }

  // Can only transition from valid states
  if (status === "confirmed" && booking.status !== "pending") {
    return { error: "Kan bara bekräfta väntande bokningar." };
  }
  if (status === "completed" && booking.status !== "confirmed") {
    return { error: "Kan bara slutföra bekräftade bokningar." };
  }
  if (
    status === "canceled" &&
    booking.status !== "pending" &&
    booking.status !== "confirmed"
  ) {
    return { error: "Denna bokning kan inte avbokas." };
  }

  // Auto-refund paid bookings BEFORE canceling (so we don't cancel without
  // refunding). refundBookingCharge reverses the Connect transfer + refunds the
  // application fee for destination charges, so Usha isn't left out of pocket.
  let refundInfo: { refundId: string; amount: number } | null = null;
  if (status === "canceled" && booking.stripe_payment_id && booking.amount_paid) {
    try {
      refundInfo = await refundBookingCharge(booking.stripe_payment_id);
      console.log(`Refunded ${refundInfo.amount} öre (${refundInfo.refundId}) for booking ${bookingId}`);
      // Partnerns andel av ett återbetalat köp ska inte betalas ut.
      await voidRewardsForBooking(createAdminClient(), bookingId);
    } catch (err) {
      console.error("Auto-refund failed:", err);
      return { error: "Kunde inte återbetala. Kontakta support." };
    }
  }

  // Use admin client when customer cancels — RLS only allows creators to update bookings
  const updateClient = (status === "canceled" && isCustomer) ? createAdminClient() : supabase;
  const { error } = await updateClient
    .from("bookings")
    .update(
      refundInfo
        ? {
            status,
            refunded_at: new Date().toISOString(),
            refund_amount: refundInfo.amount,
            stripe_refund_id: refundInfo.refundId,
          }
        : { status }
    )
    .eq("id", bookingId);

  if (error) return { error: "Kunde inte uppdatera bokningen." };

  // Free up the seat when a ticket is canceled — tickets_sold was only ever
  // incremented, so canceled tickets used to permanently consume capacity.
  if (status === "canceled" && booking.booking_type === "ticket") {
    const seats = booking.guest_count ?? 1;
    await createAdminClient()
      .rpc("increment_tickets_sold", {
        p_listing: booking.listing_id,
        p_n: -seats,
        p_ticket_type: booking.ticket_type_id ?? undefined,
      })
      .then(({ error: decErr }) => decErr && console.error("tickets_sold decrement failed:", decErr));

    // A freed seat on a (now buyable) event → email the next people on the
    // waitlist. Best-effort, non-blocking.
    const { notifyWaitlistSeatFreed } = await import("@/lib/tickets/waitlist-notify");
    await notifyWaitlistSeatFreed(createAdminClient(), booking.listing_id, seats);
  }

  // Send email notifications (non-blocking)
  const { data: bookingListing } = await supabase.from("listings").select("title").eq("id", booking.listing_id).single();
  const serviceName = bookingListing?.title || "Tjänst";

  if (status === "confirmed") {
    sendConfirmNotification({
      supabase,
      customerId: booking.customer_id,
      creatorId: booking.creator_id,
      listingId: booking.listing_id,
      scheduledAt: new Date(booking.scheduled_at),
    }).catch(err => console.error("Confirmation email failed:", err));

    notifyBookingConfirmed(booking.customer_id, serviceName)
      .catch(err => console.error("Confirm notification failed:", err));
  } else if (status === "canceled") {
    sendCancelNotification({
      supabase,
      customerId: booking.customer_id,
      creatorId: booking.creator_id,
      listingId: booking.listing_id,
      scheduledAt: new Date(booking.scheduled_at),
    }).catch(err => console.error("Cancellation email failed:", err));

    // Notify both parties
    notifyBookingCanceled(booking.customer_id, serviceName)
      .catch(err => console.error("Cancel notification failed:", err));
    notifyBookingCanceled(booking.creator_id, serviceName)
      .catch(err => console.error("Cancel notification failed:", err));
  }

  // When a booking is canceled, try to promote the next person in the queue
  if (status === "canceled") {
    const { data: canceledBooking } = await supabase
      .from("bookings")
      .select("listing_id")
      .eq("id", bookingId)
      .single();

    if (canceledBooking?.listing_id) {
      try {
        await autoPromoteFromQueue(canceledBooking.listing_id);
      } catch (err) {
        // booking_queue table may not exist yet — log and continue
        console.error("autoPromoteFromQueue failed (queue table may not exist):", err);
      }
    }
  }

  revalidatePath("/dashboard/bookings");
  return { success: true };
}

// ── Email helper functions ──────────────────────────────────────

interface EmailContext {
  supabase: Awaited<ReturnType<typeof createClient>>;
  customerId: string;
  creatorId: string;
  listingId: string;
  scheduledAt: Date;
  customerEmail?: string;
}

async function fetchEmailData(ctx: EmailContext) {
  const [customerResult, creatorResult, listingResult] = await Promise.all([
    // email är inte läsbar för authenticated på motpartens rad — service-role.
    createAdminClient().from("profiles").select("email, full_name").eq("id", ctx.customerId).single(),
    createAdminClient().from("profiles").select("email, full_name").eq("id", ctx.creatorId).single(),
    ctx.supabase.from("listings").select("title, event_location").eq("id", ctx.listingId).single(),
  ]);
  return {
    customerEmail: ctx.customerEmail || customerResult.data?.email,
    customerName: customerResult.data?.full_name || "Kund",
    creatorEmail: creatorResult.data?.email,
    creatorName: creatorResult.data?.full_name || "Kreatör",
    serviceName: listingResult.data?.title || "Tjänst",
    location: listingResult.data?.event_location || undefined,
  };
}

async function sendBookingNotification(ctx: EmailContext) {
  // Check if creator wants new booking emails
  if (!await shouldSendEmail(ctx.creatorId, "notif_booking_new")) return;
  const data = await fetchEmailData(ctx);
  if (!data.customerEmail) return;
  await sendBookingConfirmationEmail({
    to: data.customerEmail,
    customerName: data.customerName,
    serviceName: data.serviceName,
    scheduledAt: ctx.scheduledAt,
    creatorName: data.creatorName,
    location: data.location,
    customerId: ctx.customerId,
  });
}

async function sendConfirmNotification(ctx: EmailContext) {
  // Check if customer wants booking confirmation emails
  if (!await shouldSendEmail(ctx.customerId, "notif_booking_confirmed")) return;
  const data = await fetchEmailData(ctx);
  if (!data.customerEmail) return;
  await sendBookingConfirmationEmail({
    to: data.customerEmail,
    customerName: data.customerName,
    serviceName: data.serviceName,
    scheduledAt: ctx.scheduledAt,
    creatorName: data.creatorName,
    location: data.location,
    customerId: ctx.customerId,
  });
}

async function sendCancelNotification(ctx: EmailContext) {
  const data = await fetchEmailData(ctx);
  const sends: Promise<void>[] = [];
  if (data.customerEmail && await shouldSendEmail(ctx.customerId, "notif_booking_canceled")) {
    sends.push(sendBookingCancellationEmail({
      to: data.customerEmail,
      recipientName: data.customerName,
      serviceName: data.serviceName,
      scheduledAt: ctx.scheduledAt,
      recipientId: ctx.customerId,
    }));
  }
  if (data.creatorEmail && await shouldSendEmail(ctx.creatorId, "notif_booking_canceled")) {
    sends.push(sendBookingCancellationEmail({
      to: data.creatorEmail,
      recipientName: data.creatorName,
      serviceName: data.serviceName,
      scheduledAt: ctx.scheduledAt,
      recipientId: ctx.creatorId,
    }));
  }
  await Promise.all(sends);
}

// ── Queue actions ───────────────────────────────────────────────

export async function joinQueue(listingId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Du måste vara inloggad." };

  // Get user tier for priority placement
  const { data: profile } = await supabase
    .from("profiles")
    .select("tier")
    .eq("id", user.id)
    .single();

  try {
    const result = await addToQueue(listingId, user.id, profile?.tier ?? null);
    return {
      success: true,
      queuePosition: result.queuePosition,
      estimatedTime: result.estimatedTime,
    };
  } catch {
    return { error: "Kunde inte gå med i kön. Försök igen." };
  }
}

export async function getMyQueuePosition(listingId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { position: null };

  const position = await getQueuePosition(listingId, user.id);
  return { position };
}

/**
 * Löser in ett pass på ett klippkort: räknar upp sessions_redeemed med 1.
 * Bara kreatören som äger bokningen får lösa in.
 * När sista passet tas markeras bokningen automatiskt som completed.
 */
export async function redeemSession(bookingId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Ej inloggad" };

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, creator_id, status, sessions_total, sessions_redeemed")
    .eq("id", bookingId)
    .single();

  if (!booking) return { error: "Bokning hittades inte." };

  if (booking.creator_id !== user.id) {
    return { error: "Bara kreatören kan lösa in pass." };
  }

  const total = (booking as { sessions_total?: number | null }).sessions_total ?? null;
  const redeemed = (booking as { sessions_redeemed?: number | null }).sessions_redeemed ?? 0;

  if (total === null || total <= 0) {
    return { error: "Den här bokningen har inte ett danspaket." };
  }

  if (redeemed >= total) {
    return { error: "Alla danser är redan inlösta." };
  }

  if (booking.status !== "confirmed") {
    return { error: "Kan bara inlösa danser på bekräftade bokningar." };
  }

  const nextRedeemed = redeemed + 1;
  const reachedTotal = nextRedeemed >= total;

  // Optimistic concurrency: only apply if sessions_redeemed is still what we read
  // and the booking is still confirmed. A concurrent redemption (double-tap /
  // two devices) changes the value so the guard misses → 0 rows → we bail out
  // instead of silently losing an update.
  const { data: updatedRows, error: updateError } = await supabase
    .from("bookings")
    .update({
      sessions_redeemed: nextRedeemed,
      ...(reachedTotal ? { status: "completed" } : {}),
    })
    .eq("id", bookingId)
    .eq("sessions_redeemed", redeemed)
    .eq("status", "confirmed")
    .select("id");

  if (updateError) {
    return { error: "Kunde inte uppdatera bokningen." };
  }
  if (!updatedRows || updatedRows.length === 0) {
    return { error: "Bokningen ändrades precis — ladda om och försök igen." };
  }

  revalidatePath("/dashboard/bookings");
  return { success: true, redeemed: nextRedeemed, total, reachedTotal };
}

/**
 * Instructor redeems a block of minutes on-site for an instructor-minutes
 * booking. Mirrors redeemSession but works in `amount`-minute steps (default 15).
 */
export async function redeemMinutes(bookingId: string, amount = 15) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Ej inloggad" };

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, creator_id, status, minutes_total, minutes_redeemed")
    .eq("id", bookingId)
    .single();

  if (!booking) return { error: "Bokning hittades inte." };

  if (booking.creator_id !== user.id) {
    return { error: "Bara instruktören kan lösa in minuter." };
  }

  const total = (booking as { minutes_total?: number | null }).minutes_total ?? null;
  const redeemed = (booking as { minutes_redeemed?: number | null }).minutes_redeemed ?? 0;

  if (total === null || total <= 0) {
    return { error: "Den här bokningen har inga minuter." };
  }
  if (booking.status !== "confirmed") {
    return { error: "Kan bara lösa in minuter på bekräftade bokningar." };
  }
  if (redeemed + amount > total) {
    return { error: "Inte tillräckligt med minuter kvar." };
  }

  const nextRedeemed = redeemed + amount;
  const reachedTotal = nextRedeemed >= total;

  // Optimistic concurrency: guard on the value we read + still-confirmed status,
  // so two concurrent redemptions can't both write and lose a minute block.
  const { data: updatedRows, error: updateError } = await supabase
    .from("bookings")
    .update({
      minutes_redeemed: nextRedeemed,
      ...(reachedTotal ? { status: "completed" } : {}),
    })
    .eq("id", bookingId)
    .eq("minutes_redeemed", redeemed)
    .eq("status", "confirmed")
    .select("id");

  if (updateError) {
    return { error: "Kunde inte uppdatera bokningen." };
  }
  if (!updatedRows || updatedRows.length === 0) {
    return { error: "Bokningen ändrades precis — ladda om och försök igen." };
  }

  revalidatePath("/dashboard/bookings");
  return { success: true, redeemed: nextRedeemed, total, reachedTotal };
}


/**
 * Creator marks (or unmarks) one of their bookings as free/comped — e.g. a free
 * intro. A free booking shows no "Betala" button to the customer and cannot be
 * paid. Only the booking's creator may set it, and not once it's already paid.
 */
export async function setBookingFree(bookingId: string, isFree: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Ej inloggad" };

  const { data: booking } = await supabase
    .from("bookings")
    .select("creator_id, stripe_payment_id")
    .eq("id", bookingId)
    .single();

  if (!booking) return { error: "Bokningen hittades inte" };
  if (booking.creator_id !== user.id) return { error: "Du kan bara ändra dina egna bokningar" };
  if (booking.stripe_payment_id) return { error: "Bokningen är redan betald" };

  const { error } = await supabase
    .from("bookings")
    .update({ is_free: isFree })
    .eq("id", bookingId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/bookings");
  return { ok: true };
}
