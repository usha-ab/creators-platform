import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe/client";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// A tip is a one-time gratitude payment to a creator / taxi-dancer / crew
// member — NOT a wage. The full amount is a destination charge to the
// recipient's Connect account. Platform fee is 0 by default (goodwill);
// override with TIP_PLATFORM_FEE_BPS (basis points) if ever needed.
const MIN_ORE = 2_000; // 20 kr
const MAX_ORE = 500_000; // 5 000 kr
const FEE_BPS = parseInt(process.env.TIP_PLATFORM_FEE_BPS || "0", 10);

export async function POST(req: NextRequest) {
  const { rateLimit, getRateLimitKey } = await import("@/lib/rate-limit");
  const rl = rateLimit(getRateLimitKey(req, "tip-checkout"), 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "För många försök. Försök igen om en stund." }, { status: 429 });
  }

  try {
    const { recipientId, amountSek, message } = await req.json();

    const ore = Math.round(Number(amountSek) * 100);
    if (!recipientId || !Number.isFinite(ore) || ore < MIN_ORE || ore > MAX_ORE) {
      return NextResponse.json(
        { error: "Ange ett belopp mellan 20 och 5 000 kr." },
        { status: 400 }
      );
    }
    const note = typeof message === "string" ? message.trim().slice(0, 140) : "";

    // A signed-in user must not tip themselves.
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id === recipientId) {
      return NextResponse.json({ error: "Du kan inte tippa dig själv." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: recipient } = await admin
      .from("profiles")
      .select("full_name, stripe_account_id")
      .eq("id", recipientId)
      .maybeSingle();

    if (!recipient?.stripe_account_id) {
      return NextResponse.json(
        { error: "Mottagaren kan inte ta emot tips ännu.", code: "not_connected" },
        { status: 400 }
      );
    }

    // Recipient must have completed Connect onboarding (transfers active).
    try {
      const acct = await stripe.accounts.retrieve(recipient.stripe_account_id);
      if (acct.capabilities?.transfers !== "active") {
        return NextResponse.json(
          { error: "Mottagaren har inte slutfört sin Stripe-koppling.", code: "not_ready" },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Kunde inte verifiera mottagarens Stripe-konto." },
        { status: 502 }
      );
    }

    const fee = Math.round((ore * FEE_BPS) / 10_000);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://usha.se";
    const back = `/creators/${recipientId}`;

    const session = await stripe.checkout.sessions.create({
      customer_email: user?.email ?? undefined,
      line_items: [
        {
          price_data: {
            currency: "sek",
            product_data: { name: `Tips till ${recipient.full_name ?? "kreatör"}` },
            unit_amount: ore,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      payment_intent_data: {
        ...(fee > 0 ? { application_fee_amount: fee } : {}),
        transfer_data: { destination: recipient.stripe_account_id },
        description: note ? `Tips: ${note}` : "Tips",
      },
      success_url: `${appUrl}${back}?tip=success`,
      cancel_url: `${appUrl}${back}?tip=canceled`,
      metadata: {
        type: "tip",
        recipientId,
        tipperId: user?.id ?? "",
        message: note,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    console.error("Tip checkout error:", e?.message);
    return NextResponse.json({ error: "Något gick fel. Försök igen." }, { status: 500 });
  }
}
