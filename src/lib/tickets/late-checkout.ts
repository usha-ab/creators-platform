/**
 * Kassan för ett efterköp: betalning för en kväll som redan varit.
 *
 * Skild från den publika gästkassan med flit. Den publika vägen SKA neka ett
 * passerat event — det är den spärren som hindrar att någon köper sig in på
 * något som inte finns kvar, och den rörs inte här. I stället skapas sessionen
 * på serversidan, av någon som faktiskt stod i dörren, och QR-koden pekar rakt
 * in i Stripe. Gästen möter alltså aldrig den publika grinden.
 *
 * Konsekvensen är värd att säga rakt ut: efterköpet kan inte nås av en gäst på
 * egen hand. Det är avsikten. Länken finns bara så länge värden visar den.
 */

import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import { getCreatorCommissionRate, platformCommissionOre } from "@/lib/stripe/commission";
import { computeServiceFeeOre, serviceFeeMode } from "@/lib/tickets/service-fee";
import { canReceivePayments, PAYMENTS_BETA_BLOCKED_MESSAGE } from "@/lib/payments/beta-gate";
import { loadPayeeEligibility } from "@/lib/payments/load-payee";
import {
  resolvePayeeFlow,
  buildConnectPaymentIntentData,
  buildPaymentMetadata,
  buildTermsCustomText,
  type PayeeContext,
} from "@/lib/stripe/checkout";
import { efterkopLage } from "./late-purchase";
import { getSaleState } from "@/lib/listings/sale-state";
import { paymentMethodConfigParam } from "@/lib/stripe/method-config";
import { checkoutTax, parseVatRate, withTaxRates } from "@/lib/stripe/vat";

export interface LateCheckoutListing {
  id: string;
  title: string;
  price: number | null;
  user_id: string;
  event_date: string | null;
  event_time: string | null;
  /** Sluttid; avgör kvällens slut tillsammans med 04-golvet (evening.ts). */
  event_end_time?: string | null;
  series_slug: string | null;
  service_fee_mode: string | null;
  /** Momssats för kvällen (listings.vat_rate). Saknas/null = standard. */
  vat_rate?: number | string | null;
}

export interface LateCheckoutTicketType {
  id: string;
  name: string;
  price: number;
}

export interface LateCheckoutCreator {
  stripe_account_id: string | null;
  stripe_card_payments_enabled: boolean | null;
  is_usha_owned_seller: boolean | null;
  company_name: string | null;
  org_number: string | null;
  full_name: string | null;
  company_verified_at: string | null;
  tier: string | null;
  creator_subcategory?: string | null;
  terms_url?: string | null;
}

/**
 * Hur länge betalningen får leva, i minuter.
 *
 * Stripe accepterar bara `expires_at` mellan 30 minuter och 24 timmar efter
 * att sessionen skapats. Första versionen av efterköpet bad om 15 minuter —
 * vettigt för en kod på en skärm, men Stripe avvisar det, och felet syntes
 * inte förrän någon faktiskt skulle betala. Därför klamras värdet här, och
 * därför är det en egen funktion med egna test i stället för ett uttryck
 * inuti ett anrop ingen kan köra utan Stripe.
 */
export function sessionLivslangdMinuter(onskad: number | undefined): number {
  const STRIPE_MIN = 30;
  const STRIPE_MAX = 24 * 60;
  if (!Number.isFinite(onskad ?? NaN)) return STRIPE_MIN;
  return Math.min(Math.max(Math.round(onskad as number), STRIPE_MIN), STRIPE_MAX);
}

export type LateCheckoutResult =
  | { ok: true; url: string; amountOre: number; expiresAt: string }
  | { ok: false; status: number; error: string };

/**
 * Skapar betalningen för ett efterköp.
 *
 * Fönstret kontrolleras HÄR och inte bara i gränssnittet. Anroparen har redan
 * vägt av vem som får be om det här; den här funktionen vaktar vad som är
 * rimligt att be om.
 */
export async function createLateCheckoutSession(args: {
  listing: LateCheckoutListing;
  creator: LateCheckoutCreator;
  ticketType: LateCheckoutTicketType | null;
  appUrl: string;
  /**
   * Vilken grind som gäller.
   *
   * "efterkop" — kvällen har varit och ligger innanför efterköpsfönstret.
   * "dorr"     — kvällen säljs just nu; samma kontroll som den publika kassan
   *              gör, så dörrgenvägen aldrig kan sälja något som är stängt.
   *
   * Två lägen i en funktion och inte två funktioner: pengarna räknas likadant
   * i båda fallen, och två kopior av den räkningen blir förr eller senare två
   * olika svar.
   */
  mode?: "efterkop" | "dorr";
  locale?: Stripe.Checkout.SessionCreateParams.Locale;
  /**
   * Hur länge betalningen går att slutföra.
   *
   * Kort för en kod på en skärm i en lokal: en session som lever kvar sedan
   * värden gått därifrån är en betalningslänk på vift. Längre när länken
   * skickas till någon som inte står bredvid — då ska hen hinna öppna
   * meddelandet och betala i lugn och ro.
   */
  expiresInMinutes?: number;
  now?: Date;
}): Promise<LateCheckoutResult> {
  const { listing, creator, ticketType, appUrl } = args;
  const now = args.now ?? new Date();

  const minuter = sessionLivslangdMinuter(args.expiresInMinutes);

  const mode = args.mode ?? "efterkop";

  if (mode === "efterkop") {
    const lage = efterkopLage(listing.event_date, now, listing);
    if (lage.kind !== "oppet") {
      return {
        ok: false,
        status: 403,
        error:
          lage.kind === "stangt"
            ? "Efterköpsfönstret har stängt för den här kvällen."
            : "Kvällen har inte varit ännu — använd den vanliga försäljningen.",
      };
    }
  } else {
    // Samma grind som den publika kassan. Dörrgenvägen får aldrig vara en
    // bakväg förbi "inte släppt än", "slutsålt" eller "har varit".
    const sale = getSaleState(
      { price: listing.price, event_date: listing.event_date, event_time: listing.event_time, event_end_time: listing.event_end_time },
      now
    );
    if (!sale.buyable) {
      return { ok: false, status: 403, error: "Biljetten går inte att köpa just nu." };
    }
  }

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
      return { ok: false, status: 400, error: "Kreatören har inget anslutet Stripe-konto." };
    }
    if (!canReceivePayments(await loadPayeeEligibility(listing.user_id))) {
      return { ok: false, status: 403, error: PAYMENTS_BETA_BLOCKED_MESSAGE };
    }
  }

  const price = ticketType ? ticketType.price : (listing.price ?? 0);
  const amountInOre = Math.round(price * 100);
  if (amountInOre <= 0) {
    return { ok: false, status: 400, error: "Biljetten saknar pris." };
  }

  const commissionRate = getCreatorCommissionRate(
    creator.tier ?? "gratis",
    creator.creator_subcategory ?? null
  );
  // Ushas egna arrangemang (usha_principal) bär ingen provision: pengarna är
  // redan Ushas, och en avgift mot sig själv hade bara skräpat ner avräkningen.
  const applicationFee = flow === "usha_principal" ? 0 : platformCommissionOre(amountInOre, 1);
  const feeMode = serviceFeeMode(listing.service_fee_mode);
  const serviceFee = computeServiceFeeOre(amountInOre, 1, feeMode);

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      price_data: {
        currency: "sek",
        product_data: {
          name: ticketType ? `${listing.title} – ${ticketType.name}` : listing.title,
          // Kvällens datum i produktnamnet, inte bara i vår metadata. Gästen
          // ska kunna se på Stripe-sidan och på kortutdraget VILKEN kväll hen
          // betalar för — annars ser ett efterköp ut som en dubbeldebitering.
          description: listing.event_date
            ? mode === "efterkop"
              ? `Efterköp för kvällen ${listing.event_date}`
              : `Kvällen ${listing.event_date}`
            : undefined,
        },
        unit_amount: amountInOre,
      },
      quantity: 1,
    },
  ];
  if (serviceFee > 0 && feeMode === "buyer") {
    lineItems.push({
      price_data: { currency: "sek", product_data: { name: "Serviceavgift" }, unit_amount: serviceFee },
      quantity: 1,
    });
  }

  const customText = buildTermsCustomText(creator.terms_url ?? null);
  const paymentIntentData = buildConnectPaymentIntentData({
    flow,
    payee,
    applicationFeeOre: applicationFee + serviceFee,
    metadata: buildPaymentMetadata({
      flow,
      payee,
      eventId: listing.id,
      eventDate: listing.event_date,
      seriesSlug: listing.series_slug,
      termsUrl: creator.terms_url ?? null,
    }),
  });

  const totalOre = amountInOre + (feeMode === "buyer" ? serviceFee : 0);

  // Momsen: kvällens egen sats (t.ex. 6 % på danskvällar) eller Stripe Tax.
  const tax = await checkoutTax(stripe, parseVatRate(listing.vat_rate));
  const session = await stripe.checkout.sessions.create({
    ...(args.locale ? { locale: args.locale } : {}),
    // Klarna bara över gränsen — se lib/stripe/method-config.
    ...paymentMethodConfigParam(totalOre),
    // Ingen customer_email: värden känner inte nödvändigtvis gästens adress,
    // och att skriva in den åt någon annan är ett sätt att stava fel. Stripe
    // frågar gästen själv, och webhooken plockar adressen ur customer_details.
    line_items: withTaxRates(lineItems, tax),
    mode: "payment",
    expires_at: Math.floor(now.getTime() / 1000) + minuter * 60,
    ...(paymentIntentData ? { payment_intent_data: paymentIntentData } : {}),
    ...(customText ? { custom_text: customText } : {}),
    ...(tax.automatic_tax ? { automatic_tax: tax.automatic_tax } : {}),
    success_url: `${appUrl}/biljett/klar?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/flode`,
    metadata: {
      // Samma typ som ett vanligt gästköp: webhooken ska skapa bokningen på
      // precis samma sätt, på DEN HÄR kvällen. Då räknas den med i kvällens
      // statistik, och den kompletterande avräkningen ser till att partnerns
      // andel går iväg trots att kvällen redan reglerats.
      type: "guest_ticket",
      flow,
      listingId: listing.id,
      creatorId: listing.user_id,
      guestName: "",
      ...(mode === "efterkop" ? { latePurchase: "true" } : { doorPurchase: "true" }),
      serviceFeeOre: String(serviceFee),
      serviceFeeMode: feeMode,
      platformFeeOre: String(applicationFee + serviceFee),
      ticketTypeId: ticketType?.id ?? "",
      ticketTypeName: ticketType?.name ?? "",
      quantity: "1",
      // Inget `reserved`: platsen har inte reserverats i förväg, så webhooken
      // ska räkna upp biljetträknaren som vanligt. Kvällen är passerad och
      // kapaciteten spelar ingen roll längre — men siffran ska stämma.
      eventDate: listing.event_date || "",
      eventTime: listing.event_time || "",
    },
  });

  if (!session.url) {
    return { ok: false, status: 502, error: "Stripe gav ingen betalningslänk." };
  }
  return {
    ok: true,
    url: session.url,
    amountOre: totalOre,
    expiresAt: new Date(now.getTime() + minuter * 60_000).toISOString(),
  };
}
