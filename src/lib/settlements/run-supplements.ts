/**
 * Körningen som för över mellanskillnaden för en redan reglerad kväll.
 *
 * Besluten ligger i supplement.ts och är rena. Här finns bara omvärlden:
 * databasen och Stripe. Filen är medvetet byggd som en spegel av
 * run-payouts.ts — samma ordning mellan rad och överföring, samma hantering av
 * uppskjutna fel — så att den som kan den ena kan den andra.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { passRedemptionRows } from "@/lib/passes/series-pass";
import { getStripe } from "@/lib/stripe/client";
import { destinationAccountId } from "./destination";
import { aggregateEventBookings } from "./aggregate";
import { splitEventRevenue } from "./split";
import { isDeferrable, payoutBlockedReason, payoutsEnabled, stockholmToday } from "./payout";
import {
  decideSupplement,
  inomFonster,
  supplementTransferGroup,
  KOMPLETTERING_FONSTER_DAGAR,
} from "./supplement";

export interface SupplementRunResult {
  today: string;
  live: boolean;
  paid: number;
  /** Nya torrkörda rader. Bara de ger besked — se dryRunUpdated. */
  dryRun: number;
  /**
   * Torrkörda rader som bara räknats om. En redan nedskriven mellanskillnad
   * ska inte mejlas varje timme tills utbetalningarna slås på.
   */
  dryRunUpdated: number;
  /** Kvällar som är i balans räknas men listas inte — de är det normala. */
  balanced: number;
  /** Partnern har fått för mycket. Rättas aldrig automatiskt. */
  overpaid: { listingId: string; title: string; eventDate: string; excessOre: number }[];
  deferred: { listingId: string; title: string }[];
  blocked: { listingId: string; title: string; reason: string }[];
  failed: { listingId: string; title: string; error: string }[];
  totalOre: number;
  transfers: {
    title: string;
    eventDate: string;
    amountOre: number;
    transferId: string;
    partnerName: string;
    destinationAccountId: string | null;
  }[];
}

interface ShareRow {
  listing_id: string;
  partner_percent: number;
  vat_rate: number | string;
  listing: { id: string; title: string | null; event_date: string | null } | null;
  partner: {
    id: string;
    full_name?: string | null;
    company_name?: string | null;
    stripe_account_id: string | null;
    company_verified_at: string | null;
    company_form: string | null;
    org_number: string | null;
    f_tax_verified_at: string | null;
    stripe_charges_enabled: boolean | null;
    stripe_payouts_enabled: boolean | null;
  } | null;
}

export async function runSettlementSupplements(now: Date = new Date()): Promise<SupplementRunResult> {
  const db = createAdminClient();
  const today = stockholmToday(now);
  const live = payoutsEnabled();

  const result: SupplementRunResult = {
    today,
    live,
    paid: 0,
    dryRun: 0,
    dryRunUpdated: 0,
    balanced: 0,
    overpaid: [],
    deferred: [],
    blocked: [],
    failed: [],
    totalOre: 0,
    transfers: [],
  };

  const { data: shares, error } = await db
    .from("event_revenue_shares")
    .select(
      "listing_id, partner_percent, vat_rate, " +
        "listing:listings!listing_id(id, title, event_date), " +
        "partner:profiles!partner_profile_id(id, full_name, company_name, stripe_account_id, company_verified_at, company_form, org_number, f_tax_verified_at, stripe_charges_enabled, stripe_payouts_enabled)"
    );

  if (error) throw new Error(`Kunde inte läsa delningsavtal: ${error.message}`);

  for (const share of (shares ?? []) as unknown as ShareRow[]) {
    const listing = Array.isArray(share.listing) ? share.listing[0] : share.listing;
    const partner = Array.isArray(share.partner) ? share.partner[0] : share.partner;
    if (!listing?.event_date || !partner) continue;
    if (!inomFonster(listing.event_date, today)) continue;

    const title = listing.title ?? "";

    // Ursprungsavräkningen. En komplettering bygger på den och får aldrig
    // konkurrera med den vanliga körningen om samma kväll.
    const { data: primary } = await db
      .from("event_settlement_payouts")
      .select("status, amount_ore")
      .eq("listing_id", listing.id)
      .maybeSingle();

    const primaryRow = primary as { status: string; amount_ore: number } | null;

    // Tidigare kompletteringar. Bara de som FAKTISKT gått igenom räknas som
    // utbetalda — en rad i "pending" eller "failed" är inte pengar partnern
    // har, och att räkna med den skulle göra mellanskillnaden för liten.
    const { data: priorRows } = await db
      .from("event_settlement_supplements")
      .select("seq, status, amount_ore")
      .eq("listing_id", listing.id);

    const prior = (priorRows as { seq: number; status: string; amount_ore: number }[] | null) ?? [];

    // En rad som inte fått sitt slutliga besked stoppar kvällen.
    //
    // "pending" kan ha en överföring i luften. "failed" är värre än den ser ut:
    // ett avbrott efter att Stripe skapat överföringen men innan vi hunnit
    // skriva ned den ser likadant ut som ett rent fel. Varje komplettering får
    // ett eget löpnummer och därmed en egen idempotensnyckel, så ett nytt
    // försök skyddas INTE av Stripes dubblettskydd — till skillnad från
    // ursprungsavräkningen, som återanvänder samma grupp.
    //
    // Därför rättas en sådan rad av en människa som kan titta i Stripe först.
    // Hellre en komplettering som väntar än en som betalas två gånger.
    const oklar = prior.find((p) => p.status === "pending" || p.status === "failed");
    if (oklar) {
      result.blocked.push({
        listingId: listing.id,
        title,
        reason: `komplettering ${oklar.seq} står som ${oklar.status} och måste redas ut först`,
      });
      continue;
    }

    const alreadyPaidOre =
      (primaryRow?.status === "paid" ? primaryRow.amount_ore : 0) +
      prior.filter((p) => p.status === "paid").reduce((n, p) => n + p.amount_ore, 0);

    // Räkna om kvällen från dagens bokningar och klipp, med exakt samma kod som
    // ursprungsavräkningen. Två olika vägar till samma tal vore två tal.
    const { data: bookings } = await db
      .from("bookings")
      .select("status, amount_paid, platform_fee_amount, refund_amount, guest_count, credit_applied_ore")
      .eq("listing_id", listing.id)
      .eq("booking_type", "ticket")
      // Swish-betalningar ligger på banken, inte hos Stripe: de kan inte föras
      // över härifrån. Partnerns andel av dem regleras för hand, se docs.
      .or("payment_method.is.null,payment_method.neq.swish");
    const passRows = await passRedemptionRows(db, listing.id);

    const totals = aggregateEventBookings([...(bookings ?? []), ...passRows], 0);
    const split = splitEventRevenue({
      grossOre: totals.grossOre,
      refundedOre: totals.refundedOre,
      vatRate: Number(share.vat_rate),
      partnerPercent: share.partner_percent,
    });

    const outcome = decideSupplement({
      split,
      alreadyPaidOre,
      primaryStatus: primaryRow?.status ?? null,
    });

    if (outcome.kind === "skip") continue;
    if (outcome.kind === "balanced") {
      result.balanced += 1;
      continue;
    }
    if (outcome.kind === "overpaid") {
      result.overpaid.push({
        listingId: listing.id,
        title,
        eventDate: listing.event_date,
        excessOre: outcome.excessOre,
      });
      continue;
    }

    // Partnern måste fortfarande kunna ta emot pengar. Samma kontroll som den
    // vanliga körningen gör — ett konto kan ha tappat sin behörighet sedan
    // ursprungsavräkningen gick.
    const blockedReason = payoutBlockedReason(partner);
    if (blockedReason) {
      result.blocked.push({ listingId: listing.id, title, reason: blockedReason });
      continue;
    }

    // En torrkörd rad är mellanskillnaden redan nedskriven, inte utbetald.
    //
    // Utan den här kontrollen hade jobbet skrivit en NY rad varje timme så
    // länge utbetalningarna är avstängda — samma mellanskillnad om och om
    // igen, med ett mejl varje gång. Beloppen räknas om ändå, så raden
    // uppdateras i stället: den ska spegla kvällen som den ser ut nu.
    const torr = prior.find((p) => p.status === "dry_run");

    let seq: number;

    if (torr) {
      seq = torr.seq;
      const { error: updErr } = await db
        .from("event_settlement_supplements")
        .update({
          status: live ? "pending" : "dry_run",
          destination_account_id: partner.stripe_account_id ?? null,
          amount_ore: outcome.deltaOre,
          due_ore: outcome.dueOre,
          previously_paid_ore: outcome.alreadyPaidOre,
          gross_ore: split.grossOre,
          refunded_ore: split.refundedOre,
          vat_ore: split.vatOre,
          basis_ore: split.basisOre,
          partner_percent: split.partnerPercent,
          vat_rate: split.vatRate,
        })
        .eq("listing_id", listing.id)
        .eq("seq", seq)
        .eq("status", "dry_run"); // samma lås som insert ger en ny rad

      if (updErr) {
        result.failed.push({ listingId: listing.id, title, error: updErr.message });
        continue;
      }

      // Fortfarande avstängt: raden är uppdaterad och det är allt som ska ske.
      // Räknas som torrkörd, men utan nytt besked — se rapporteringen nedan.
      if (!live) {
        result.dryRunUpdated += 1;
        result.totalOre += outcome.deltaOre;
        continue;
      }
    } else {
      seq = prior.reduce((max, p) => Math.max(max, p.seq), 0) + 1;

      // Raden skapas FÖRE överföringen. UNIQUE(listing_id, seq) är låset: kör
      // jobbet två gånger samtidigt vinner den ena, den andra får ett
      // unikhetsfel i stället för att skicka en andra överföring.
      const { error: insErr } = await db.from("event_settlement_supplements").insert({
        listing_id: listing.id,
        partner_profile_id: partner.id,
        seq,
        status: live ? "pending" : "dry_run",
        amount_ore: outcome.deltaOre,
        due_ore: outcome.dueOre,
        previously_paid_ore: outcome.alreadyPaidOre,
        destination_account_id: partner.stripe_account_id ?? null,
        gross_ore: split.grossOre,
        refunded_ore: split.refundedOre,
        vat_ore: split.vatOre,
        basis_ore: split.basisOre,
        partner_percent: split.partnerPercent,
        vat_rate: split.vatRate,
      });

      if (insErr) {
        // 23505 = någon annan hann före. Rätt utfall, inte ett fel.
        if (insErr.code !== "23505") {
          result.failed.push({ listingId: listing.id, title, error: insErr.message });
        }
        continue;
      }

      if (!live) {
        result.dryRun += 1;
        result.totalOre += outcome.deltaOre;
        continue;
      }
    }

    try {
      const stripe = getStripe();
      const group = supplementTransferGroup(listing.id, seq);

      // Fanns överföringen redan? Kan inträffa om en tidigare körning skapade
      // den men dog innan databasen uppdaterades.
      const befintlig = await stripe.transfers.list({ transfer_group: group, limit: 1 });
      const transfer =
        befintlig.data[0] ??
        (await stripe.transfers.create(
          {
            amount: outcome.deltaOre,
            currency: "sek",
            destination: partner.stripe_account_id!,
            transfer_group: group,
            description: `Kompletterande avräkning ${title} ${listing.event_date}`,
            metadata: {
              listing_id: listing.id,
              event_date: listing.event_date,
              supplement_seq: String(seq),
              due_ore: String(outcome.dueOre),
              previously_paid_ore: String(outcome.alreadyPaidOre),
            },
          },
          { idempotencyKey: group }
        ));

      await db
        .from("event_settlement_supplements")
        .update({
          status: "paid",
          stripe_transfer_id: transfer.id,
          destination_account_id:
            destinationAccountId(transfer.destination) ?? partner.stripe_account_id ?? null,
          paid_at: new Date().toISOString(),
          error: null,
        })
        .eq("listing_id", listing.id)
        .eq("seq", seq);

      result.paid += 1;
      result.totalOre += outcome.deltaOre;
      result.transfers.push({
        title,
        eventDate: listing.event_date,
        amountOre: outcome.deltaOre,
        transferId: transfer.id,
        partnerName: partner.company_name || partner.full_name || "partner",
        destinationAccountId:
          destinationAccountId(transfer.destination) ?? partner.stripe_account_id ?? null,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);

      if (isDeferrable(e)) {
        // Saldot räcker inte ännu. Raden ligger kvar som "pending" och tas om i
        // morgon — men då blockeras kvällen av pending-kontrollen ovan tills
        // den här överföringen fått ett besked, vilket är avsikten.
        await db
          .from("event_settlement_supplements")
          .update({ error: message })
          .eq("listing_id", listing.id)
          .eq("seq", seq);

        result.deferred.push({ listingId: listing.id, title });
        continue;
      }

      await db
        .from("event_settlement_supplements")
        .update({ status: "failed", error: message })
        .eq("listing_id", listing.id)
        .eq("seq", seq);

      result.failed.push({ listingId: listing.id, title, error: message });
    }
  }

  return result;
}

export { KOMPLETTERING_FONSTER_DAGAR };
