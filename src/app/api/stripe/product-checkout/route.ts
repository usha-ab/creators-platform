import { NextRequest, NextResponse } from "next/server";
import { getStripeLocale } from "@/lib/i18n/stripe-locale";
import { stripe } from "@/lib/stripe/client";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCreatorCommissionRate, platformCommissionOre } from "@/lib/stripe/commission";
import { canReceivePayments, PAYMENTS_BETA_BLOCKED_MESSAGE } from "@/lib/payments/beta-gate";
import { loadPayeeEligibility } from "@/lib/payments/load-payee";
import { resolvePayeeFlow, buildConnectPaymentIntentData, buildPaymentMetadata, buildTermsCustomText, type PayeeContext } from "@/lib/stripe/checkout";
import { isNativeAppRequest, viaAppReturn } from "@/lib/native-return";

export async function POST(req: NextRequest) {
  const { rateLimit, getRateLimitKey } = await import('@/lib/rate-limit');
  const rl = rateLimit(getRateLimitKey(req, 'product-checkout'), 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { productId, promoCode } = await req.json();

    if (!productId) {
      return NextResponse.json({ error: "Product ID is required" }, { status: 400 });
    }

    // Fetch the product
    const { data: product } = await supabase
      .from("digital_products")
      .select("id, title, description, price, creator_id, is_active")
      .eq("id", productId)
      .single();

    if (!product || !product.is_active) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    // Check if already purchased
    const { data: existingPurchase } = await supabase
      .from("digital_purchases")
      .select("id")
      .eq("product_id", productId)
      .eq("buyer_id", user.id)
      .single();

    if (existingPurchase) {
      return NextResponse.json({ error: "You have already purchased this product" }, { status: 400 });
    }

    // Check promo code
    let discount = 0;
    let creatorPromoId: string | null = null;
    if (promoCode) {
      const { data: promo } = await supabase
        .from("creator_promo_codes")
        .select("id, creator_id, discount_percent, discount_amount, max_uses, times_used, is_active, valid_until")
        .eq("code", promoCode.toUpperCase())
        .eq("is_active", true)
        .single();

      if (promo) {
        // Verify promo code belongs to the same creator as the product
        if (promo.creator_id !== product.creator_id) {
          return NextResponse.json({ error: "Promo code is not valid for this product" }, { status: 400 });
        }
        const now = new Date();
        const validUntil = promo.valid_until ? new Date(promo.valid_until) : null;
        if ((!validUntil || validUntil > now) && (!promo.max_uses || promo.times_used < promo.max_uses)) {
          if (promo.discount_percent > 0) {
            discount = Math.round(product.price * promo.discount_percent / 100);
          } else if (promo.discount_amount > 0) {
            discount = promo.discount_amount;
          }
          creatorPromoId = promo.id;
        }
      }
    }

    const finalPrice = Math.max(product.price - discount, 0);

    // If free after discount, record purchase directly
    if (finalPrice === 0) {
      const { error: freeErr } = await supabase.from("digital_purchases").insert({
        product_id: productId,
        buyer_id: user.id,
        amount_paid: 0,
        promo_code: promoCode || null,
        creator_promo_id: creatorPromoId,
      });
      // Don't send the buyer to their library claiming success if the row didn't
      // land (a duplicate/23505 means they already own it — that's fine).
      if (freeErr && freeErr.code !== "23505") {
        console.error("free digital purchase insert failed:", freeErr);
        return NextResponse.json({ error: "Kunde inte slutföra köpet. Försök igen." }, { status: 500 });
      }

      // Increment promo usage atomically (single guarded UPDATE via SECURITY
      // DEFINER RPC) to avoid the read-modify-write race that could undercount
      // uses and let a code be redeemed past its max_uses.
      if (promoCode && creatorPromoId) {
        try {
          await createAdminClient().rpc("increment_creator_promo_uses", { p_code: promoCode.toUpperCase() } as any);
        } catch {}
      }

      return NextResponse.json({ url: `/app/library?purchased=${productId}` });
    }

    // Paid digital product → destination charge to the creator's Connect account
    // so the gross goes to the creator and only the commission lands on Usha
    // (§1.1 / G4 — gross must never land on Usha's account).
    const { data: creator } = await createAdminClient()
      .from("profiles")
      .select("stripe_account_id, tier, creator_subcategory, company_verified_at, stripe_card_payments_enabled, is_usha_owned_seller, company_name, org_number, full_name, terms_url")
      .eq("id", product.creator_id)
      .single();

    if (!creator) {
      return NextResponse.json({ error: "Produkten hittades inte." }, { status: 404 });
    }

    // Resolve flow first — Usha's own products (principal) need no connected account.
    const payee: PayeeContext = {
      id: product.creator_id,
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
        return NextResponse.json({ error: "Kreatören har inte kopplat Stripe ännu." }, { status: 400 });
      }
      if (!canReceivePayments(await loadPayeeEligibility(product.creator_id))) {
        return NextResponse.json({ error: PAYMENTS_BETA_BLOCKED_MESSAGE }, { status: 403 });
      }
    }

    const commissionRate = getCreatorCommissionRate(
      creator.tier ?? "gratis",
      (creator as { creator_subcategory?: string | null }).creator_subcategory ?? null,
    );
    const amountOre = finalPrice * 100;
    // Ushas egna arrangemang (usha_principal) bär ingen provision: pengarna är
    // redan Ushas, och en avgift mot sig själv hade bara skräpat ner avräkningen.
    const applicationFee = flow === "usha_principal" ? 0 : platformCommissionOre(amountOre, 1);

    const customText = buildTermsCustomText(creator.terms_url);
    const paymentIntentData = buildConnectPaymentIntentData({
      flow,
      payee,
      applicationFeeOre: applicationFee,
      metadata: buildPaymentMetadata({ flow, payee, eventId: productId, termsUrl: creator.terms_url }),
    });

    // Create Stripe checkout session
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://usha.se";
    const stripeLocale = await getStripeLocale();
    const session = await stripe.checkout.sessions.create({
      locale: stripeLocale,
      mode: "payment",
      // Inga pinnade payment_method_types — Stripe visar de metoder som aktiverats
      // i Dashboard (kort, Swish, Klarna) för behöriga SE/SEK-kunder, som övriga flöden.
      ...(paymentIntentData ? { payment_intent_data: paymentIntentData } : {}),
      ...(customText ? { custom_text: customText } : {}),
      line_items: [
        {
          price_data: {
            currency: "sek",
            product_data: {
              name: product.title,
              description: product.description || undefined,
            },
            unit_amount: amountOre, // öre
          },
          quantity: 1,
        },
      ],
      metadata: {
        type: "digital_product",
        flow,
        product_id: productId,
        buyer_id: user.id,
        creator_id: product.creator_id,
        promo_code: promoCode || "",
        creator_promo_id: creatorPromoId || "",
      },
      automatic_tax: { enabled: true },
      success_url: viaAppReturn(`${baseUrl}/app/library?purchased=${productId}`, isNativeAppRequest(req)),
      cancel_url: viaAppReturn(`${baseUrl}/creators/${product.creator_id}`, isNativeAppRequest(req)),
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Product checkout error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
