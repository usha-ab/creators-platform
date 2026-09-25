import { NextRequest, NextResponse } from "next/server";
import { UTM_COOKIE, parseUtm, utmMetadata } from "@/lib/analytics/utm";
import { REF_COOKIE, affiliateForPurchase } from "@/lib/affiliate/attribution";
import { getStripeLocale } from "@/lib/i18n/stripe-locale";
import { stripe } from "@/lib/stripe/client";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from '@/lib/supabase/admin';
import {
  calculateDiscountedPrice,
  getCreatorCommissionRate,
} from "@/lib/stripe/commission";
import { canReceivePayments, PAYMENTS_BETA_BLOCKED_MESSAGE } from "@/lib/payments/beta-gate";
import { resolvePayeeFlow, buildConnectPaymentIntentData, buildPaymentMetadata, buildTermsCustomText, type PayeeContext } from "@/lib/stripe/checkout";

/**
 * Creates a Stripe Checkout session for a paid manual booking.
 * Unlike ticket-checkout (auto-confirmed), this creates a pending booking
 * that the creator must confirm. If canceled, payment is refunded.
 */
export async function POST(req: NextRequest) {
  const { rateLimit, getRateLimitKey } = await import('@/lib/rate-limit');
  const rl = rateLimit(getRateLimitKey(req, 'stripe-booking-checkout'), 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const {
      listingId,
      creatorId,
      scheduledAt: requestedScheduledAt,
      notes,
      guestCount,
      specialRequests,
      attendees,
      promoCode,
    } = await req.json();

    if (!listingId || !creatorId) {
      return NextResponse.json(
        { error: "Listing and creator are required" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (creatorId === user.id) {
      return NextResponse.json(
        { error: "You cannot book your own service" },
        { status: 400 }
      );
    }

    // Get user tier
    const { data: userProfile } = await supabase
      .from("profiles")
      .select("tier")
      .eq("id", user.id)
      .single();
    const userTier = userProfile?.tier ?? null;

    // Get listing
    const { data: listing } = await supabase
      .from("listings")
      .select("id, title, price, user_id, is_active, min_guests, max_guests, listing_type, session_count")
      .eq("id", listingId)
      .single();

    if (!listing || !listing.is_active) {
      return NextResponse.json(
        { error: "Service not found or inactive" },
        { status: 404 }
      );
    }

    if (!listing.price || listing.price <= 0) {
      return NextResponse.json(
        { error: "Service has no price" },
        { status: 400 }
      );
    }

    // For package (klippkort) listings, scheduled_at represents the moment of purchase
    // (no specific event datetime). Override any client-supplied value.
    const scheduledAt = listing.listing_type === "package"
      ? new Date().toISOString()
      : requestedScheduledAt;

    if (!scheduledAt) {
      return NextResponse.json(
        { error: "Date is required" },
        { status: 400 }
      );
    }

    // Validate guest count
    const guests = guestCount ?? 1;
    if (listing.min_guests && guests < listing.min_guests) {
      return NextResponse.json(
        { error: `Minimum ${listing.min_guests} guests required` },
        { status: 400 }
      );
    }
    if (listing.max_guests && guests > listing.max_guests) {
      return NextResponse.json(
        { error: `Maximum ${listing.max_guests} guests allowed` },
        { status: 400 }
      );
    }

    // Get creator's Stripe Connect account + seller identity
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
    // Partnerprogrammet: vem ledde hit? Kontots värvare inom fönstret, annars cookien.
    const affiliateId = await affiliateForPurchase(createAdminClient(), { userId: user.id, refCookie: req.cookies.get(REF_COOKIE)?.value });
    // Kanalen köpet kom ifrån, från landningscookien.
    const utm = parseUtm(req.cookies.get(UTM_COOKIE)?.value);

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

    // Calculate pricing
    const originalPrice = listing.price;
    const discountedPrice = calculateDiscountedPrice(originalPrice, userTier);
    const amountInOre = Math.round(discountedPrice * 100);
    const creatorSubcategory = (creator as { creator_subcategory?: string | null }).creator_subcategory ?? null;
    const commissionRate = getCreatorCommissionRate(creator.tier ?? "gratis", creatorSubcategory);
    const applicationFee = Math.round(amountInOre * commissionRate);

    // Validate promo code if provided
    let promoCodeId: string | undefined;
    let promoDiscountAmount: number | undefined;
    if (promoCode) {
      const { validatePromoCode, applyPromoDiscount } = await import(
        "@/lib/promo/validate"
      );
      const validation = await validatePromoCode(promoCode, user.id, "ticket");
      if (validation.valid && validation.promo) {
        const result = applyPromoDiscount(
          discountedPrice,
          validation.promo.discount_type,
          validation.promo.discount_value
        );
        promoDiscountAmount = result.discountAmount;
        promoCodeId = validation.promo.id;
      }
    }

    const finalAmount = promoDiscountAmount
      ? Math.round((discountedPrice - promoDiscountAmount) * 100)
      : amountInOre;
    const finalFee = Math.round(finalAmount * commissionRate);

    // Build the Connect payment_intent_data + bookkeeping metadata (the booking's
    // scheduled time drives period accrual).
    const customText = buildTermsCustomText(creator.terms_url);
    const paymentIntentData = buildConnectPaymentIntentData({
      flow,
      payee,
      applicationFeeOre: finalFee,
      metadata: buildPaymentMetadata({ flow, payee, eventId: listing.id, eventDate: scheduledAt, termsUrl: creator.terms_url }),
    });

    // Create Stripe Checkout session
    const stripeLocale = await getStripeLocale();
    const session = await stripe.checkout.sessions.create({
      locale: stripeLocale,
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: "sek",
            product_data: {
              name: `Bokning: ${listing.title}`,
              description: guests > 1 ? `${guests} gäster` : undefined,
            },
            unit_amount: finalAmount,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      ...(paymentIntentData ? { payment_intent_data: paymentIntentData } : {}),
      ...(customText ? { custom_text: customText } : {}),
      automatic_tax: { enabled: true },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/app/tickets?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/creators/${listing.user_id}`,
      metadata: {
        type: "paid_booking",
        flow,
        listingId: listing.id,
        userId: user.id,
        creatorId: listing.user_id,
        scheduledAt,
        notes: notes || "",
        guestCount: String(guests),
        affiliateId: affiliateId ?? "",
        ...utmMetadata(utm),
        platformFeeOre: String(finalFee),
        specialRequests: specialRequests || "",
        attendees: (() => {
          const json = attendees ? JSON.stringify(attendees) : "[]";
          return json.length > 490 ? "[]" : json; // Stripe metadata limit: 500 chars
        })(),
        originalPrice: String(originalPrice),
        discountedPrice: String(discountedPrice),
        ...(listing.listing_type === "package" && (listing as { session_count?: number | null }).session_count
          ? { danceCount: String((listing as { session_count?: number | null }).session_count) }
          : {}),
        ...(promoCodeId && { promoCodeId }),
        ...(promoDiscountAmount && {
          promoDiscountAmount: String(promoDiscountAmount),
        }),
      },
    });

    return NextResponse.json({ sessionId: session.id, url: session.url });
  } catch (error: any) {
    console.error("Booking checkout error:", error);
    return NextResponse.json(
      { error: "An error occurred. Please try again." },
      { status: 500 }
    );
  }
}
