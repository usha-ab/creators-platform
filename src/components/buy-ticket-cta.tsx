"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Ticket, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/toaster";

/**
 * Compact "buy ticket / book" CTA for event cards in browse/discovery views
 * (home, search, experiences).
 *
 * Fast path: for a LOGGED-IN buyer on a SINGLE-PRICE paid event we know for
 * certain (hasTicketTypes === false), tapping opens a small confirm sheet →
 * one tap → Stripe. No event-page detour.
 *
 * Everything else — logged-out, free, typed (price tiers), or unknown — routes
 * to the event page, which hosts guest checkout, the tier picker and free RSVP.
 * This guarantees we never start a wrong-price charge (checkout without a tier
 * would silently fall back to the base price).
 *
 * A <button> (not <a>) so it can live inside cards that are themselves links
 * without nesting anchors; stopPropagation avoids double navigation.
 */
export function BuyTicketCta({
  listingId,
  slug,
  price,
  isLoggedIn = false,
  hasTicketTypes,
  fromPrice = false,
  className,
}: {
  listingId: string;
  slug?: string | null;
  price?: number | null;
  isLoggedIn?: boolean;
  /** Whether the event has price tiers. Only `false` (known single-price) enables the fast path. */
  hasTicketTypes?: boolean;
  /** Priset är det lägsta av flera — knappen ska säga "från", inte lova ett pris. */
  fromPrice?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const t = useTranslations("eventPage");
  const { toast } = useToast();
  const [sheet, setSheet] = useState(false);
  const [loading, setLoading] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  const closeSheet = useCallback(() => {
    if (!loading) setSheet(false);
  }, [loading]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSheet();
    },
    [closeSheet]
  );

  useEffect(() => {
    if (sheet) {
      document.addEventListener("keydown", handleKeyDown);
      sheetRef.current?.focus();
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [sheet, handleKeyDown]);

  const isFree = !price || price <= 0;
  // The event page resolves a raw listing id as well as a slug.
  const eventHref = `/event/${slug || listingId}`;
  const canQuickBuy = isLoggedIn && hasTicketTypes === false && !isFree;

  async function confirmBuy() {
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/ticket-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, quantity: 1 }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(t("errorTitle"), data.error ?? t("errorRetry"));
        setLoading(false);
        return;
      }
      if (data.url) window.location.href = data.url;
      else setLoading(false);
    } catch {
      toast.error(t("errorTitle"), t("errorRetry"));
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (canQuickBuy) setSheet(true);
          else router.push(eventHref);
        }}
        className={
          className ??
          "inline-flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-3 py-2 text-xs font-semibold text-black transition hover:opacity-90"
        }
      >
        <Ticket size={13} />
        {isFree
          ? t("freeTicket")
          : t(fromPrice ? "buyTicketFrom" : "buyTicket", { price: price! })}
      </button>

      {sheet && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
          onClick={(e) => {
            e.stopPropagation();
            if (!loading) setSheet(false);
          }}
        >
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="quickbuy-title"
            tabIndex={-1}
            className="w-full max-w-sm rounded-t-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-5 outline-none sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 id="quickbuy-title" className="text-base font-bold">{t("quickBuyTitle")}</h3>
              <button
                type="button"
                onClick={() => !loading && setSheet(false)}
                className="rounded-lg p-1.5 text-[var(--usha-muted)] hover:bg-[var(--usha-card-hover)]"
                aria-label={t("quickBuyCancel")}
              >
                <X size={18} />
              </button>
            </div>
            <button
              type="button"
              onClick={confirmBuy}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-4 py-3 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-60"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Ticket size={18} />}
              {loading ? t("booking") : t("quickBuyConfirm", { price: price! })}
            </button>
            <button
              type="button"
              onClick={() => !loading && setSheet(false)}
              className="mt-2 w-full rounded-xl px-4 py-2.5 text-sm font-medium text-[var(--usha-muted)] transition hover:text-[var(--usha-white)]"
            >
              {t("quickBuyCancel")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
