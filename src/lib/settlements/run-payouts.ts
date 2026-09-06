/**
 * Körningen som faktiskt för över partnerns andel.
 *
 * Besluten ligger i payout.ts och är rena. Här finns bara det som rör
 * omvärlden: databasen och Stripe. Ordningen mellan dem är hela poängen med
 * filen, så den är värd att läsa noga.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import {
  decidePayout,
  isDeferrable,
  isPayoutDue,
  payoutsEnabled,
  stockholmToday,
  type PayoutCandidate,
} from "./payout";

export interface PayoutRunResult {
  today: string;
  live: boolean;
  paid: number;
  dryRun: number;
  blocked: { listingId: string; title: string; reason: string }[];
  /** Kvällar som väntar på att pengarna ska bli tillgängliga i Stripe. */
  deferred: { listingId: string; title: string }[];
  failed: { listingId: string; title: string; error: string }[];
  totalOre: number;
}

/**
 * Formen på raden vi läser. Deklarerad för hand eftersom admin-klienten är
 * otypad — då försöker supabase-js härleda formen ur select-strängen, och den
 * härledningen klarar inte den namngivna embedden.
 */
interface ShareRow {
  listing_id: string;
  partner_percent: number;
  vat_rate: number | string;
  payout_delay_days: number;
  listing: { id: string; title: string | null; event_date: string | null } | null;
  partner: {
    id: string;
    stripe_account_id: string | null;
    company_verified_at: string | null;
    stripe_charges_enabled: boolean | null;
  } | null;
}

/** Stripe-gruppen för en kvälls överföring. Används för att hitta igen den. */
function transferGroup(listingId: string): string {
  return `settlement_${listingId}`;
}

export async function runSettlementPayouts(now: Date = new Date()): Promise<PayoutRunResult> {
  const db = createAdminClient();
  const today = stockholmToday(now);
  const live = payoutsEnabled();

  const result: PayoutRunResult = {
    today,
    live,
    paid: 0,
    dryRun: 0,
    blocked: [],
    deferred: [],
    failed: [],
    totalOre: 0,
  };

  // Kvällar med avtalad delning som redan varit. Datumfiltret är grovt här och
  // exakt i isPayoutDue — att hämta någon extra rad är billigt, att missa en
  // kväll är det inte.
  const { data: shares, error } = await db
    .from("event_revenue_shares")
    .select(
      "listing_id, partner_percent, vat_rate, payout_delay_days, " +
        "listing:listings!listing_id(id, title, event_date), " +
        "partner:profiles!partner_profile_id(id, stripe_account_id, company_verified_at, stripe_charges_enabled)"
    );

  if (error) throw new Error(`Kunde inte läsa delningsavtal: ${error.message}`);

  for (const share of (shares ?? []) as unknown as ShareRow[]) {
    const listing = Array.isArray(share.listing) ? share.listing[0] : share.listing;
    const partner = Array.isArray(share.partner) ? share.partner[0] : share.partner;
    if (!listing?.event_date) continue;
    if (!partner) continue;
    if (!isPayoutDue(listing.event_date, share.payout_delay_days, today)) continue;

    // Redan betald? Då är kvällen klar. En rad som fastnat i "pending" eller
    // "failed" tas om — se nedan varför det är säkert.
    const { data: existing } = await db
      .from("event_settlement_payouts")
      .select("id, status")
      .eq("listing_id", listing.id)
      .maybeSingle();

    if (existing && (existing.status === "paid" || existing.status === "dry_run")) continue;

    const { data: bookings } = await db
      .from("bookings")
      .select("status, amount_paid, platform_fee_amount, refund_amount, guest_count, credit_applied_ore")
      .eq("listing_id", listing.id)
      .eq("booking_type", "ticket");

    const candidate: PayoutCandidate = {
      listingId: listing.id,
      listingTitle: listing.title ?? "",
      eventDate: listing.event_date,
      partner,
      partnerPercent: share.partner_percent,
      vatRate: Number(share.vat_rate),
      payoutDelayDays: share.payout_delay_days,
      bookings: bookings ?? [],
    };

    const decision = decidePayout(candidate);

    if (decision.blocked) {
      // Ingen rad skrivs. Kvällen prövas igen i morgon — partnern kan hinna bli
      // verifierad, och en blockerad kväll ska inte tystna för att den en gång
      // inte gick att betala ut.
      result.blocked.push({
        listingId: listing.id,
        title: candidate.listingTitle,
        reason: decision.blocked,
      });
      continue;
    }

    const s = decision.split;

    // Raden skapas FÖRE överföringen. UNIQUE(listing_id) gör den till ett lås:
    // kör jobbet två gånger samtidigt vinner den ena, och den andra får ett
    // unikhetsfel i stället för att skicka en andra överföring.
    if (!existing) {
      const { error: insErr } = await db.from("event_settlement_payouts").insert({
        listing_id: listing.id,
        partner_profile_id: partner.id,
        status: live ? "pending" : "dry_run",
        amount_ore: s.partnerOre,
        gross_ore: s.grossOre,
        refunded_ore: s.refundedOre,
        vat_ore: s.vatOre,
        basis_ore: s.basisOre,
        partner_percent: s.partnerPercent,
        vat_rate: s.vatRate,
      });

      if (insErr) {
        // 23505 = någon annan hann före. Det är rätt utfall, inte ett fel.
        if (insErr.code !== "23505") {
          result.failed.push({ listingId: listing.id, title: candidate.listingTitle, error: insErr.message });
        }
        continue;
      }
    }

    if (!live) {
      result.dryRun += 1;
      result.totalOre += s.partnerOre;
      continue;
    }

    try {
      const stripe = getStripe();
      const group = transferGroup(listing.id);

      // Fanns överföringen redan? Kan inträffa om förra körningen skapade den
      // men dog innan databasen uppdaterades. Stripes idempotensnycklar lever
      // bara ett dygn, så vi frågar på transfer_group i stället — den lever
      // lika länge som kontot.
      const prior = await stripe.transfers.list({ transfer_group: group, limit: 1 });
      const transfer =
        prior.data[0] ??
        (await stripe.transfers.create(
          {
            amount: s.partnerOre,
            currency: "sek",
            destination: partner.stripe_account_id!,
            transfer_group: group,
            description: `Intäktsdelning ${candidate.listingTitle} ${listing.event_date}`,
            metadata: {
              listing_id: listing.id,
              event_date: listing.event_date,
              partner_percent: String(s.partnerPercent),
              basis_ore: String(s.basisOre),
            },
          },
          { idempotencyKey: group }
        ));

      await db
        .from("event_settlement_payouts")
        .update({ status: "paid", stripe_transfer_id: transfer.id, paid_at: new Date().toISOString(), error: null })
        .eq("listing_id", listing.id);

      result.paid += 1;
      result.totalOre += s.partnerOre;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);

      if (isDeferrable(e)) {
        // Pengarna har inte blivit tillgängliga ännu. Raden får ligga kvar som
        // "pending" och tas om i morgon — inget larm för något som löser sig.
        await db
          .from("event_settlement_payouts")
          .update({ error: message })
          .eq("listing_id", listing.id);

        result.deferred.push({ listingId: listing.id, title: candidate.listingTitle });
        continue;
      }

      // Riktigt fel. Raden lämnas som "failed" med orsaken. Nästa körning tar om
      // den, och transfer_group-kontrollen ovan hindrar att en överföring som
      // faktiskt gick igenom görs en andra gång.
      await db
        .from("event_settlement_payouts")
        .update({ status: "failed", error: message })
        .eq("listing_id", listing.id);

      result.failed.push({ listingId: listing.id, title: candidate.listingTitle, error: message });
    }
  }

  return result;
}
