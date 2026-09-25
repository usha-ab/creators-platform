"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2, CheckCircle2, RefreshCw } from "lucide-react";

/**
 * Entréförsäljning utan kortläsare.
 *
 * Värden väljer biljett och visar QR-koden; gästen scannar med sin egen
 * telefon och betalar med Apple Pay eller Google Pay. Gästens telefon är
 * terminalen, och köpet går genom samma kassa som en onlineförsäljning — så
 * pengarna landar i Stripe och avräkningen stämmer utan efterarbete.
 *
 * Skärmen pollar efter betalningar medan koden visas. Utan den bekräftelsen
 * står värden och väntar på att gästen ska leta fram sitt kvittomejl innan hen
 * kan släppas in, och då är hela poängen med snabbheten borta.
 */

interface TicketType {
  id: string;
  name: string;
  price: number;
  capacity: number | null;
  tickets_sold: number;
}

interface Sale {
  id: string;
  guest_name: string | null;
  guest_email: string | null;
  amount_paid: number | null;
  guest_count: number | null;
  ticket_type_name: string | null;
  created_at: string;
}

const POLL_MS = 5000;

export default function EntrancePage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("entrance");

  const [title, setTitle] = useState("");
  const [types, setTypes] = useState<TicketType[]>([]);
  const [selected, setSelected] = useState<TicketType | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tidsstämpeln kommer från servern, inte från telefonen. En entrémobil med
  // några minuters klockfel hade annars antingen missat betalningar eller
  // visat gamla som nya.
  const since = useRef<string | null>(null);

  const load = useCallback(
    async (poll: boolean) => {
      try {
        const qs = poll && since.current ? `?since=${encodeURIComponent(since.current)}` : "";
        const res = await fetch(`/api/events/${id}/entry${qs}`);
        if (!res.ok) {
          setError(res.status === 403 ? t("noPermission") : t("loadError"));
          return;
        }
        const data = await res.json();
        setError(null);
        setTitle(data.listing.title);
        setTypes(data.ticketTypes);
        if (poll) {
          if (data.sales.length > 0) setSales((prev) => [...data.sales, ...prev].slice(0, 8));
        } else {
          setSales(data.sales);
        }
        since.current = data.now;
      } catch {
        setError(t("connectionLost"));
      } finally {
        setLoading(false);
      }
    },
    [id, t]
  );

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const soldOut = (tt: TicketType) => tt.capacity != null && tt.tickets_sold >= tt.capacity;

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="animate-spin text-[var(--usha-muted)]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 pb-24 pt-6">
      <Link
        href={`/app/events/${id}/edit`}
        className="mb-4 inline-flex items-center gap-2 text-sm text-[var(--usha-muted)] transition hover:text-[var(--usha-white)]"
      >
        <ArrowLeft size={16} />
        {t("back")}
      </Link>

      <h1 className="text-xl font-bold">{t("title")}</h1>
      <p className="mt-1 text-sm text-[var(--usha-muted)]">{title}</p>

      {error && (
        <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      {!selected ? (
        <>
          <p className="mt-6 text-sm text-[var(--usha-muted)]">{t("pickTicket")}</p>
          <div className="mt-3 space-y-2">
            {types.length === 0 && (
              <p className="rounded-xl border border-[var(--usha-border)] p-4 text-sm text-[var(--usha-muted)]">
                {t("noTicketTypes")}
              </p>
            )}
            {types.map((tt) => (
              <button
                key={tt.id}
                onClick={() => setSelected(tt)}
                disabled={soldOut(tt)}
                className="flex w-full items-center justify-between rounded-xl border border-[var(--usha-border)] p-4 text-left transition hover:border-[var(--usha-gold)]/60 disabled:opacity-40"
              >
                <span className="font-medium">{tt.name}</span>
                <span className="text-[var(--usha-gold)]">
                  {soldOut(tt) ? t("soldOut") : t("priceSek", { price: tt.price })}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="mt-6">
          <div className="rounded-2xl bg-white p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/events/${id}/entry/qr?tt=${encodeURIComponent(selected.id)}`}
              alt={t("qrAlt", { ticket: selected.name })}
              className="mx-auto block h-auto w-full max-w-[320px]"
            />
          </div>
          <p className="mt-4 text-center text-lg font-semibold">
            {selected.name} · {t("priceSek", { price: selected.price })}
          </p>
          <p className="mt-1 text-center text-sm text-[var(--usha-muted)]">{t("guestScans")}</p>

          <button
            onClick={() => setSelected(null)}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--usha-border)] py-3 text-sm font-medium transition hover:border-[var(--usha-gold)]/60"
          >
            <RefreshCw size={15} />
            {t("otherTicket")}
          </button>
        </div>
      )}

      {sales.length > 0 && (
        <div className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--usha-muted)]">
            {t("paidHeading")}
          </p>
          <ul className="mt-3 space-y-2">
            {sales.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-3 rounded-xl border border-green-500/30 bg-green-500/5 px-4 py-3"
              >
                <CheckCircle2 size={18} className="shrink-0 text-green-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {s.guest_name || s.guest_email || t("guest")}
                  </p>
                  <p className="truncate text-xs text-[var(--usha-muted)]">
                    {s.ticket_type_name ?? ""}
                    {s.guest_count && s.guest_count > 1 ? ` · ${t("seats", { n: s.guest_count })}` : ""}
                  </p>
                </div>
                {s.amount_paid != null && (
                  <span className="shrink-0 text-sm text-[var(--usha-gold)]">
                    {t("priceSek", { price: Math.round(s.amount_paid / 100) })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
