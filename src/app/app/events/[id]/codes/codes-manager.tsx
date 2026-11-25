"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createAccessCode, toggleAccessCode } from "./actions";
import { isAllowedTicketPrice, MIN_PAID_TICKET_PRICE_SEK, MIN_PRICE_ERROR_CODE } from "@/lib/stripe/min-price";

interface Code {
  id: string;
  code: string;
  label: string | null;
  max_uses: number | null;
  used_count: number;
  is_active: boolean;
  discount_price: number | null;
}

export function CodesManager({ listingId, codes }: { listingId: string; codes: Code[] }) {
  const t = useTranslations("hostEvent");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError("");
    const minPriceMsg = t("minPriceError", { min: MIN_PAID_TICKET_PRICE_SEK });
    // Samma regel som servern: tomt/0 = gratis, annars minst 50 kr.
    const disc = Number(fd.get("discount_price") || 0);
    if (!isAllowedTicketPrice(Number.isFinite(disc) ? Math.floor(disc) : NaN)) {
      setError(minPriceMsg);
      return;
    }
    start(async () => {
      const r = await createAccessCode(listingId, fd);
      if (r?.error) setError("code" in r && r.code === MIN_PRICE_ERROR_CODE ? minPriceMsg : r.error);
      else {
        form.reset();
        router.refresh();
      }
    });
  }

  function onToggle(id: string, active: boolean) {
    start(async () => {
      await toggleAccessCode(listingId, id, active);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onCreate} className="grid grid-cols-1 gap-2 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4 sm:grid-cols-5">
        <input
          name="code"
          required
          placeholder={t("colCode")}
          className="rounded-lg border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2 text-sm uppercase"
        />
        <input
          name="label"
          placeholder={t("labelPlaceholder")}
          className="rounded-lg border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2 text-sm"
        />
        <input
          name="max_uses"
          type="number"
          min={1}
          placeholder={t("maxUsesPlaceholder")}
          className="rounded-lg border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2 text-sm"
        />
        <input
          name="discount_price"
          type="number"
          min={0}
          placeholder={t("discountPricePlaceholder")}
          className="rounded-lg border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[var(--usha-gold)] px-4 py-2 text-sm font-bold text-black disabled:opacity-60"
        >
          {t("createCode")}
        </button>
        <p className="text-xs text-[var(--usha-muted)] sm:col-span-5">{t("discountHint", { min: MIN_PAID_TICKET_PRICE_SEK })}</p>
        {error && <p className="text-xs text-red-400 sm:col-span-5">{error}</p>}
      </form>

      {codes.length === 0 ? (
        <div className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-8 text-center text-sm text-[var(--usha-muted)]">
          {t("noCodes")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--usha-border)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--usha-card)] text-[var(--usha-muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">{t("colCode")}</th>
                <th className="px-4 py-3 font-medium">{t("colLabel")}</th>
                <th className="px-4 py-3 font-medium">{t("colPrice")}</th>
                <th className="px-4 py-3 font-medium">{t("colUsed")}</th>
                <th className="px-4 py-3 font-medium">{t("colActive")}</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.id} className="border-t border-[var(--usha-border)]">
                  <td className="px-4 py-3 font-mono font-semibold">{c.code}</td>
                  <td className="px-4 py-3 text-[var(--usha-muted)]">{c.label ?? "—"}</td>
                  <td className="px-4 py-3">
                    {c.discount_price ? `${c.discount_price} kr` : t("freeLabel")}
                  </td>
                  <td className="px-4 py-3">
                    {c.used_count} / {c.max_uses ?? t("unlimited")}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => onToggle(c.id, !c.is_active)}
                      disabled={pending}
                      className={c.is_active ? "text-[var(--usha-gold)]" : "text-[var(--usha-muted)]"}
                    >
                      {c.is_active ? t("codeYes") : t("codeNo")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
