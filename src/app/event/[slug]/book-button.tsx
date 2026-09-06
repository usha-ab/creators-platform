"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Ticket, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/toaster";
import { applicableCredit, SIGNUP_CREDIT_MIN_SPEND_ORE } from "@/lib/credits/signup";

interface TicketType {
  id: string;
  name: string;
  price: number;
  capacity: number | null;
  tickets_sold: number;
}

interface Props {
  listingId: string;
  price: number;
  isLoggedIn: boolean;
  returnPath: string;
  ticketTypes?: TicketType[];
  /**
   * Förvald biljettyp, från `?tt=` på eventsidan. Används av "Lägg till" på
   * biljettsidan: den som köpt practica och vill ha workshopen ska landa med
   * workshopen redan vald, inte behöva hitta raden igen i dörren.
   */
  preselectTicketTypeId?: string | null;
  /** Köparens outnyttjade välkomstavdrag i öre. 0 = inget att visa. */
  creditOre?: number;
  /**
   * Prisrubriken ovanför väljaren. Den renderades tidigare av sidan, på
   * servern, och kunde därför bara visa grundpriset — valde man Workshop för
   * 100 kr stod det fortfarande 50 kr i stort format medan köpknappen sa 100.
   * Två olika belopp i samma ruta, och det översta det man läser först.
   *
   * Rubriken bor här nu, hos valet den beskriver. Sidan skickar bara det som
   * inte kan ändras av ett klick.
   */
  header?: {
    /** "Biljett", eller ett läge som "Early bird". */
    badge: string;
    /** Ordinarie pris, för överstrykning när sista minuten-priset är lägre. */
    listPrice: number | null;
    note: string | null;
  };
}

const BTN =
  "inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-8 py-4 text-base font-bold text-black shadow-lg transition hover:opacity-90 disabled:opacity-60 whitespace-nowrap sm:text-lg";

function soldOut(tt: TicketType) {
  return tt.capacity != null && tt.tickets_sold >= tt.capacity;
}

export function BookButton({ listingId, price, isLoggedIn, ticketTypes = [], header, preselectTicketTypeId, creditOre = 0 }: Props) {
  const { toast } = useToast();
  const t = useTranslations("eventPage");
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  const hasTypes = ticketTypes.length > 0;
  const [selectedTypeId, setSelectedTypeId] = useState<string>(() => {
    // Förvalet gäller bara om typen finns och går att köpa — en länk till en
    // slutsåld typ ska inte låsa knappen.
    const wanted = ticketTypes.find((tt) => tt.id === preselectTicketTypeId && !soldOut(tt));
    return wanted?.id ?? ticketTypes.find((tt) => !soldOut(tt))?.id ?? ticketTypes[0]?.id ?? "";
  });
  const selectedType = hasTypes ? ticketTypes.find((tt) => tt.id === selectedTypeId) ?? null : null;
  const effectivePrice = selectedType ? selectedType.price : price;
  const typeSoldOut = selectedType ? soldOut(selectedType) : false;

  const isFree = !effectivePrice || effectivePrice <= 0;
  // Quantity (paid tickets only). Buying N → one order, N scannable QRs.
  const MAX_QTY = 10;
  const [qty, setQty] = useState(1);
  // Optional per-attendee names (index 0..qty-1). Left blank → "Gäst i" on the QR.
  const [names, setNames] = useState<string[]>([]);
  const setAttendeeName = (i: number, v: string) =>
    setNames((p) => {
      const next = [...p];
      next[i] = v;
      return next;
    });
  const attendeeNames = Array.from({ length: qty }, (_, i) => names[i] ?? "");
  const total = effectivePrice * qty;
  // Avdraget räknas i ören men visas i kronor, och gäller bara över gränsen.
  const credit = applicableCredit({ creditOre, subtotalOre: total * 100 });
  const totalAfterCredit = total - credit / 100;
  const label = isFree
    ? t("freeTicket")
    : t("buyTicket", { price: credit > 0 ? totalAfterCredit : total });

  async function checkout(endpoint: string, payload: Record<string, unknown>) {
    setLoading(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(t("errorTitle"), data.error ?? t("errorRetry"));
        return;
      }
      if (data.url) window.location.href = data.url;
    } catch {
      toast.error(t("errorTitle"), t("errorRetry"));
    } finally {
      setLoading(false);
    }
  }

  // Rubriken namnger biljetten man valt, inte "Biljett" i allmänhet. Står det
  // "Workshop 19–20 · 100 kr" över en köpknapp som säger 100 kr finns det inget
  // att bli förvirrad av. Antalet räknas inte in — rubriken beskriver EN
  // biljett, knappen beskriver ordern.
  const headerBlock = header ? (
    <div className="mb-4 text-center">
      <p className="text-xs uppercase tracking-wide text-[var(--usha-muted)]">
        {selectedType ? selectedType.name : header.badge}
      </p>
      <p className="mt-1 whitespace-nowrap text-3xl font-bold text-[var(--usha-gold)]">
        {isFree ? (
          t("free")
        ) : (
          <>
            {/* Överstrykningen jämför mot listingens ordinarie pris och säger
                alltså bara något om grundbiljetten. Med biljettyper jämför den
                två olika saker, så då visas den inte. */}
            {!selectedType && header.listPrice != null && effectivePrice < header.listPrice && (
              <span className="mr-2 align-middle text-xl font-normal text-[var(--usha-muted)] line-through">
                {t("priceLabel", { price: header.listPrice })}
              </span>
            )}
            {t("priceLabel", { price: effectivePrice })}
          </>
        )}
      </p>
      {header.note && (
        <p className="mt-1 text-xs text-[var(--usha-muted)]">{header.note}</p>
      )}
    </div>
  ) : null;

  const picker = hasTypes ? (
    <div className="mb-3 space-y-2">
      {ticketTypes.map((tt) => {
        const out = soldOut(tt);
        const active = tt.id === selectedTypeId;
        return (
          <button
            type="button"
            key={tt.id}
            disabled={out}
            onClick={() => setSelectedTypeId(tt.id)}
            className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition disabled:opacity-40 ${
              active
                ? "border-[var(--usha-gold)]/60 bg-[var(--usha-gold)]/10 text-[var(--usha-white)]"
                : "border-[var(--usha-border)] text-[var(--usha-white)] hover:border-[var(--usha-gold)]/40"
            }`}
          >
            <span className="font-medium">{tt.name}</span>
            <span className="text-[var(--usha-muted)]">
              {out ? t("soldOut") : tt.price > 0 ? t("priceLabel", { price: tt.price }) : t("freeTicket")}
            </span>
          </button>
        );
      })}
    </div>
  ) : null;

  // Quantity stepper (paid tickets only). Free events stay one-per-order.
  const qtyStepper = !isFree ? (
    <div className="mb-3 flex items-center justify-between rounded-xl border border-[var(--usha-border)] px-4 py-2.5">
      <span className="text-sm text-[var(--usha-muted)]">{t("quantity")}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setQty((q) => Math.max(1, q - 1))}
          disabled={qty <= 1}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--usha-border)] text-lg leading-none disabled:opacity-40"
          aria-label="−"
        >
          −
        </button>
        <span className="w-6 text-center text-sm font-semibold">{qty}</span>
        <button
          type="button"
          onClick={() => setQty((q) => Math.min(MAX_QTY, q + 1))}
          disabled={qty >= MAX_QTY}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--usha-border)] text-lg leading-none disabled:opacity-40"
          aria-label="+"
        >
          +
        </button>
      </div>
    </div>
  ) : null;

  // Optional per-ticket name inputs (multi-ticket orders only).
  const nameInputs = !isFree && qty > 1 ? (
    <div className="mb-3 space-y-2">
      {Array.from({ length: qty }, (_, i) => (
        <input
          key={i}
          value={names[i] ?? ""}
          onChange={(e) => setAttendeeName(i, e.target.value)}
          maxLength={60}
          placeholder={t("attendeeNamePlaceholder", { n: i + 1 })}
          className="w-full rounded-lg border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2 text-sm outline-none focus:border-[var(--usha-gold)]/50"
        />
      ))}
    </div>
  ) : null;

  // Avdraget måste synas innan man trycker, annars är det ingen anledning att
  // trycka. Står det bara i Stripe har köparen redan bestämt sig.
  const creditNote =
    credit > 0 ? (
      <p className="mb-2 text-center text-xs font-medium text-green-400">
        {t("creditApplied", { amount: credit / 100 })}
      </p>
    ) : creditOre > 0 && !isFree ? (
      <p className="mb-2 text-center text-[11px] text-[var(--usha-muted)]">
        {t("creditMinSpend", {
          amount: creditOre / 100,
          min: SIGNUP_CREDIT_MIN_SPEND_ORE / 100,
        })}
      </p>
    ) : null;

  // Logged-in: existing ticket checkout (uses the account).
  if (isLoggedIn) {
    return (
      <>
        {headerBlock}
        {picker}
        {qtyStepper}
        {nameInputs}
        {creditNote}
        <button
          onClick={() => checkout("/api/stripe/ticket-checkout", { listingId, ticketTypeId: selectedTypeId || undefined, quantity: qty, attendeeNames })}
          disabled={loading || typeSoldOut}
          className={BTN}
        >
          {loading ? <Loader2 size={20} className="animate-spin" /> : <Ticket size={20} />}
          {loading ? t("booking") : label}
        </button>
      </>
    );
  }

  // Logged-out: guest checkout — buy with just an email, no account required.
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        checkout("/api/stripe/guest-checkout", { listingId, email, name, ticketTypeId: selectedTypeId || undefined, quantity: qty, attendeeNames });
      }}
      className="space-y-2"
    >
      {headerBlock}
      {picker}
      {qtyStepper}
      {nameInputs}
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("emailPlaceholder")}
        autoComplete="email"
        className="w-full rounded-lg border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2 text-sm"
      />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("namePlaceholder")}
        autoComplete="name"
        className="w-full rounded-lg border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2 text-sm"
      />
      <button type="submit" disabled={loading || typeSoldOut} className={BTN}>
        {loading ? <Loader2 size={20} className="animate-spin" /> : <Ticket size={20} />}
        {loading ? t("booking") : label}
      </button>
    </form>
  );
}
