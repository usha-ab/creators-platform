import { NextRequest, NextResponse } from "next/server";
import { getStripeLocale } from "@/lib/i18n/stripe-locale";
import { stripe } from "@/lib/stripe/client";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from '@/lib/supabase/admin';
import { calculateDiscountedPrice, getCreatorCommissionRate, platformCommissionOre } from "@/lib/stripe/commission";
import { assignmentRoute, payrollRouteLive, ASSIGNMENT_PAYROLL_NOT_LIVE_MESSAGE } from "@/lib/assignments/route";
import { canReceivePayments, PAYMENTS_BETA_BLOCKED_MESSAGE } from "@/lib/payments/beta-gate";
import { loadPayeeEligibility } from "@/lib/payments/load-payee";
import { resolvePayeeFlow, buildConnectPaymentIntentData, buildPaymentMetadata, buildTermsCustomText, type PayeeContext } from "@/lib/stripe/checkout";
import { isNativeAppRequest, viaAppReturn } from "@/lib/native-return";

const PAYABLE_AFTER_CONFIRM = new Set(["b2b_offering", "service"]);

/**
 * Creates a Stripe Checkout session for an already-confirmed booking that the
 * creator accepted but that hasn't been paid yet (a paid `service` such as a
 * private lesson, or a `b2b_offering`). The booking already exists; this route
 * only attaches a payment to it. On webhook completion, the booking row is
 * updated with stripe_payment_id and amount_paid (no new row created).
 */
export async function POST(req: NextRequest) {
  const { rateLimit, getRateLimitKey } = await import('@/lib/rate-limit');
  const rl = rateLimit(getRateLimitKey(req, 'stripe-booking-pay'), 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const { bookingId } = await req.json();

    if (!bookingId) {
      return NextResponse.json(
        { error: "bookingId is required" },
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

    const { data: userProfile } = await supabase
      .from("profiles")
      .select("tier")
      .eq("id", user.id)
      .single();
    const userTier = userProfile?.tier ?? null;

    const { data: booking } = await supabase
      .from("bookings")
      .select("id, listing_id, creator_id, customer_id, status, stripe_payment_id, agreed_price, is_free")
      .eq("id", bookingId)
      .single();

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    if (booking.customer_id !== user.id) {
      return NextResponse.json({ error: "Not authorized for this booking" }, { status: 403 });
    }

    if (booking.status !== "confirmed") {
      return NextResponse.json(
        { error: "Booking must be confirmed by the creator before payment" },
        { status: 400 }
      );
    }

    if (booking.stripe_payment_id) {
      return NextResponse.json(
        { error: "Booking is already paid" },
        { status: 400 }
      );
    }

    if ((booking as { is_free?: boolean | null }).is_free) {
      return NextResponse.json(
        { error: "Denna bokning är gratis – ingen betalning krävs." },
        { status: 400 }
      );
    }

    const { data: listing } = await supabase
      .from("listings")
      .select("id, title, price, listing_type, user_id")
      .eq("id", booking.listing_id)
      .single();

    if (!listing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    if (!listing.listing_type || !PAYABLE_AFTER_CONFIRM.has(listing.listing_type)) {
      return NextResponse.json(
        { error: "This booking type cannot be paid here" },
        { status: 400 }
      );
    }

    // Resolve effective price: prefer the negotiated agreed_price on the booking
    // (B2B), otherwise the listing price with the buyer's membership discount
    // applied — matching what they were shown when booking.
    const agreedPrice = (booking as { agreed_price?: number | null }).agreed_price ?? null;
    const effectivePrice =
      agreedPrice != null && agreedPrice > 0
        ? agreedPrice
        : calculateDiscountedPrice(listing.price ?? 0, userTier);

    if (!effectivePrice || effectivePrice <= 0) {
      return NextResponse.json(
        { error: "Listing has no price" },
        { status: 400 }
      );
    }

    const { data: creator } = await createAdminClient()
      .from("profiles")
      .select("stripe_account_id, tier, creator_subcategory, is_company, company_verified_at, stripe_card_payments_enabled, is_usha_owned_seller, company_name, org_number, full_name, terms_url")
      .eq("id", listing.user_id)
      .single();

    if (!creator) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Ett uppdrag till en kreatör utan bolag får aldrig betalas direkt till
    // kreatören: beställaren blir då arbetsgivare. Det säljs av Usha och betalas
    // som lön, och den vägen är inte i drift än. Kontrollen ligger FÖRE
    // betagrinden, så att NEXT_PUBLIC_PAYMENTS_OPEN aldrig kan öppna den.
    const isPayrollAssignment =
      listing.listing_type === "b2b_offering" &&
      assignmentRoute({
        is_company: creator.is_company ?? null,
        company_verified_at: creator.company_verified_at,
        is_usha_owned_seller: creator.is_usha_owned_seller,
      }) === "payroll";
    if (isPayrollAssignment && !payrollRouteLive({ customerId: user.id, creatorId: listing.user_id })) {
      return NextResponse.json({ error: ASSIGNMENT_PAYROLL_NOT_LIVE_MESSAGE }, { status: 409 });
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
    // Uppdrag på lönevägen säljs av Usha i eget namn: hela beloppet stannar på
    // plattformskontot, och kreatören får lön via SAMekonomi efter passet.
    const flow = isPayrollAssignment ? "usha_principal" : resolvePayeeFlow(payee);

    if (flow === "third_party") {
      if (!creator.stripe_account_id) {
        return NextResponse.json(
          { error: "Creator has not connected their Stripe account" },
          { status: 400 }
        );
      }
      if (!canReceivePayments(await loadPayeeEligibility(listing.user_id))) {
        return NextResponse.json({ error: PAYMENTS_BETA_BLOCKED_MESSAGE }, { status: 403 });
      }
    }

    const amountInOre = Math.round(effectivePrice * 100);
    const creatorSubcategory = (creator as { creator_subcategory?: string | null }).creator_subcategory ?? null;
    const commissionRate = getCreatorCommissionRate(creator.tier ?? "gratis", creatorSubcategory);
    // Ushas egna arrangemang (usha_principal) bär ingen provision: pengarna är
    // redan Ushas, och en avgift mot sig själv hade bara skräpat ner avräkningen.
    const applicationFee = flow === "usha_principal" ? 0 : platformCommissionOre(amountInOre, 1);

    const customText = buildTermsCustomText(creator.terms_url);
    const paymentIntentData = buildConnectPaymentIntentData({
      flow,
      payee,
      applicationFeeOre: applicationFee,
      metadata: buildPaymentMetadata({ flow, payee, eventId: listing.id, termsUrl: creator.terms_url }),
    });

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
            },
            unit_amount: amountInOre,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      ...(paymentIntentData ? { payment_intent_data: paymentIntentData } : {}),
      ...(customText ? { custom_text: customText } : {}),
      automatic_tax: { enabled: true },
      success_url: viaAppReturn(`${process.env.NEXT_PUBLIC_APP_URL}/app/tickets?success=true`, isNativeAppRequest(req)),
      cancel_url: viaAppReturn(`${process.env.NEXT_PUBLIC_APP_URL}/app/tickets`, isNativeAppRequest(req)),
      metadata: {
        type: "b2b_payment",
        flow,
        bookingId: booking.id,
        userId: user.id,
        creatorId: listing.user_id,
        listingId: listing.id,
        ...(isPayrollAssignment ? { assignment: "payroll" } : {}),
      },
    });

    return NextResponse.json({ sessionId: session.id, url: session.url });
  } catch (error: unknown) {
    console.error("B2B booking-pay error:", error);
    return NextResponse.json(
      { error: "An error occurred. Please try again." },
      { status: 500 }
    );
  }
}
