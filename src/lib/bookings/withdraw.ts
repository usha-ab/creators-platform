import type { SupabaseClient } from "@supabase/supabase-js";
import { refundBookingCharge } from "@/lib/tickets/refund";
import { voidRewardsForBooking } from "@/lib/affiliate/rewards";
import { createNotification } from "@/lib/notifications/create";
import {
  refundDueAt,
  refundMethodFor,
  sameEmail,
  withdrawalRefundOre,
  withdrawalState,
} from "./withdrawal";
import {
  sendWithdrawalReceipt,
  sendWithdrawalSellerNotice,
  sendWithdrawalSupportCase,
} from "@/lib/email/send-withdrawal";

export type WithdrawError =
  | "notFound"
  | "fixedDate"
  | "expired"
  | "notWithdrawable"
  | "nameMissing"
  | "emailMismatch"
  | "failed";

/** none = alla klipp använda efter begäran om att börja direkt: inget att betala tillbaka. */
export type RefundMethod = "stripe" | "manual" | "none";

export type WithdrawResult =
  | {
      ok: true;
      receivedAt: string;
      refundMethod: RefundMethod;
      refundOre: number;
      alreadyWithdrawn: boolean;
    }
  | { ok: false; error: WithdrawError };

const BOOKING_COLUMNS =
  "id, status, created_at, amount_paid, is_free, sessions_total, sessions_redeemed, minutes_total, minutes_redeemed, pass_early_start_requested_at, stripe_payment_id, payment_method, guest_email, guest_name, customer_id, creator_id, listing_id, booking_type, guest_count, ticket_type_id";

export function bookingCode(id: string): string {
  return `USH-${id.slice(0, 8).toUpperCase()}`;
}

function paymentLabel(method: string | null): string {
  if (method === "epassi") return "Epassi";
  if (method === "swish") return "Swish";
  return "Swish";
}

/**
 * Köparen ångrar ett köp (2 kap. 10 a § distansavtalslagen).
 *
 * Ordningen är vald så att inget kan bli dubbelt och inget tyst:
 *  1. Kontroll: köpet går att ångra just nu, och e-postadressen är köparens.
 *  2. Ångerraden skrivs. unique(booking_id) gör att ett andra klick landar här
 *     och inte i en andra återbetalning.
 *  3. Återbetalning via Stripe (hela beloppet, serviceavgiften också), annars
 *     ett ärende till supporten som betalar tillbaka för hand inom 14 dagar.
 *  4. Bokningen avslutas, så kortet slutar gälla i dörren.
 *  5. Mottagningsbevis till köparen, besked till säljaren.
 *
 * Misslyckas Stripe står ångern ändå fast: den gäller från meddelandet, inte
 * från återbetalningen. Då går ett ärende till supporten i stället.
 */
export async function withdrawPurchase(
  admin: SupabaseClient,
  input: { bookingId: string; name: string; email: string; locale?: string | null; now?: Date }
): Promise<WithdrawResult> {
  const now = input.now ?? new Date();
  const name = input.name.trim().slice(0, 120);
  const email = input.email.trim().slice(0, 254);
  if (!name) return { ok: false, error: "nameMissing" };

  const { data: booking } = await admin
    .from("bookings")
    .select(BOOKING_COLUMNS)
    .eq("id", input.bookingId)
    .maybeSingle();
  if (!booking) return { ok: false, error: "notFound" };

  // Redan ångrat: samma svar igen, inga nya pengar och inga nya mejl.
  const { data: existing } = await admin
    .from("booking_withdrawals")
    .select("received_at, refund_method, refund_amount_ore")
    .eq("booking_id", booking.id)
    .maybeSingle();
  if (existing) {
    return {
      ok: true,
      receivedAt: existing.received_at,
      refundMethod: existing.refund_method === "stripe" || existing.refund_method === "none" ? existing.refund_method : "manual",
      refundOre: existing.refund_amount_ore ?? 0,
      alreadyWithdrawn: true,
    };
  }

  const state = withdrawalState(booking, now);
  if (state.kind === "fixedDate") return { ok: false, error: "fixedDate" };
  if (state.kind === "expired") return { ok: false, error: "expired" };
  if (state.kind !== "open") return { ok: false, error: "notWithdrawable" };

  // Köparens adress: gästens, eller kontots. Den inskrivna måste stämma, så att
  // länken ensam inte räcker för att ångra någon annans köp.
  let buyerEmail: string | null = booking.guest_email;
  let buyerName: string | null = booking.guest_name;
  if (booking.customer_id) {
    const { data: prof } = await admin
      .from("profiles")
      .select("email, full_name")
      .eq("id", booking.customer_id)
      .maybeSingle();
    buyerEmail = buyerEmail || prof?.email || null;
    buyerName = buyerName || prof?.full_name || null;
  }
  if (buyerEmail && !sameEmail(buyerEmail, email)) return { ok: false, error: "emailMismatch" };
  const receiptTo = buyerEmail || email;

  const refundOre = withdrawalRefundOre(booking);
  const method: RefundMethod = refundOre === 0 ? "none" : refundMethodFor(booking);
  const due = refundDueAt(now);

  const { data: row, error: insErr } = await admin
    .from("booking_withdrawals")
    .insert({
      booking_id: booking.id,
      received_at: now.toISOString(),
      buyer_name: name,
      buyer_email: receiptTo,
      refund_method: method,
      refund_amount_ore: refundOre,
      refund_due_at: due.toISOString(),
    })
    .select("id")
    .single();
  if (insErr || !row) {
    // 23505: ett samtidigt klick hann före. Svara som för ett redan ångrat köp.
    if ((insErr as { code?: string } | null)?.code === "23505") {
      return withdrawPurchase(admin, { ...input, now });
    }
    console.error("Ångerraden kunde inte skrivas:", insErr);
    return { ok: false, error: "failed" };
  }

  let refund: { refundId: string; amount: number } | null = null;
  let refundError: string | null = null;
  const paidOre = Math.max(0, booking.amount_paid ?? 0);
  if (method === "stripe" && booking.stripe_payment_id && refundOre > 0) {
    try {
      // Hela beloppet utan amount, så att en avrundning aldrig lämnar ören kvar.
      refund = await refundBookingCharge(
        booking.stripe_payment_id,
        refundOre < paidOre ? refundOre : undefined
      );
    } catch (err) {
      refundError = err instanceof Error ? err.message : String(err);
      console.error("Återbetalningen vid ånger misslyckades:", err);
    }
  }

  await admin
    .from("bookings")
    .update(
      refund
        ? {
            status: "canceled",
            refunded_at: now.toISOString(),
            refund_amount: refund.amount,
            stripe_refund_id: refund.refundId,
          }
        : { status: "canceled" }
    )
    .eq("id", booking.id);

  await admin
    .from("booking_withdrawals")
    .update(
      refund
        ? { refunded_at: now.toISOString(), stripe_refund_id: refund.refundId, refund_amount_ore: refund.amount }
        : { refund_error: refundError }
    )
    .eq("id", row.id);

  // Partnerns andel av ett återtaget köp ska inte betalas ut.
  await voidRewardsForBooking(admin, booking.id).catch((err) =>
    console.error("Partnerandelen kunde inte nollas:", err)
  );

  // Platsen blir ledig igen, som vid en vanlig avbokning.
  if (booking.booking_type === "ticket") {
    await admin
      .rpc("increment_tickets_sold", {
        p_listing: booking.listing_id,
        p_n: -(booking.guest_count ?? 1),
        p_ticket_type: booking.ticket_type_id ?? undefined,
      })
      .then(({ error }) => error && console.error("tickets_sold kunde inte minskas:", error));
  }

  const [{ data: listing }, { data: seller }] = await Promise.all([
    admin.from("listings").select("title").eq("id", booking.listing_id).maybeSingle(),
    admin.from("profiles").select("email, full_name").eq("id", booking.creator_id).maybeSingle(),
  ]);
  const serviceName = listing?.title || "Usha";
  const code = bookingCode(booking.id);
  const effectiveMethod: RefundMethod = method === "none" ? "none" : refund ? "stripe" : "manual";
  const mail = {
    serviceName,
    bookingCode: code,
    receivedAt: now,
    refundOre: refund?.amount ?? refundOre,
    refundMethod: effectiveMethod,
    paymentMethodLabel: booking.stripe_payment_id ? "Stripe" : paymentLabel(booking.payment_method),
    refundDueAt: due,
  };

  const receiptSent = await sendWithdrawalReceipt({
    ...mail,
    to: receiptTo,
    recipientName: name,
    recipientId: booking.customer_id,
    preferredLocale: input.locale,
  });

  let sellerNotified = false;
  if (seller?.email) {
    sellerNotified = await sendWithdrawalSellerNotice({
      ...mail,
      to: seller.email,
      recipientName: seller.full_name || serviceName,
      recipientId: booking.creator_id,
      buyerName: name,
    });
  }
  await createNotification({
    userId: booking.creator_id,
    type: "booking_canceled",
    titleKey: "withdrawalTitle",
    bodyKey: "withdrawalMsg",
    params: { service: serviceName, buyer: name },
    link: "/dashboard/bookings",
  }).catch((err) => console.error("Säljarens notis om ånger misslyckades:", err));

  if (!refund && method !== "none") {
    await sendWithdrawalSupportCase({
      bookingId: booking.id,
      bookingCode: code,
      serviceName,
      buyerName: name,
      buyerEmail: receiptTo,
      refundOre,
      paymentMethodLabel: paymentLabel(booking.payment_method),
      refundDueAt: due,
      reason: method === "manual" ? "manual" : "stripeFailed",
      error: refundError,
    });
  }

  await admin
    .from("booking_withdrawals")
    .update({
      receipt_sent_at: receiptSent ? new Date().toISOString() : null,
      seller_notified_at: sellerNotified ? new Date().toISOString() : null,
    })
    .eq("id", row.id);

  return {
    ok: true,
    receivedAt: now.toISOString(),
    refundMethod: effectiveMethod,
    refundOre: mail.refundOre,
    alreadyWithdrawn: false,
  };
}
