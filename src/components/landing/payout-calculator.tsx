"use client";

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  commissionTextParts,
  formatKrFromOre,
  isBelowMinimumPrice,
  PAYOUT_EXAMPLE_DEFAULT,
  PAYOUT_EXAMPLE_LIMITS,
  ticketPayoutExample,
} from "@/lib/stripe/payout-example";

function parseInput(raw: string): number {
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Räknaren "säljer du 20 biljetter à 150 kr får du X kr". Siffrorna kommer
 * från lib/stripe/payout-example, som räknar som kassan. Står på
 * /salj-biljetter och under kreatörsfliken i prislistan.
 */
export function PayoutCalculator() {
  const t = useTranslations("landing");
  const locale = useLocale();
  const id = useId();
  const [price, setPrice] = useState<string>(String(PAYOUT_EXAMPLE_DEFAULT.priceKr));
  const [qty, setQty] = useState<string>(String(PAYOUT_EXAMPLE_DEFAULT.qty));

  const priceKr = parseInput(price);
  const qtyN = Math.floor(parseInput(qty));
  const ex = ticketPayoutExample(priceKr, qtyN);
  const { rate, fixed } = commissionTextParts(locale);
  const priceText = formatKrFromOre(Math.round(Math.max(0, priceKr) * 100), locale);
  const fmt = (ore: number) => formatKrFromOre(ore, locale);

  const inputCls =
    "w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-black)] px-4 py-3 text-base text-[var(--usha-white)] outline-none transition focus:border-[var(--usha-gold)]/50";

  return (
    <div className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-5 text-left sm:p-7" data-testid="payout-calculator">
      <h3 className="text-lg font-semibold">{t("payoutCalc.title")}</h3>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label htmlFor={`${id}-price`} className="block text-sm text-[var(--usha-muted)]">
          {t("payoutCalc.priceLabel")}
          <input
            id={`${id}-price`}
            type="number"
            inputMode="decimal"
            min={0}
            max={PAYOUT_EXAMPLE_LIMITS.maxPriceKr}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className={`${inputCls} mt-1.5`}
          />
        </label>
        <label htmlFor={`${id}-qty`} className="block text-sm text-[var(--usha-muted)]">
          {t("payoutCalc.qtyLabel")}
          <input
            id={`${id}-qty`}
            type="number"
            inputMode="numeric"
            min={0}
            max={PAYOUT_EXAMPLE_LIMITS.maxQty}
            step={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className={`${inputCls} mt-1.5`}
          />
        </label>
      </div>

      <p className="mt-5 text-base leading-relaxed" aria-live="polite">
        {ex.grossOre > 0
          ? t.rich("payoutCalc.result", {
              qty: qtyN,
              price: priceText,
              net: fmt(ex.netOre),
              b: (chunks) => <strong className="text-[var(--usha-gold)]">{chunks}</strong>,
            })
          : isBelowMinimumPrice(priceKr)
            ? t("payoutCalc.minPriceNote", { min: PAYOUT_EXAMPLE_LIMITS.minPriceKr })
            : t("payoutCalc.freeNote")}
      </p>

      {ex.grossOre > 0 && (
        <dl className="mt-4 space-y-1.5 border-t border-[var(--usha-border)] pt-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--usha-muted)]">{t("payoutCalc.grossLabel")}</dt>
            <dd className="tabular-nums">{fmt(ex.grossOre)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--usha-muted)]">{t("payoutCalc.commissionLabel", { rate, fixed })}</dt>
            <dd className="tabular-nums">−{fmt(ex.commissionOre)}</dd>
          </div>
          <div className="flex justify-between gap-4 font-semibold">
            <dt>{t("payoutCalc.netLabel")}</dt>
            <dd className="tabular-nums text-[var(--usha-gold)]">{fmt(ex.netOre)}</dd>
          </div>
        </dl>
      )}

      <p className="mt-4 text-xs leading-relaxed text-[var(--usha-muted)]">
        {t("payoutCalc.buyerNote", { price: ex.grossOre > 0 ? priceText : fmt(0) })}
      </p>
    </div>
  );
}
