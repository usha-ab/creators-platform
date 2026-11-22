import { NextRequest, NextResponse } from "next/server";
import { getStripeLocale } from "@/lib/i18n/stripe-locale";
import { stripe } from "@/lib/stripe/client";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from '@/lib/supabase/admin';
import { getCreatorCommissionRate, platformCommissionOre } from "@/lib/stripe/commission";
import { priceForMinutes, isMinuteOption, MIN_PRICE_SEK } from "@/lib/coaching/minute-pricing";
import { canReceivePayments, PAYMENTS_BETA_BLOCKED_MESSAGE } from "@/lib/payments/beta-gate";
import { loadPayeeEligibility } from "@/lib/payments/load-payee";
import { resolvePayeeFlow, buildConnectPaymentIntentData, buildPaymentMetadata, buildTermsCustomText, type PayeeContext } from "@/lib/stripe/checkout";
import { assignmentRoute, payrollRouteLive } from "@/lib/assignments/route";
import { MINUTES_PAYROLL_NOT_LIVE_MESSAGE } from "@/lib/coaching/minutes-payroll";
import { isNativeAppRequest, viaAppReturn } from "@/lib/native-return";

/**
 * Creates a Stripe Checkout session for buying a block of instructor minutes
 * (15/30/45/60) at an open event. Money is transferred to the INSTRUCTOR's
 * Connect account (not the event host). The webhook creates a confirmed
 * booking with minutes_total that the instructor redeems on-site.
 */
export async function POST(req: NextRequest) {
  const { rateLimit, getRateLimitKey } = await import("@/lib/rate-limit");
  const rl = rateLimit(getRateLimitKey(req, "stripe-instructor-minutes"), 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const { listingId, instructorId, minutes } = await req.json();

    if (!listingId || !instructorId || !minutes) {
      return NextResponse.json({ error: "Listing, instructor and minutes are required" }, { status: 400 });
    }
    const mins = Number(minutes);
    if (!isMinuteOption(mins)) {
      return NextResponse.json({ error: "Ogiltigt antal minuter" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Du måste vara inloggad för att köpa minuter." }, { status: 401 });
    }
    if (instructorId === user.id) {
      return NextResponse.json({ error: "Du kan inte köpa din egen tid." }, { status: 400 });
    }

    // Event must exist, be active and open to instructors
    const { data: listing } = await supabase
      .from("listings")
      .select("id, title, slug, user_id, is_active, open_to_instructors")
      .eq("id", listingId)
      .single();
    if (!listing || !listing.is_active) {
      return NextResponse.json({ error: "Eventet hittades inte." }, { status: 404 });
    }
    if (!listing.open_to_instructors) {
      return NextResponse.json({ error: "Eventet är inte öppet för instruktörer." }, { status: 400 });
    }

    // Instructor must currently be joined to this event
    const { data: joinedRow } = await supabase
      .from("event_instructors")
      .select("id")
      .eq("listing_id", listingId)
      .eq("instructor_id", instructorId)
      .maybeSingle();
    if (!joinedRow) {
      return NextResponse.json({ error: "Instruktören är inte längre med på detta event." }, { status: 400 });
    }

    // Instructor profile: Connect account + rate + commission inputs
    const { data: instructor } = await createAdminClient()
      .from("profiles")
      .select("full_name, stripe_account_id, tier, creator_subcategory, coaching_hourly_rate_sek, offers_coaching, is_company, company_verified_at, stripe_card_payments_enabled, is_usha_owned_seller, company_name, org_number, terms_url")
      .eq("id", instructorId)
      .single();

    if (!instructor) {
      return NextResponse.json({ error: "Instruktören hittades inte." }, { status: 404 });
    }

    // Instruktör utan verifierat bolag får aldrig betalas direkt — köparen blir
    // då arbetsgivare. Usha säljer minuterna och instruktören får lön via
    // SAMekonomi. Kontrollen ligger FÖRE betagrinden, så att
    // NEXT_PUBLIC_PAYMENTS_OPEN aldrig kan öppna lönevägen.
    const isPayroll =
      assignmentRoute({
        is_company: (instructor as { is_company?: boolean | null }).is_company ?? null,
        company_verified_at: instructor.company_verified_at,
        is_usha_owned_seller: (instructor as { is_usha_owned_seller?: boolean }).is_usha_owned_seller ?? null,
      }) === "payroll";
    if (isPayroll && !payrollRouteLive({ customerId: user.id, creatorId: instructorId })) {
      return NextResponse.json({ error: MINUTES_PAYROLL_NOT_LIVE_MESSAGE }, { status: 409 });
    }

    // Resolve flow first — a Usha-owned payee (principal) needs no connected account.
    const payee: PayeeContext = {
      id: instructorId,
      stripe_account_id: instructor.stripe_account_id,
      card_payments_enabled: (instructor as { stripe_card_payments_enabled?: boolean }).stripe_card_payments_enabled ?? false,
      is_usha_owned_seller: (instructor as { is_usha_owned_seller?: boolean }).is_usha_owned_seller ?? false,
      company_name: (instructor as { company_name?: string | null }).company_name ?? null,
      org_number: (instructor as { org_number?: string | null }).org_number ?? null,
      full_name: instructor.full_name ?? null,
    };
    // Lönevägen: hela beloppet stannar på plattformskontot.
    const flow = isPayroll ? "usha_principal" : resolvePayeeFlow(payee);

    if (flow === "third_party") {
      if (!instructor.stripe_account_id) {
        return NextResponse.json({ error: "Instruktören kan inte ta emot betalningar ännu." }, { status: 400 });
      }
      if (!canReceivePayments(await loadPayeeEligibility(instructorId))) {
        return NextResponse.json({ error: PAYMENTS_BETA_BLOCKED_MESSAGE }, { status: 403 });
      }
    }
    if (!instructor.offers_coaching || !instructor.coaching_hourly_rate_sek || instructor.coaching_hourly_rate_sek <= 0) {
      return NextResponse.json({ error: "Instruktören har inget timpris satt." }, { status: 400 });
    }

    const priceSek = priceForMinutes(instructor.coaching_hourly_rate_sek, mins);
    if (priceSek < MIN_PRICE_SEK) {
      return NextResponse.json({ error: "Priset är för lågt för köp." }, { status: 400 });
    }
    const amountInOre = priceSek * 100;
    const commissionRate = getCreatorCommissionRate(instructor.tier ?? "gratis", instructor.creator_subcategory ?? null);
    // Ushas egna arrangemang (usha_principal) bär ingen provision: pengarna är
    // redan Ushas, och en avgift mot sig själv hade bara skräpat ner avräkningen.
    const applicationFee = flow === "usha_principal" ? 0 : platformCommissionOre(amountInOre, 1);

    const termsUrl = (instructor as { terms_url?: string | null }).terms_url ?? null;
    const customText = buildTermsCustomText(termsUrl);
    const paymentIntentData = buildConnectPaymentIntentData({
      flow,
      payee,
      applicationFeeOre: applicationFee,
      metadata: buildPaymentMetadata({ flow, payee, eventId: listing.id, termsUrl }),
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
              name: `${mins} min med ${instructor.full_name || "instruktör"} – ${listing.title}`,
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
      cancel_url: viaAppReturn(`${process.env.NEXT_PUBLIC_APP_URL}/listing/${listing.slug || listing.id}`, isNativeAppRequest(req)),
      metadata: {
        type: "instructor_minutes",
        flow,
        userId: user.id,
        instructorId,
        listingId: listing.id,
        minutes: String(mins),
        ...(isPayroll ? { payroll: "true" } : {}),
      },
    });

    return NextResponse.json({ sessionId: session.id, url: session.url });
  } catch (error: any) {
    console.error("Instructor minutes checkout error:", error);
    return NextResponse.json({ error: "Ett fel uppstod. Försök igen." }, { status: 500 });
  }
}
