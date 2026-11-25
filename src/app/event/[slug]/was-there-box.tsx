"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Ticket } from "lucide-react";
import { useToast } from "@/components/ui/toaster";
import { openCheckout } from "@/lib/native-oauth";

/**
 * "Var du där?" — betala för en PASSERAD kväll i efterhand.
 *
 * Skild från köpknappen med flit: vanliga köp går alltid till nästa kväll,
 * och det här är det enda sättet att betala för en kväll som varit. Knappen
 * hör till just den här kvällens datum, och bekräftelsesteget säger alltid
 * vilken kväll man betalar för. Kassan kontrollerar fönstret (24 timmar efter
 * kvällens slut), en biljett per person och att ingen redan betalat.
 */

interface Option {
  id: string | null;
  name: string;
  price: number;
}

export function WasThereBox({
  listingId,
  isLoggedIn,
  options,
  evening,
}: {
  listingId: string;
  isLoggedIn: boolean;
  /** Biljettyperna, eller en rad med kvällens pris. */
  options: Option[];
  evening: { name: string; weekday: string; date: string; time: string };
}) {
  const t = useTranslations("eventPage");
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Option | null>(options[0] ?? null);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  if (!chosen) return null;

  async function pay() {
    if (!chosen || loading) return;
    setLoading(true);
    try {
      const res = await fetch(isLoggedIn ? "/api/stripe/ticket-checkout" : "/api/stripe/guest-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId,
          ticketTypeId: chosen.id ?? undefined,
          quantity: 1,
          attendeeNames: [],
          wasThere: true,
          ...(isLoggedIn ? {} : { email }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(t("errorTitle"), data.error ?? t("errorRetry"));
        return;
      }
      if (data.url) openCheckout(data.url);
    } catch {
      toast.error(t("errorTitle"), t("errorRetry"));
    } finally {
      setLoading(false);
    }
  }

  const BTN =
    "inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--usha-gold)]/60 bg-[var(--usha-black)] px-6 py-3.5 text-base font-bold text-[var(--usha-gold)] transition hover:bg-[var(--usha-gold)]/10 disabled:opacity-60";

  return (
    <div className="space-y-3 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4">
      <p className="text-center text-xs text-[var(--usha-muted)]">
        {t("wasThereLead", { weekday: evening.weekday, date: evening.date })}
      </p>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className={BTN}>
          <Ticket size={18} />
          {t("wasThereButtonDated", { weekday: evening.weekday, date: evening.date })}
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            pay();
          }}
          className="space-y-3"
        >
          {options.length > 1 && (
            <div className="space-y-1.5">
              {options.map((o) => (
                <label key={o.id ?? "base"} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--usha-border)] px-3 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <input type="radio" name="was-there-type" checked={chosen.id === o.id} onChange={() => setChosen(o)} />
                    {o.name}
                  </span>
                  <span className="font-medium">{t("priceLabel", { price: o.price })}</span>
                </label>
              ))}
            </div>
          )}
          <p className="text-sm font-semibold leading-relaxed">
            {t("wasThereConfirmText", { price: chosen.price, name: evening.name, weekday: evening.weekday, date: evening.date, time: evening.time })}
          </p>
          {!isLoggedIn && (
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("emailPlaceholder")}
              aria-label={t("wasThereEmailLabel")}
              autoComplete="email"
              className="w-full rounded-lg border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2 text-sm"
            />
          )}
          <button type="submit" disabled={loading} className={BTN}>
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Ticket size={18} />}
            {loading ? t("booking") : t("wasThereConfirmButton", { price: chosen.price })}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="w-full text-center text-xs text-[var(--usha-muted)] underline underline-offset-2">
            {t("wasThereCancel")}
          </button>
        </form>
      )}
    </div>
  );
}
