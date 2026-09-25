import type Stripe from "stripe";
import { isOwnerPayee } from "@/lib/payments/beta-gate";
import { formatOrgNumber } from "@/lib/org-number";

/**
 * Central checkout routing for Connect payments — the single place that decides
 * which of the two accounting flows a payment belongs to:
 *
 *  - "third_party" (agent/net): the organizer is the real seller. When their
 *    Connect account has card_payments active we set `on_behalf_of` so the
 *    organizer becomes merchant of record (their statement descriptor, their
 *    tax registration, their dispute liability). Usha books only its commission.
 *  - "usha_principal" (gross): Usha itself is the seller. No transfer, no
 *    application fee, no on_behalf_of — the full amount stays on Usha's account
 *    and Usha is merchant of record.
 *
 * This only builds `payment_intent_data`; line items, reservation, metadata and
 * redirect URLs stay in each route (they are genuinely route-specific).
 */

export type PayeeFlow = "third_party" | "usha_principal";

export interface PayeeContext {
  id: string; // profiles.id of the payee (organizer/creator/instructor)
  stripe_account_id: string | null;
  card_payments_enabled: boolean; // profiles.stripe_card_payments_enabled
  is_usha_owned_seller: boolean; // profiles.is_usha_owned_seller
  company_name: string | null;
  org_number: string | null;
  full_name: string | null;
}

/** Decide the accounting flow for a payee. Owner / Usha-owned → principal. */
export function resolvePayeeFlow(payee: PayeeContext): PayeeFlow {
  if (payee.is_usha_owned_seller || isOwnerPayee(payee.id)) return "usha_principal";
  return "third_party";
}

/**
 * Sanitise a name into a Stripe statement_descriptor_suffix: latin letters,
 * digits and spaces only; forbidden chars `< > \ ' " *` stripped; trimmed to a
 * safe length. Returns undefined if nothing usable remains.
 */
export function buildStatementDescriptorSuffix(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N} ]/gu, "") // drop punctuation/symbols incl. the forbidden set
    .replace(/[^\x20-\x7E]/g, "") // keep ASCII (descriptors are latin)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 22);
  return cleaned.length >= 2 ? cleaned : undefined;
}

/** The seller identity to print on a receipt for a given flow + payee. */
export function receiptSeller(
  flow: PayeeFlow,
  payee: Pick<PayeeContext, "company_name" | "org_number" | "full_name">
): { name: string; orgNumber?: string } {
  if (flow === "usha_principal") {
    return {
      name: process.env.USHA_LEGAL_NAME || "Usha AB",
      orgNumber: process.env.USHA_ORG_NUMBER || undefined,
    };
  }
  // Third-party: company + org.nr when both exist (venues), else legal name only.
  if (payee.company_name && payee.org_number) {
    return { name: payee.company_name, orgNumber: formatOrgNumber(payee.org_number) };
  }
  return { name: payee.full_name || payee.company_name || "Arrangör" };
}

/**
 * Bookkeeping metadata stamped on EVERY PaymentIntent (not just the Checkout
 * Session — session metadata does not propagate to the charge that Fortnox /
 * reconciliation reads). Four fields:
 *  - model: "principal" (Usha's own event, gross) | "agent" (brokered, net)
 *  - event_date: drives period accrual (periodisering)
 *  - organizer_org_nr: DAC7 + reconciliation against the organizer
 *  - event_id: traceability from the verifikat back to the event
 */
export function buildPaymentMetadata(args: {
  flow: PayeeFlow;
  payee: Pick<PayeeContext, "company_name" | "org_number" | "full_name">;
  eventId?: string | null;
  eventDate?: string | null;
  termsUrl?: string | null;
  /** Serien kvällen tillhör, t.ex. "brazilian-zouk-tisdag". */
  seriesSlug?: string | null;
}): Record<string, string> {
  const seller = receiptSeller(args.flow, args.payee);
  return {
    model: args.flow === "usha_principal" ? "principal" : "agent",
    event_date: args.eventDate ?? "",
    organizer_org_nr: seller.orgNumber ?? "",
    event_id: args.eventId ?? "",
    // Vilken serie pengarna hör till. Utan den går två klubbkvällar som båda
    // säljs på plattformskontot inte att skilja åt i Stripe annat än genom att
    // slå upp varje event_id — och de har olika ägare bakom kulisserna även
    // när Usha är säljare mot köparen.
    series_slug: args.seriesSlug ?? "",
    // Consent record: which purchase terms the buyer accepted at checkout.
    terms_url: args.termsUrl ?? "",
  };
}

/**
 * Checkout `custom_text` surfacing the organizer's purchase terms (and Usha's)
 * near the pay button. Completing the purchase accepts them; the accepted URL is
 * also stamped on the charge (buildPaymentMetadata.terms_url) as the audit record.
 * Returns undefined when the organizer has no terms set.
 */
export function buildTermsCustomText(
  termsUrl: string | null | undefined
): Stripe.Checkout.SessionCreateParams.CustomText | undefined {
  if (!termsUrl) return undefined;
  const ushaTerms = `${process.env.NEXT_PUBLIC_APP_URL || "https://usha.se"}/terms`;
  return {
    after_submit: {
      message: `Genom att slutföra köpet godkänner du arrangörens [köpvillkor](${termsUrl}) och Ushas [villkor](${ushaTerms}).`,
    },
  };
}

/**
 * Build the `payment_intent_data` for a Connect checkout. Always returns an
 * object carrying the bookkeeping `metadata` (so every payment is stamped). The
 * transfer / application fee / on_behalf_of are added ONLY for the third-party
 * flow — the principal flow keeps the charge on Usha's platform account.
 */
export function buildConnectPaymentIntentData(args: {
  flow: PayeeFlow;
  payee: PayeeContext;
  applicationFeeOre: number; // 0 allowed (e.g. gage payments carry no fee)
  metadata?: Record<string, string>;
}): Stripe.Checkout.SessionCreateParams.PaymentIntentData {
  const { flow, payee, applicationFeeOre, metadata } = args;
  const pid: Stripe.Checkout.SessionCreateParams.PaymentIntentData = {};
  if (metadata) pid.metadata = metadata;

  // Principal (Usha's own event): no transfer, no fee, no on_behalf_of — the
  // gross stays on the platform account. Metadata still stamped above.
  if (flow === "usha_principal" || !payee.stripe_account_id) return pid;

  pid.transfer_data = { destination: payee.stripe_account_id };
  if (applicationFeeOre > 0) pid.application_fee_amount = applicationFeeOre;

  // Merchant-of-record shift — only when the organizer can actually take card
  // payments. Otherwise fall back to the legacy destination charge (no MoR shift).
  if (payee.card_payments_enabled) {
    pid.on_behalf_of = payee.stripe_account_id;
    const suffix = buildStatementDescriptorSuffix(payee.company_name || payee.full_name);
    if (suffix) pid.statement_descriptor_suffix = suffix;
  }
  return pid;
}
