import { NextRequest, NextResponse } from "next/server";
import { normalizeEmail } from "@/lib/email/normalize";
import type Stripe from "stripe";
import { getStripeLocale } from "@/lib/i18n/stripe-locale";
import { stripe } from "@/lib/stripe/client";
import { computeServiceFeeOre, serviceFeeMode } from "@/lib/tickets/service-fee";
import { clampQuantity, createTicketAttendees, attendeeNamesToMeta } from "@/lib/tickets/attendees";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from '@/lib/supabase/admin';
import { getSaleState } from "@/lib/listings/sale-state";
import { stockholmLocalToUtcISO } from "@/lib/time";
import { getTranslations } from "next-intl/server";
import {
  getCreatorCommissionRate,
} from "@/lib/stripe/commission";
import { canReceivePayments, PAYMENTS_BETA_BLOCKED_MESSAGE } from "@/lib/payments/beta-gate";
import { resolvePayeeFlow, buildConnectPaymentIntentData, buildPaymentMetadata, buildTermsCustomText, type PayeeContext } from "@/lib/stripe/checkout";

export async function POST(req: NextRequest) {
  // Rate limit: 5 guest checkouts per minute per IP
  const { rateLimit, getRateLimitKey } = await import('@/lib/rate-limit');
  const rl = rateLimit(getRateLimitKey(req, 'guest-checkout'), 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const { listingId, email: rawEmail, name, ticketTypeId, quantity, attendeeNames } = await req.json();
    // Adressen är identiteten som knyter gästbiljetten till ett konto senare.
    // Sparas den som den skrevs slutar `guest_email = user.email` matcha så
    // fort någon råkar få en versal med sig från tangentbordet.
    const email = normalizeEmail(rawEmail);
    const qty = clampQuantity(quantity);

    if (!listingId || !email) {
      return NextResponse.json(
        { error: "listingId and email are required" },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Fetch listing
    const { data: listing } = await supabase
      .from("listings")
      .select("id, title, price, user_id, is_active, event_date, event_time, event_location, early_bird_start, early_bird_end, early_bird_price, public_sale_at, capacity, tickets_sold, service_fee_mode")
      .eq("id", listingId)
      .eq("is_active", true)
      .single();

    if (!listing) {
      return NextResponse.json(
        { error: "Event not found" },
        { status: 404 }
      );
    }

    // Optional ticket type (price tier) — overrides price + capacity, validated
    // to belong to this listing.
    let ticketType: { id: string; name: string; price: number; capacity: number | null; tickets_sold: number } | null = null;
    if (ticketTypeId) {
      const { data: tt } = await supabase
        .from("ticket_types")
        .select("id, name, price, capacity, tickets_sold")
        .eq("id", ticketTypeId)
        .eq("listing_id", listing.id)
        .single();
      if (!tt) {
        return NextResponse.json({ error: "Invalid ticket type" }, { status: 400 });
      }
      ticketType = tt as { id: string; name: string; price: number; capacity: number | null; tickets_sold: number };
      if (ticketType!.capacity != null && ticketType!.tickets_sold >= ticketType!.capacity) {
        const te = await getTranslations("eventErrors");
        return NextResponse.json({ error: te("soldOut") }, { status: 403 });
      }
    }

    // Timed automation: block when not buyable; use effective (early-bird) price.
    const sale = getSaleState(listing, new Date());
    if (!sale.buyable) {
      const te = await getTranslations("eventErrors");
      const msg =
        sale.state === "past" ? te("past") :
        sale.state === "before" ? te("notReleased") : te("soldOut");
      return NextResponse.json({ error: msg }, { status: 403 });
    }

    // A selected ticket type sets its own price; otherwise the listing price.
    const effectivePrice = ticketType ? ticketType.price : sale.price;

    // Free tickets — create booking directly
    if (!effectivePrice || effectivePrice <= 0) {
      const { createClient: createAdmin } = await import("@supabase/supabase-js");
      const admin = createAdmin(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      let scheduledAt: string;
      if (listing.event_date) {
        // event_date/event_time are Stockholm wall-clock; convert to UTC (DST-aware).
        scheduledAt =
          stockholmLocalToUtcISO(`${listing.event_date}T${listing.event_time || "00:00"}`) ??
          new Date().toISOString();
      } else {
        scheduledAt = new Date().toISOString();
      }

      // Duplicate guard: a double-tap/retry should not issue a second ticket to
      // the same email. Return the existing ticket link if one already exists.
      const baseUrlDup = process.env.NEXT_PUBLIC_APP_URL || "https://usha.se";
      const { data: existingTicket } = await admin
        .from("bookings")
        .select("id")
        .eq("listing_id", listing.id)
        .eq("guest_email", email)
        .eq("booking_type", "ticket")
        .neq("status", "canceled")
        .limit(1)
        .maybeSingle();
      if (existingTicket) {
        return NextResponse.json({ url: `${baseUrlDup}/biljett/${existingTicket.id}` });
      }

      // Atomically reserve a seat (row-locked capacity check) before creating
      // the booking, so concurrent guests can't oversell.
      const { data: reserved } = await admin.rpc("reserve_ticket", { p_listing: listing.id, p_ticket_type: ticketType?.id ?? undefined, p_n: qty });
      if (!reserved) {
        return NextResponse.json({ error: (await getTranslations("eventErrors"))("soldOut") }, { status: 403 });
      }

      const { data: booking, error: bookingError } = await admin
        .from("bookings")
        .insert({
          listing_id: listing.id,
          creator_id: listing.user_id,
          customer_id: null,
          guest_email: email,
          guest_name: name || null,
          status: "confirmed",
          scheduled_at: scheduledAt,
          booking_type: "ticket",
          amount_paid: 0,
          is_free: true,
          guest_count: qty,
          ticket_type_id: ticketType?.id ?? null,
          ticket_type_name: ticketType?.name ?? null,
        })
        .select("id")
        .single();

      // Release the reserved seats if the booking failed to persist.
      if (bookingError || !booking?.id) {
        await admin.rpc("increment_tickets_sold", { p_listing: listing.id, p_n: -qty, p_ticket_type: ticketType?.id ?? undefined });
        return NextResponse.json({ error: "Kunde inte skapa bokningen." }, { status: 500 });
      }

      // One scannable attendee per seat (only for multi-ticket orders).
      await createTicketAttendees(admin, booking.id, qty, attendeeNames);

      // Send the confirmation email with the ticket QR + public ticket link.
      // Without this, free guests got no email at all and no way to show a QR.
      const { data: creator } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", listing.user_id)
        .maybeSingle();
      const { sendBookingConfirmationEmail } = await import("@/lib/email/send-booking");
      sendBookingConfirmationEmail({
        to: email,
        customerName: name || "Gäst",
        serviceName: listing.title,
        scheduledAt: new Date(scheduledAt),
        creatorName: creator?.full_name || "Usha Platform",
        location: (listing as { event_location?: string }).event_location || undefined,
        bookingId: booking?.id,
      }).catch((e) => console.error("guest free-ticket confirmation email failed:", e));

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://usha.se";
      return NextResponse.json({
        url: booking?.id ? `${baseUrl}/biljett/${booking.id}` : `${baseUrl}/flode?ticket=success`,
      });
    }

    // Get creator for Connect account + seller identity
    const { data: creator } = await createAdminClient()
      .from("profiles")
      .select("stripe_account_id, tier, creator_subcategory, company_verified_at, stripe_card_payments_enabled, is_usha_owned_seller, company_name, org_number, full_name, terms_url")
      .eq("id", listing.user_id)
      .single();

    if (!creator) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Resolve flow first — Usha's own events (principal) need no connected account.
    const payee: PayeeContext = {
      id: listing.user_id,
      stripe_account_id: creator.stripe_account_id,
      card_payments_enabled: creator.stripe_card_payments_enabled ?? false,
      is_usha_owned_seller: creator.is_usha_owned_seller ?? false,
      company_name: creator.company_name ?? null,
      org_number: creator.org_number ?? null,
      full_name: creator.full_name ?? null,
    };
    const flow = resolvePayeeFlow(payee);

    if (flow === "third_party") {
      if (!creator.stripe_account_id) {
        return NextResponse.json(
          { error: "Creator has not connected their Stripe account" },
          { status: 400 }
        );
      }
      if (!canReceivePayments({ id: listing.user_id, company_verified_at: creator.company_verified_at })) {
        return NextResponse.json({ error: PAYMENTS_BETA_BLOCKED_MESSAGE }, { status: 403 });
      }
    }

    const amountInOre = Math.round(effectivePrice * 100);
    const commissionRate = getCreatorCommissionRate(
      creator.tier ?? "gratis",
      (creator as { creator_subcategory?: string | null }).creator_subcategory ?? null
    );
    const applicationFee = Math.round(amountInOre * commissionRate);

    // Tickster-style service fee (gated off until the flag is set). Fee is added
    // to the application_fee in both modes; "buyer" mode also adds a line item.
    const feeMode = serviceFeeMode(listing.service_fee_mode);
    const serviceFee = computeServiceFeeOre(amountInOre, qty); // total for all N tickets
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        price_data: {
          currency: "sek",
          product_data: { name: ticketType ? `${listing.title} – ${ticketType.name}` : listing.title },
          unit_amount: amountInOre,
        },
        quantity: qty,
      },
    ];
    if (serviceFee > 0 && feeMode === "buyer") {
      lineItems.push({
        price_data: {
          currency: "sek",
          product_data: { name: "Serviceavgift" },
          unit_amount: serviceFee,
        },
        quantity: 1,
      });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://usha.se";

    // Service-role client for the atomic capacity RPCs (the free block's `admin`
    // is block-scoped to that branch).
    const { createClient: createAdminPaid } = await import("@supabase/supabase-js");
    const admin = createAdminPaid(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Reserve the seat(s) NOW, before payment, so concurrent guests can't
    // oversell (the free path already does). The webhook skips its increment
    // when metadata.reserved==='true'; an abandoned checkout is released by the
    // checkout.session.expired handler (sessions expire after 30 min).
    const { data: paidReserved } = await admin.rpc("reserve_ticket", {
      p_listing: listing.id, p_ticket_type: ticketType?.id ?? undefined, p_n: qty,
    });
    if (!paidReserved) {
      const te = await getTranslations("eventErrors");
      return NextResponse.json({ error: te("soldOut") }, { status: 403 });
    }

    const customText = buildTermsCustomText(creator.terms_url);
    const paymentIntentData = buildConnectPaymentIntentData({
      flow,
      payee,
      applicationFeeOre: applicationFee * qty + serviceFee,
      metadata: buildPaymentMetadata({ flow, payee, eventId: listing.id, eventDate: listing.event_date, termsUrl: creator.terms_url }),
    });

    const stripeLocale = await getStripeLocale();
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create({
        locale: stripeLocale,
        customer_email: email,
        line_items: lineItems,
        mode: "payment",
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
        ...(paymentIntentData ? { payment_intent_data: paymentIntentData } : {}),
        ...(customText ? { custom_text: customText } : {}),
        automatic_tax: { enabled: true },
        // Clear confirmation screen for guests (no account) — the ticket QR is
        // emailed; landing on the feed left buyers unsure the purchase worked.
        success_url: `${baseUrl}/biljett/klar`,
        cancel_url: `${baseUrl}/flode`,
        metadata: {
          type: "guest_ticket",
          flow,
          listingId: listing.id,
          creatorId: listing.user_id,
          guestEmail: email,
          guestName: name || "",
          serviceFeeOre: String(serviceFee),
          serviceFeeMode: feeMode,
          platformFeeOre: String(applicationFee * qty + serviceFee),
          ticketTypeId: ticketType?.id ?? "",
          ticketTypeName: ticketType?.name ?? "",
          quantity: String(qty),
          attendeeNames: attendeeNamesToMeta(attendeeNames, qty),
          reserved: "true",
          eventDate: listing.event_date || "",
          eventTime: listing.event_time || "",
        },
      });
    } catch (e) {
      await admin.rpc("increment_tickets_sold", { p_listing: listing.id, p_n: -qty, p_ticket_type: ticketType?.id ?? undefined });
      throw e;
    }

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error("Guest checkout error:", error);
    return NextResponse.json(
      { error: "An error occurred. Please try again." },
      { status: 500 }
    );
  }
}
