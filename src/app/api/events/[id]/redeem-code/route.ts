import { NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidEmail, normalizeEmail, cleanName } from "@/lib/waitlist";
import { sendBookingConfirmationEmail } from "@/lib/email/send-booking";
import { getStripeLocale } from "@/lib/i18n/stripe-locale";
import { stripe } from "@/lib/stripe/client";
import { getCreatorCommissionRate } from "@/lib/stripe/commission";
import { canReceivePayments, PAYMENTS_BETA_BLOCKED_MESSAGE } from "@/lib/payments/beta-gate";
import { stockholmLocalToUtcISO } from "@/lib/time";
import { getSaleState } from "@/lib/listings/sale-state";

// Redeem an event access code for a ticket. Works for logged-in users and guests
// (email required). Two kinds of code:
//   • discount_price = NULL → FREE ticket (team / VIP). Booked directly, atomic.
//   • discount_price set (kr) → PAID ticket at that price via Stripe. The use is
//     consumed in the webhook AFTER successful payment (never on an abandoned checkout).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: listingId } = await params;
  const te = await getTranslations("eventErrors");

  // Rate limit: access codes are host-defined free text and this route is
  // guest-reachable, so throttle to stop brute-force enumeration of codes
  // (which could steal free inventory or a discounted checkout).
  const { rateLimit, getRateLimitKey } = await import("@/lib/rate-limit");
  const rl = rateLimit(getRateLimitKey(req, "redeem-code"), 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: te("generic") }, { status: 429 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let body: { code?: unknown; email?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: te("generic") }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) return NextResponse.json({ error: te("codeRequired") }, { status: 400 });

  const email = user?.email ?? (isValidEmail(body.email) ? normalizeEmail(body.email) : null);
  if (!email) return NextResponse.json({ error: te("invalidEmail") }, { status: 400 });
  const name = cleanName(body.name);

  const admin = createAdminClient();
  const { data: listing } = await admin
    .from("listings")
    .select("id, user_id, title, event_date, event_time, capacity, tickets_sold")
    .eq("id", listingId)
    .eq("is_active", true)
    .maybeSingle();
  if (!listing) return NextResponse.json({ error: te("eventNotFound") }, { status: 404 });

  // Ett passerat event ska inte gå att lösa in kod till i efterhand.
  if (getSaleState({ price: null, event_date: listing.event_date }, new Date()).state === "past") {
    return NextResponse.json({ error: te("past") }, { status: 403 });
  }

  // Look up the code (validate-only) to decide free vs discount. Codes are stored
  // upper/trimmed, matching redeem_access_code's upper(btrim()).
  const { data: codeRow } = await admin
    .from("event_access_codes")
    .select("id, discount_price, is_active, max_uses, used_count")
    .eq("listing_id", listingId)
    .eq("code", code.toUpperCase())
    .maybeSingle();
  if (
    !codeRow ||
    !codeRow.is_active ||
    (codeRow.max_uses !== null && codeRow.used_count >= codeRow.max_uses)
  ) {
    return NextResponse.json({ error: te("invalidCode") }, { status: 400 });
  }

  // ── DISCOUNT CODE → paid ticket at discount_price via Stripe Connect ──
  if (codeRow.discount_price && codeRow.discount_price > 0) {
    if (listing.capacity !== null && (listing.tickets_sold ?? 0) >= listing.capacity) {
      return NextResponse.json({ error: te("soldOut") }, { status: 403 });
    }

    const { data: creator } = await admin
      .from("profiles")
      .select("stripe_account_id, tier, company_verified_at")
      .eq("id", listing.user_id)
      .maybeSingle();

    if (!creator?.stripe_account_id) {
      return NextResponse.json({ error: te("generic") }, { status: 400 });
    }
    if (!canReceivePayments({ id: listing.user_id, company_verified_at: creator.company_verified_at })) {
      return NextResponse.json({ error: PAYMENTS_BETA_BLOCKED_MESSAGE }, { status: 403 });
    }

    const amountInOre = Math.round(codeRow.discount_price * 100);
    const applicationFee = Math.round(amountInOre * getCreatorCommissionRate(creator.tier ?? "gratis"));
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://usha.se";
    const stripeLocale = await getStripeLocale();

    // Reserve one code use ATOMICALLY now (used_count++ with the max_uses guard),
    // before the checkout exists. Validate-only let N concurrent requests each pass
    // the read check and create N discounted sessions on a single-use code, all
    // consumed later at payment. The reservation is released on Stripe error below
    // and by the checkout.session.expired / async_payment_failed webhook handler.
    const { data: reservedCodeId } = await admin.rpc("redeem_access_code", {
      p_listing: listingId,
      p_code: code,
    });
    if (!reservedCodeId) {
      return NextResponse.json({ error: te("invalidCode") }, { status: 400 });
    }

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        locale: stripeLocale,
        customer_email: email,
        // Shorter hold so a griefer can't lock a single-use code for a full day
        // by abandoning checkouts (mirrors the ticket checkout window).
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
        line_items: [
          {
            price_data: {
              currency: "sek",
              product_data: { name: listing.title },
              unit_amount: amountInOre,
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        payment_intent_data: {
          application_fee_amount: applicationFee,
          transfer_data: { destination: creator.stripe_account_id },
        },
        automatic_tax: { enabled: true },
        // Land buyers on a clear confirmation instead of the feed: logged-in users
        // see their tickets, guests get the login-free "thank you" page.
        success_url: user ? `${baseUrl}/app/tickets?success=true` : `${baseUrl}/biljett/klar`,
        cancel_url: `${baseUrl}/flode`,
        metadata: {
          // Reuse the existing webhook ticket branches. accessCodeReserved tells the
          // webhook the use was ALREADY counted here, so it must not consume again.
          type: user ? "ticket" : "guest_ticket",
          listingId: listing.id,
          creatorId: listing.user_id,
          accessCodeId: reservedCodeId,
          accessCodeReserved: "true",
          eventDate: listing.event_date || "",
          eventTime: listing.event_time || "",
          ...(user
            ? { userId: user.id }
            : { guestEmail: email, guestName: name || "" }),
        },
      });
    } catch (e) {
      // Release the code use we reserved if Stripe couldn't create the session.
      await admin.rpc("release_access_code", { p_id: reservedCodeId });
      throw e;
    }

    return NextResponse.json({ url: session.url });
  }

  // ── FREE CODE → reserve a seat FIRST, then consume a code use, then book. ──
  // Order matters: if we consumed the code before checking capacity, a sold-out
  // event would burn a valid single-use code without ever issuing a ticket.
  // event_date/event_time are Stockholm wall-clock; convert to UTC (DST-aware).
  const scheduledAt = listing.event_date
    ? stockholmLocalToUtcISO(`${listing.event_date}T${listing.event_time || "00:00"}`) ??
      new Date().toISOString()
    : new Date().toISOString();

  // 1. Atomically reserve a seat (row-locked capacity check). Nothing consumed yet.
  const { data: reserved } = await admin.rpc("reserve_ticket", { p_listing: listingId });
  if (!reserved) {
    return NextResponse.json({ error: te("soldOut") }, { status: 403 });
  }

  // 2. Atomically consume one code use. On failure, release the seat we reserved.
  const { data: codeId, error: rpcErr } = await admin.rpc("redeem_access_code", {
    p_listing: listingId,
    p_code: code,
  });
  if (rpcErr || !codeId) {
    await admin.rpc("increment_tickets_sold", { p_listing: listingId, p_n: -1 });
    return NextResponse.json({ error: te("invalidCode") }, { status: 400 });
  }

  // 3. Book. On failure, release BOTH the seat and (best-effort) the code use.
  const { data: codeBooking, error: bookErr } = await admin.from("bookings").insert({
    listing_id: listing.id,
    creator_id: listing.user_id,
    status: "confirmed",
    scheduled_at: scheduledAt,
    booking_type: "ticket",
    amount_paid: 0,
    is_free: true,
    ...(user ? { customer_id: user.id } : { guest_email: normalizeEmail(email), guest_name: name }),
  }).select("id").single();
  if (bookErr) {
    await admin.rpc("increment_tickets_sold", { p_listing: listingId, p_n: -1 });
    const { data: cur } = await admin
      .from("event_access_codes")
      .select("used_count")
      .eq("id", codeId)
      .maybeSingle();
    if (cur && (cur.used_count ?? 0) > 0) {
      await admin.from("event_access_codes").update({ used_count: cur.used_count - 1 }).eq("id", codeId);
    }
    console.error("access-code booking failed:", bookErr);
    return NextResponse.json({ error: te("generic") }, { status: 500 });
  }

  // Confirmation email (non-blocking; the free ticket is already booked).
  const { data: creator } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", listing.user_id)
    .maybeSingle();
  if (email) {
    sendBookingConfirmationEmail({
      to: email,
      customerName: name || "",
      serviceName: listing.title,
      scheduledAt: new Date(scheduledAt),
      creatorName: creator?.full_name || "Usha Platform",
      location: (listing as { event_location?: string }).event_location || undefined,
      bookingId: codeBooking?.id,
      customerId: user?.id ?? null,
    }).catch((e) => console.error("access-code confirmation email failed:", e));
  }

  return NextResponse.json({ ok: true });
}
