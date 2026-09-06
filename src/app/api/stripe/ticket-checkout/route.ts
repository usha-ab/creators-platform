import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripeLocale } from "@/lib/i18n/stripe-locale";
import { stripe } from '@/lib/stripe/client';
import { computeServiceFeeOre, serviceFeeMode } from '@/lib/tickets/service-fee';
import { applicableCredit } from '@/lib/credits/signup';
import { clampQuantity, createTicketAttendees, attendeeNamesToMeta } from '@/lib/tickets/attendees';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getSaleState } from '@/lib/listings/sale-state';
import { stockholmLocalToUtcISO } from '@/lib/time';
import { getTranslations } from 'next-intl/server';
import {
  calculateDiscountedPrice,
  getCreatorCommissionRate,
} from '@/lib/stripe/commission';
import { isGoldExclusive } from '@/lib/listings/early-bird';
import { canReceivePayments, PAYMENTS_BETA_BLOCKED_MESSAGE } from '@/lib/payments/beta-gate';
import { resolvePayeeFlow, buildConnectPaymentIntentData, buildPaymentMetadata, buildTermsCustomText, type PayeeContext } from '@/lib/stripe/checkout';

export async function POST(req: NextRequest) {
  const { rateLimit, getRateLimitKey } = await import('@/lib/rate-limit');
  const rl = rateLimit(getRateLimitKey(req, 'stripe-ticket-checkout'), 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const { listingId, ticketTypeId, quantity, attendeeNames } = await req.json();
    const qty = clampQuantity(quantity);

    if (!listingId) {
      return NextResponse.json(
        { error: 'listingId is required' },
        { status: 400 }
      );
    }

    // Authenticate user
    const supabase = await createClient();
    // Capacity RPCs (reserve_ticket / increment_tickets_sold) run via the
    // service-role client: EXECUTE on them is revoked from anon/authenticated so
    // the anon key can't call them directly to force events sold-out.
    const admin = createAdminClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's tier from profile
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('tier')
      .eq('id', user.id)
      .single();

    const userTier = userProfile?.tier ?? null;

    // Get listing details
    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .select('id, title, price, user_id, is_active, event_date, event_time, release_to_gold_at, early_bird_start, early_bird_end, early_bird_price, public_sale_at, capacity, tickets_sold, service_fee_mode')
      .eq('id', listingId)
      .single();

    if (listingError || !listing) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      );
    }

    if (!listing.is_active) {
      return NextResponse.json(
        { error: 'Event is not active' },
        { status: 400 }
      );
    }

    if (listing.user_id === user.id) {
      return NextResponse.json(
        { error: 'You cannot buy a ticket to your own event' },
        { status: 400 }
      );
    }

    // Optional ticket type (price tier). When present it overrides the price and
    // capacity for this purchase; validated to belong to this listing.
    let ticketType: { id: string; name: string; price: number; capacity: number | null; tickets_sold: number } | null = null;
    if (ticketTypeId) {
      const { data: tt } = await supabase
        .from('ticket_types')
        .select('id, name, price, capacity, tickets_sold')
        .eq('id', ticketTypeId)
        .eq('listing_id', listing.id)
        .single();
      if (!tt) {
        return NextResponse.json({ error: 'Invalid ticket type' }, { status: 400 });
      }
      ticketType = tt as { id: string; name: string; price: number; capacity: number | null; tickets_sold: number };
      if (ticketType!.capacity != null && ticketType!.tickets_sold >= ticketType!.capacity) {
        const te = await getTranslations('eventErrors');
        return NextResponse.json({ error: te('soldOut') }, { status: 403 });
      }
    }

    // Prevent duplicate ticket purchases for the same event
    const { count: existingTickets } = await supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('listing_id', listingId)
      .eq('customer_id', user.id)
      .eq('booking_type', 'ticket')
      .in('status', ['pending', 'confirmed']);

    if (existingTickets && existingTickets > 0) {
      return NextResponse.json(
        { error: 'You already have a ticket for this event' },
        { status: 409 }
      );
    }

    // Early bird: block gratis users during Gold-exclusive window
    if (listing.release_to_gold_at) {
      const releaseDate = new Date(listing.release_to_gold_at);
      if (isGoldExclusive(releaseDate) && userTier !== 'guld' && userTier !== 'premium') {
        const hours = Math.ceil((releaseDate.getTime() - Date.now()) / (60 * 60 * 1000));
        return NextResponse.json(
          { error: `This event is exclusive to Gold/Premium members for another ${hours} hours.` },
          { status: 403 }
        );
      }
    }

    // Timed automation: block when not buyable (sold out / not released yet)
    // and use the effective price (early-bird price during the window).
    const sale = getSaleState(listing, new Date());
    if (!sale.buyable) {
      const te = await getTranslations('eventErrors');
      const msg =
        sale.state === 'past' ? te('past') :
        sale.state === 'before' ? te('notReleased') : te('soldOut');
      return NextResponse.json({ error: msg }, { status: 403 });
    }

    // A selected ticket type sets its own price; otherwise the listing price
    // (honouring the early-bird window) applies.
    const effectivePrice = ticketType ? ticketType.price : sale.price;

    // Free tickets — create booking directly without Stripe
    if (!effectivePrice || effectivePrice <= 0) {
      // Atomically reserve a seat (row-locked capacity check) so concurrent
      // free-ticket requests can't oversell the event (or the ticket type).
      const { data: reserved } = await admin.rpc('reserve_ticket', { p_listing: listing.id, p_ticket_type: ticketType?.id ?? undefined, p_n: qty });
      if (!reserved) {
        const te = await getTranslations('eventErrors');
        return NextResponse.json({ error: te('soldOut') }, { status: 403 });
      }

      let scheduledAt: string;
      if (listing.event_date) {
        // event_date/event_time are Stockholm wall-clock; convert to UTC (DST-aware).
        scheduledAt =
          stockholmLocalToUtcISO(`${listing.event_date}T${listing.event_time || "00:00"}`) ??
          new Date().toISOString();
      } else {
        scheduledAt = new Date().toISOString();
      }

      const { data: freeBooking, error: insertError } = await supabase.from('bookings').insert({
        listing_id: listing.id,
        creator_id: listing.user_id,
        customer_id: user.id,
        status: 'confirmed',
        scheduled_at: scheduledAt,
        booking_type: 'ticket',
        amount_paid: 0,
        guest_count: qty,
        ticket_type_id: ticketType?.id ?? null,
        ticket_type_name: ticketType?.name ?? null,
      }).select('id').single();

      if (insertError) {
        // Release the seats we reserved, then find out why the insert failed.
        await admin.rpc('increment_tickets_sold', { p_listing: listing.id, p_n: -qty, p_ticket_type: ticketType?.id ?? undefined });
        const { count } = await supabase
          .from('bookings')
          .select('id', { count: 'exact', head: true })
          .eq('listing_id', listingId)
          .eq('customer_id', user.id)
          .eq('booking_type', 'ticket')
          .in('status', ['confirmed', 'completed']);
        if (count && count > 0) {
          return NextResponse.json(
            { error: 'You already have a ticket for this event' },
            { status: 409 }
          );
        }
        return NextResponse.json({ error: 'Could not create booking' }, { status: 500 });
      }

      // One scannable attendee per seat (only for multi-ticket orders).
      if (freeBooking?.id) await createTicketAttendees(createAdminClient(), freeBooking.id, qty, attendeeNames);

      return NextResponse.json({
        url: `${process.env.NEXT_PUBLIC_APP_URL}/app/tickets?success=true`,
      });
    }

    // Get creator profile (for Connect account, tier, and seller identity)
    const { data: creator } = await createAdminClient()
      .from('profiles')
      .select('stripe_account_id, tier, creator_subcategory, company_verified_at, stripe_card_payments_enabled, is_usha_owned_seller, company_name, org_number, full_name, terms_url')
      .eq('id', listing.user_id)
      .single();

    if (!creator) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Resolve the accounting flow first. Usha's own events (principal/gross) run
    // directly on the platform account — no connected account, no transfer, no
    // application fee — so the Connect-account guard + beta-gate apply only to
    // third-party organizers.
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

    if (flow === 'third_party') {
      if (!creator.stripe_account_id) {
        return NextResponse.json(
          { error: 'Creator has not connected their Stripe account' },
          { status: 400 }
        );
      }
      if (!canReceivePayments({ id: listing.user_id, company_verified_at: creator.company_verified_at })) {
        return NextResponse.json({ error: PAYMENTS_BETA_BLOCKED_MESSAGE }, { status: 403 });
      }
    }

    // Calculate pricing — the ticket type's price, else the early-bird price.
    const originalPrice = effectivePrice;
    const discountedPrice = calculateDiscountedPrice(originalPrice, userTier);
    const amountInOre = Math.round(discountedPrice * 100);
    const commissionRate = getCreatorCommissionRate(
      creator.tier ?? 'gratis',
      (creator as { creator_subcategory?: string | null }).creator_subcategory ?? null
    );
    const applicationFee = Math.round(amountInOre * commissionRate);
    // OBS: applicationFee räknas per biljett på ordinarie pris nedan, och
    // avdraget dras från Ushas egen del i slutänden (se creditOre).

    // Tickster-style service fee (gated off until the flag is set). In BOTH
    // modes the fee is added to the application_fee so it stays with Usha; in
    // "buyer" mode it is ALSO added as a line item so the buyer pays it on top.
    const feeMode = serviceFeeMode(listing.service_fee_mode);
    const serviceFee = computeServiceFeeOre(amountInOre, qty); // total for all N tickets
    // Välkomstavdraget. Räknas på ordersumman för biljetterna, INTE på
    // serviceavgiften — avgiften är Ushas ersättning, inte en del av köpet.
    //
    // Avdraget dras som en egen negativ post går inte i Stripe, så det görs på
    // biljettradens styckpris. Med flera biljetter fördelas det över hela
    // ordern, vilket är samma sak för köparen och gör att qty * unit_amount
    // fortfarande stämmer med det Stripe drar.
    const subtotalOre = amountInOre * qty;
    const { data: creditRow } = await admin
      .from('account_credits')
      .select('amount_ore, used_at, expires_at')
      .eq('user_id', user.id)
      .maybeSingle();
    const creditOre = applicableCredit({
      creditOre: creditRow?.amount_ore,
      subtotalOre,
      used: !!creditRow?.used_at,
      expired: !!creditRow?.expires_at && new Date(creditRow.expires_at) < new Date(),
    });
    const payableOre = subtotalOre - creditOre;
    // Styckpriset avrundas nedåt och resten läggs på första biljetten, så att
    // summan blir exakt även när avdraget inte går jämnt upp på antalet.
    const unitAfterCredit = Math.floor(payableOre / qty);
    const remainderOre = payableOre - unitAfterCredit * qty;

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        price_data: {
          currency: 'sek',
          product_data: { name: ticketType ? `${listing.title} – ${ticketType.name}` : listing.title },
          unit_amount: unitAfterCredit,
        },
        quantity: qty,
      },
    ];
    if (remainderOre > 0) {
      lineItems.push({
        price_data: {
          currency: 'sek',
          product_data: { name: ticketType ? `${listing.title} – ${ticketType.name}` : listing.title },
          unit_amount: remainderOre,
        },
        quantity: 1,
      });
    }
    if (serviceFee > 0 && feeMode === 'buyer') {
      lineItems.push({
        price_data: {
          currency: 'sek',
          product_data: { name: 'Serviceavgift' },
          unit_amount: serviceFee,
        },
        quantity: 1,
      });
    }

    // Reserve the seat(s) NOW, before payment, so concurrent buyers can't
    // oversell. The free path already reserves up front; the paid path used to
    // only count in the webhook, which let two buyers pass the capacity check
    // and both pay. The webhook SKIPS its increment when metadata.reserved is
    // 'true'; an abandoned checkout is released by the checkout.session.expired
    // handler (sessions expire after 30 min).
    const { data: paidReserved } = await admin.rpc('reserve_ticket', {
      p_listing: listing.id, p_ticket_type: ticketType?.id ?? undefined, p_n: qty,
    });
    if (!paidReserved) {
      const te = await getTranslations('eventErrors');
      return NextResponse.json({ error: te('soldOut') }, { status: 403 });
    }

    // Build the Connect payment_intent_data + bookkeeping metadata (stamped on
    // every payment, including the principal flow).
    const customText = buildTermsCustomText(creator.terms_url);
    const paymentIntentData = buildConnectPaymentIntentData({
      flow,
      payee,
      // Usha bär avdraget, och det syns här: plattformsavgiften minskas med
      // hela avdraget innan den dras. Arrangören får alltså lika mycket som
      // om köparen betalat fullt, ända tills avdraget överstiger Ushas egen
      // avgift — då finns inget mer av Ushas del att ge, och resten hamnar
      // hos arrangören. I dag är arrangören och Usha samma bolag på varje
      // kväll som säljer biljetter, så det är en gräns i teorin.
      //
      // Partnern är skyddad oavsett: avräkningen räknas på ordinarie pris via
      // bookings.credit_applied_ore, inte på det köparen betalade.
      applicationFeeOre: Math.max(0, applicationFee * qty + serviceFee - creditOre),
      metadata: buildPaymentMetadata({ flow, payee, eventId: listing.id, eventDate: listing.event_date, termsUrl: creator.terms_url }),
    });

    // Create Stripe Checkout session with Connect split
    const stripeLocale = await getStripeLocale();
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create({
        locale: stripeLocale,
        customer_email: user.email,
        line_items: lineItems,
        mode: 'payment',
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
        ...(paymentIntentData ? { payment_intent_data: paymentIntentData } : {}),
        ...(customText ? { custom_text: customText } : {}),
        automatic_tax: { enabled: true },
        success_url: `${process.env.NEXT_PUBLIC_APP_URL}/app/tickets?success=true`,
        cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/creators/${listing.user_id}`,
        metadata: {
          type: 'ticket',
          flow,
          listingId: listing.id,
          userId: user.id,
          creatorId: listing.user_id,
          originalPrice: String(originalPrice),
          discountedPrice: String(discountedPrice),
          serviceFeeOre: String(serviceFee),
          serviceFeeMode: feeMode,
          platformFeeOre: String(Math.max(0, applicationFee * qty + serviceFee - creditOre)),
          ticketTypeId: ticketType?.id ?? '',
          ticketTypeName: ticketType?.name ?? '',
          creditOre: String(creditOre),
          quantity: String(qty),
          attendeeNames: attendeeNamesToMeta(attendeeNames, qty),
          reserved: 'true',
          eventDate: listing.event_date || '',
          eventTime: listing.event_time || '',
        },
      });
    } catch (e) {
      // Release the seats we reserved if Stripe couldn't create the session.
      await admin.rpc('increment_tickets_sold', { p_listing: listing.id, p_n: -qty, p_ticket_type: ticketType?.id ?? undefined });
      throw e;
    }

    return NextResponse.json({ sessionId: session.id, url: session.url });
  } catch (error: any) {
    console.error('Ticket checkout error:', error);
    const message = error?.message || 'Could not start checkout';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
