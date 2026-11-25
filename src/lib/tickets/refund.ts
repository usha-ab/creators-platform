import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";

// ---------------------------------------------------------------------------
// Refund a booking's Stripe charge correctly for BOTH charge shapes.
//
// Ticket/experience checkouts use CONNECT DESTINATION CHARGES
// (payment_intent_data.transfer_data.destination + application_fee_amount):
// the gross already moved to the organizer's connected account and Usha's cut
// went to the platform as an application fee. A plain refunds.create({payment_
// intent}) refunds the BUYER from the PLATFORM balance but does NOT claw back
// the organizer's transfer or return the application fee — so Usha eats the
// whole amount on every ticket refund. That was the bug this fixes.
//
// For a destination charge we set reverse_transfer + refund_application_fee so
// the refund is funded by the organizer's transfer and Usha's fee is returned
// proportionally — the buyer is made whole, nobody is out of pocket. For a
// plain (non-Connect) charge those flags are omitted (Stripe rejects them).
// ---------------------------------------------------------------------------
export async function refundBookingCharge(
  paymentIntentId: string,
  /** Delåterbetalning i öre. Utelämnas = hela beloppet (som förut). */
  amountOre?: number
): Promise<{ refundId: string; amount: number }> {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge"],
  });
  const charge = pi.latest_charge as Stripe.Charge | null;

  // A destination charge carries a transfer to the connected account and/or an
  // application fee. Either signal means we must reverse the transfer and
  // refund the fee rather than eat the amount from the platform balance.
  const isDestinationCharge = !!(
    charge &&
    (charge.transfer || charge.application_fee_amount)
  );

  const refund = await stripe.refunds.create({
    payment_intent: paymentIntentId,
    ...(amountOre != null ? { amount: amountOre } : {}),
    ...(isDestinationCharge
      ? { reverse_transfer: true, refund_application_fee: true }
      : {}),
  });

  return { refundId: refund.id, amount: refund.amount };
}
