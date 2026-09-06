import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import ShareForm from "./share-form";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Receipt } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getCreatorCommissionRate } from "@/lib/stripe/commission";
import { aggregateEventBookings } from "@/lib/settlements/aggregate";
import { splitEventRevenue } from "@/lib/settlements/split";

// Organizer settlement / payout report for one event. Read-only: it reconciles
// gross ticket sales against Usha's fee and refunds to show the net the
// organizer receives (before Stripe's own processing fee, which Stripe deducts
// directly). All figures are derived from our own bookings.
export default async function SettlementPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: listing } = await supabase
    .from("listings")
    .select("id, title, user_id, venue_profile_id")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();
  if (!listing) notFound();

  const { data: owner } = await supabase
    .from("profiles")
    .select("tier, creator_subcategory")
    .eq("id", user.id)
    .maybeSingle();
  const commissionRate = getCreatorCommissionRate(owner?.tier ?? "gratis", owner?.creator_subcategory);

  const { data: bookings } = await supabase
    .from("bookings")
    .select("status, amount_paid, platform_fee_amount, refund_amount, guest_count, credit_applied_ore")
    .eq("listing_id", listing.id)
    .eq("booking_type", "ticket");

  const { ticketsSold, grossOre, platformFeeOre, refundedOre, refundedCount } =
    aggregateEventBookings(bookings ?? [], commissionRate);

  // Avtalad delning med en samarbetspartner, om evenemanget har en. De allra
  // flesta har ingen, och då ser sidan ut precis som förut.
  // Läses via service-role, INTE användarens klient.
  //
  // stripe_charges_enabled och stripe_account_id är kolumn-låsta för
  // authenticated, och PostgREST fäller HELA frågan när en enda kolumn saknar
  // grant — inte bara den kolumnen. Med användarklienten blev `share` därför
  // alltid null, och delningssektionen renderades aldrig för någon. Det syntes
  // först när ett test skapade ett riktigt delningsavtal.
  //
  // Behörigheten är redan avgjord: listing hämtades ovan med
  // .eq("user_id", user.id), så bara ägaren kommer hit.
  const { data: share } = await createAdminClient()
    .from("event_revenue_shares")
    .select("partner_percent, vat_rate, payout_delay_days, partner:profiles!partner_profile_id(full_name, company_name, company_verified_at, stripe_charges_enabled)")
    .eq("listing_id", listing.id)
    .maybeSingle();

  const netOre = grossOre - platformFeeOre - refundedOre;
  const kr = (ore: number) => (ore / 100).toLocaleString("sv-SE", { maximumFractionDigits: 0 });

  const t = await getTranslations("settlement");
  const rows: { label: string; value: string; sub?: string; strong?: boolean; negative?: boolean }[] = [
    { label: t("grossLabel"), value: `${kr(grossOre)} kr`, sub: t("grossSub", { count: ticketsSold }) },
    { label: t("feeLabel"), value: `−${kr(platformFeeOre)} kr`, sub: t("feeSub"), negative: true },
    { label: t("refundedLabel"), value: `−${kr(refundedOre)} kr`, sub: refundedCount ? t("refundedSub", { count: refundedCount }) : t("refundedNone"), negative: true },
    { label: t("netLabel"), value: `${kr(netOre)} kr`, sub: t("netSub"), strong: true },
  ];

  // Delningen räknas på biljettintäkten FÖRE Usha-avgiften. Avgiften är
  // plattformens egen intäkt, inte en kostnad partnern är med och bär — hade
  // den dragits av först hade partnern betalat halva Ushas provision till Usha.
  const partner = Array.isArray(share?.partner) ? share.partner[0] : share?.partner;
  const split = share
    ? splitEventRevenue({
        grossOre,
        refundedOre,
        vatRate: Number(share.vat_rate),
        partnerPercent: share.partner_percent,
      })
    : null;
  // Har utbetalningen gjorts? Underlaget är halva svaret; den andra halvan är
  // om pengarna faktiskt lämnade kontot.
  const { data: payout } = share
    ? await supabase
        .from("event_settlement_payouts")
        .select("status, amount_ore, paid_at, error")
        .eq("listing_id", listing.id)
        .maybeSingle()
    : { data: null };

  // Lokalens namn behövs även när inget avtal finns ännu, för att kunna säga
  // VEM andelen skulle gå till i formuläret.
  const { data: kopplad } = listing.venue_profile_id
    ? await createAdminClient()
        .from("profiles")
        .select("full_name, company_name")
        .eq("id", listing.venue_profile_id)
        .maybeSingle()
    : { data: null };
  const kopplatLokalnamn = (kopplad?.company_name || kopplad?.full_name || "").trim() || null;

  // Sålda biljetter låser villkoren.
  const harForsaljning = grossOre > 0;

  const partnerName = partner?.company_name || partner?.full_name || "Partner";
  // Utbetalning kräver både verifierat bolag och ett Stripe-konto som kan ta
  // emot. Saknas något går underlaget att visa, men inte att föra över.
  const partnerCanReceive = !!partner?.company_verified_at && !!partner?.stripe_charges_enabled;

  const shareRows = split
    ? [
        { label: t("shareNetLabel"), value: `${kr(split.netInclVatOre)} kr`, sub: t("shareNetSub") },
        {
          label: t("shareVatLabel"),
          value: `−${kr(split.vatOre)} kr`,
          sub: t("shareVatSub", { rate: Math.round(split.vatRate * 100) }),
          negative: true,
        },
        { label: t("shareBasisLabel"), value: `${kr(split.basisOre)} kr`, sub: t("shareBasisSub") },
        {
          label: t("sharePartnerLabel", { partner: partnerName }),
          value: `${kr(split.partnerOre)} kr`,
          sub: t("sharePartnerSub", { partner: partnerName, percent: split.partnerPercent }),
        },
        {
          label: t("shareOrganiserLabel"),
          value: `${kr(split.organiserOre)} kr`,
          sub: t("shareOrganiserSub", { percent: 100 - split.partnerPercent }),
          strong: true,
        },
      ]
    : [];

  return (
    <main className="min-h-screen bg-[var(--usha-black)] text-[var(--usha-white)]">
      <div className="mx-auto max-w-lg px-4 py-6">
        <Link
          href={`/app/events/${listing.id}/edit`}
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-[var(--usha-muted)] transition-colors hover:text-[var(--usha-white)]"
        >
          <ArrowLeft size={14} />
          {t("back")}
        </Link>

        <div className="mb-6 flex items-center gap-2">
          <Receipt size={20} className="text-[var(--usha-gold)]" />
          <h1 className="text-xl font-bold">{t("heading")}</h1>
        </div>
        <p className="mb-6 text-sm text-[var(--usha-muted)]">{listing.title}</p>

        <div className="divide-y divide-[var(--usha-border)] overflow-hidden rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)]">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between px-5 py-4">
              <div>
                <p className={`text-sm ${r.strong ? "font-semibold text-[var(--usha-white)]" : "text-[var(--usha-muted)]"}`}>
                  {r.label}
                </p>
                {r.sub && <p className="text-xs text-[var(--usha-muted)]">{r.sub}</p>}
              </div>
              <p
                className={`text-sm tabular-nums ${
                  r.strong
                    ? "text-lg font-bold text-[var(--usha-gold)]"
                    : r.negative
                      ? "text-red-400"
                      : "font-medium text-[var(--usha-white)]"
                }`}
              >
                {r.value}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs leading-relaxed text-[var(--usha-muted)]">{t("footer")}</p>

        {split && (
          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold text-[var(--usha-white)]">
              {t("shareHeading", { partner: partnerName })}
            </h2>

            <div className="divide-y divide-[var(--usha-border)] overflow-hidden rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)]">
              {shareRows.map((r) => (
                <div key={r.label} className="flex items-center justify-between px-5 py-4">
                  <div>
                    <p className={`text-sm ${r.strong ? "font-semibold text-[var(--usha-white)]" : "text-[var(--usha-muted)]"}`}>
                      {r.label}
                    </p>
                    {r.sub && <p className="text-xs text-[var(--usha-muted)]">{r.sub}</p>}
                  </div>
                  <p
                    className={`text-sm tabular-nums ${
                      r.strong
                        ? "text-lg font-bold text-[var(--usha-gold)]"
                        : r.negative
                          ? "text-red-400"
                          : "font-medium text-[var(--usha-white)]"
                    }`}
                  >
                    {r.value}
                  </p>
                </div>
              ))}
            </div>

            {payout && (
              <p
                className={`mt-3 rounded-xl border px-4 py-3 text-xs leading-relaxed ${
                  payout.status === "paid"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                    : payout.status === "failed"
                      ? "border-red-500/30 bg-red-500/10 text-red-200"
                      : "border-[var(--usha-border)] bg-[var(--usha-card)] text-[var(--usha-muted)]"
                }`}
              >
                {payout.status === "paid"
                  ? t("payoutPaid", {
                      date: payout.paid_at ? new Date(payout.paid_at).toLocaleDateString("sv-SE") : "",
                    })
                  : payout.status === "failed"
                    ? t("payoutFailed", { error: payout.error ?? "" })
                    : payout.status === "dry_run"
                      ? t("payoutDryRun", { amount: `${kr(payout.amount_ore)} kr` })
                      : t("payoutPending")}
              </p>
            )}

            {!payout && !partnerCanReceive && (
              <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-200">
                {t("sharePending")}
              </p>
            )}

            <p className="mt-4 text-xs leading-relaxed text-[var(--usha-muted)]">{t("shareFooter")}</p>
          </section>
        )}
        <ShareForm
          listingId={listing.id}
          venueName={kopplatLokalnamn}
          hasSales={harForsaljning}
          existing={
            share
              ? {
                  partnerPercent: share.partner_percent,
                  vatRate: Number(share.vat_rate),
                  payoutDelayDays: share.payout_delay_days ?? 1,
                }
              : null
          }
          labels={{
            heading: t("shareFormHeading"),
            intro: t("shareFormIntro", { venue: "{venue}" }),
            noVenue: t("shareFormNoVenue"),
            percent: t("shareFormPercent"),
            vat: t("shareFormVat"),
            delay: t("shareFormDelay"),
            delayHint: t("shareFormDelayHint"),
            save: t("shareFormSave"),
            saved: t("shareFormSaved"),
            remove: t("shareFormRemove"),
            locked: t("shareFormLocked"),
          }}
        />
      </div>
    </main>
  );
}
