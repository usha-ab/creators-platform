"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Ticket, Loader2, HeartPulse, Smartphone } from "lucide-react";
import { useToast } from "@/components/ui/toaster";
import type { SwishOffer } from "@/lib/swish/availability";
import { applicableCredit, SIGNUP_CREDIT_MIN_SPEND_ORE } from "@/lib/credits/signup";
import { trackEvent } from "@/lib/analytics";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { openCheckout } from "@/lib/native-oauth";
import { passExpiryFrom } from "@/lib/passes/series-pass";

interface TicketType {
  id: string;
  name: string;
  price: number;
  capacity: number | null;
  tickets_sold: number;
}

/** Klippkort på serien: köps här, gäller på seriens alla kvällar. */
interface PassOption {
  id: string;
  title: string;
  price: number;
  sessionCount: number;
  covers: string | null;
  /** Arrangörens eget jämförpris per kväll, om hen satt ett. */
  referencePrice?: number | null;
  /** Vad kortet sparar mot kvällsbiljetten. null = ingen rabatt att visa. */
  savings?: { perSession: number; percent: number } | null;
  /** Friskvårdsgodkänt: kortet finns i Epassi och kan betalas med friskvårdsbidrag. */
  wellness?: boolean;
}

interface Props {
  listingId: string;
  price: number;
  isLoggedIn: boolean;
  returnPath: string;
  ticketTypes?: TicketType[];
  passes?: PassOption[];
  /**
   * Förvald biljettyp, från `?tt=` på eventsidan. Används av "Lägg till" på
   * biljettsidan: den som köpt practica och vill ha workshopen ska landa med
   * workshopen redan vald, inte behöva hitta raden igen i dörren.
   */
  preselectTicketTypeId?: string | null;
  /** Förvalt klippkort, från `?kort=` (dörrskärmens klippkortskod). */
  preselectPassId?: string | null;
  /**
   * Köparens outnyttjade välkomstavdrag i öre. 0 = inget att visa. Avdraget
   * delas inte ut längre (avvecklat 2026-11-12), men de som fick det behåller
   * det tills det används eller går ut.
   */
  creditOre?: number;
  /**
   * Swish Företag, när sidan avgjort att det får erbjudas (Ushas egna kvällar,
   * numret satt). null = ingen Swish-knapp. Betalningen sker i Swish-appen;
   * här skapas bara en vilande bokning som entrén bekräftar mot kvittot.
   */
  swish?: SwishOffer | null;
  /** Inloggad köpares adress, så Swish-steget slipper fråga igen. */
  buyerEmail?: string | null;
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

export function BookButton({ listingId, price, isLoggedIn, ticketTypes = [], passes = [], header, preselectTicketTypeId, preselectPassId, creditOre = 0, swish = null, buyerEmail = null }: Props) {
  const { toast } = useToast();
  const t = useTranslations("eventPage");
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  // Swish: panelen frågar efter e-post FÖRST och skapar en vilande bokning,
  // sedan går köparen till biljettsidan och swishar där. Den sidan överlever
  // hoppet till Swish-appen och tillbaka, och det är där QR-koden dyker upp
  // när entrén bekräftat. Panelen själv tar aldrig emot betalningen.
  const [swishOpen, setSwishOpen] = useState(false);
  const [swishEmail, setSwishEmail] = useState(buyerEmail ?? "");
  const [swishName, setSwishName] = useState("");
  const [swishLoading, setSwishLoading] = useState(false);

  const hasTypes = ticketTypes.length > 0;
  const [selectedTypeId, setSelectedTypeId] = useState<string>(() => {
    // Förvalet gäller bara om typen finns och går att köpa — en länk till en
    // slutsåld typ ska inte låsa knappen.
    const wanted = ticketTypes.find((tt) => tt.id === preselectTicketTypeId && !soldOut(tt));
    return wanted?.id ?? ticketTypes.find((tt) => !soldOut(tt))?.id ?? ticketTypes[0]?.id ?? "";
  });
  const selectedType = hasTypes ? ticketTypes.find((tt) => tt.id === selectedTypeId) ?? null : null;
  // Ett valt klippkort ersätter biljettvalet: ett kort, en order.
  const [selectedPassId, setSelectedPassId] = useState<string | null>(
    () => passes.find((p) => p.id === preselectPassId)?.id ?? null
  );
  const selectedPass = passes.find((p) => p.id === selectedPassId) ?? null;
  // "Jag vill kunna använda kortet direkt" (2 kap. 15 § p. 3). Aldrig förifylld:
  // bara en uttrycklig begäran ger säljaren rätt att dra av för använda klipp
  // om köpet ångras.
  const [earlyStart, setEarlyStart] = useState(false);
  const locale = useLocale();
  // Epassi: kunden betalar i Epassi-appen, inte här. Vi skapar ett vilande
  // kort som arrangören bekräftar när köpet syns i Epassis portal.
  const [epassiLoading, setEpassiLoading] = useState(false);
  const [epassiDone, setEpassiDone] = useState<{ title: string; price: number } | null>(null);
  // Klippkorten låg utfällda mellan biljettyperna och köpknappen. Fyra höga
  // kort betyder att den som bara vill ha en enkelbiljett skrollar förbi dem
  // varje gång — på mobil hamnade köpknappen under vecket. Hopfällda som
  // förval, men öppna om ett kort redan är valt (t.ex. via ?tt=).
  const [passesOpen, setPassesOpen] = useState(!!selectedPassId);
  // Bästa rabatten säljer sektionen utan att man behöver fälla ut den.
  const bestDiscount = passes.reduce((m, p) => Math.max(m, p.savings?.percent ?? 0), 0);
  const effectivePrice = selectedPass ? selectedPass.price : selectedType ? selectedType.price : price;
  const typeSoldOut = selectedType && !selectedPass ? soldOut(selectedType) : false;

  const isFree = !effectivePrice || effectivePrice <= 0;
  // Quantity (paid tickets only). Buying N → one order, N scannable QRs.
  const MAX_QTY = 10;
  const [qty, setQty] = useState(1);
  // Optional per-attendee names (index 0..qty-1). Left blank → "Gäst i" on the QR.
  const [names, setNames] = useState<string[]>([]);
  // "Visa att jag kommer". Av som standard: att köpa en biljett är inget
  // samtycke till att synas. Bara inloggade får frågan — ett gästköp har ingen
  // profil att visa, så ett kryss vore ett löfte vi inte kan hålla.
  const [showAttendance, setShowAttendance] = useState(false);
  const setAttendeeName = (i: number, v: string) =>
    setNames((p) => {
      const next = [...p];
      next[i] = v;
      return next;
    });
  const attendeeNames = Array.from({ length: qty }, (_, i) => names[i] ?? "");
  const effectiveQty = selectedPass ? 1 : qty;
  const total = effectivePrice * effectiveQty;
  // Avdraget räknas i ören men visas i kronor, och gäller bara över gränsen.
  const credit = applicableCredit({ creditOre, subtotalOre: total * 100 });
  const totalAfterCredit = total - credit / 100;
  const label = selectedPass
    ? t("buyPass", { price: credit > 0 ? totalAfterCredit : total })
    : isFree
      ? t("freeTicket")
      : t("buyTicket", { price: credit > 0 ? totalAfterCredit : total });

  async function checkout(endpoint: string, payload: Record<string, unknown>) {
    // Skickas innan resan till Stripe. Tillsammans med purchase-händelsen på
    // vägen tillbaka visar den hur många som börjar men inte fullföljer — det
    // är den siffran som säger om kassan är problemet eller priset.
    trackEvent(ANALYTICS_EVENTS.beginCheckout, {
      value: credit > 0 ? totalAfterCredit : total,
      currency: "SEK",
      item_id: selectedPass?.id ?? listingId,
      item_category: selectedPass ? "pass" : "ticket",
      quantity: effectiveQty,
      logged_in: isLoggedIn,
    });
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
      if (data.url) openCheckout(data.url);
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
        {selectedPass ? selectedPass.title : selectedType ? selectedType.name : header.badge}
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

  const rowClass = (active: boolean) =>
    `flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition disabled:opacity-40 ${
      active
        ? "border-[var(--usha-gold)]/60 bg-[var(--usha-gold)]/10 text-[var(--usha-white)]"
        : "border-[var(--usha-border)] text-[var(--usha-white)] hover:border-[var(--usha-gold)]/40"
    }`;

  const picker = hasTypes || passes.length > 0 ? (
    <div className="mb-3 space-y-2">
      {/* Utan biljettyper behövs ändå en rad för den vanliga biljetten, så
          att kortet är ett val och inte det enda alternativet. */}
      {!hasTypes && (
        <button type="button" onClick={() => setSelectedPassId(null)} className={rowClass(!selectedPass)}>
          <span className="font-medium">{t("singleTicket")}</span>
          <span className="text-[var(--usha-muted)]">{price > 0 ? t("priceLabel", { price }) : t("freeTicket")}</span>
        </button>
      )}
      {ticketTypes.map((tt) => {
        const out = soldOut(tt);
        const active = !selectedPass && tt.id === selectedTypeId;
        return (
          <button
            type="button"
            key={tt.id}
            disabled={out}
            onClick={() => { setSelectedTypeId(tt.id); setSelectedPassId(null); }}
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
      {/* Klippkorten bakom en hopfällbar rad. Utfällda tog de fyra kortshöjder
          mitt i köpflödet, och den som bara ville ha en enkelbiljett fick
          skrolla förbi allihop. Raden säljer dem i stället med bästa rabatten
          och antalet. */}
      {passes.length > 0 && (
        <button
          type="button"
          onClick={() => setPassesOpen((o) => !o)}
          aria-expanded={passesOpen}
          className="flex w-full items-center justify-between rounded-xl border border-[var(--usha-border)] px-4 py-3 text-left text-sm text-[var(--usha-white)] transition hover:border-[var(--usha-gold)]/40"
        >
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-medium">{t("passesHeading")}</span>
            {bestDiscount > 0 && (
              <span className="text-xs text-[var(--usha-gold)]">
                {t("passesSaveUpTo", { percent: bestDiscount })}
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-2 text-[var(--usha-muted)]">
            {/* Valt kort syns även hopfällt — annars försvinner valet ur sikte. */}
            {selectedPass && !passesOpen && (
              <span className="max-w-[9rem] truncate text-xs text-[var(--usha-gold)]">
                {selectedPass.title}
              </span>
            )}
            <span className={`transition-transform ${passesOpen ? "rotate-180" : ""}`} aria-hidden>
              ▾
            </span>
          </span>
        </button>
      )}
      {/* Kortets rad staplas i stället för att delas i två kolumner: titlarna
          är långa och biljettspalten smal, så sida vid sida blev titeln fem
          rader hög medan priset svävade i mitten. */}
      {passesOpen && passes.map((p) => (
        <button
          type="button"
          key={p.id}
          onClick={() => { setSelectedPassId(p.id); setQty(1); }}
          className={`${rowClass(p.id === selectedPassId)} flex-col items-stretch gap-1.5`}
        >
          <span className="font-medium">{p.title}</span>
          <span className="text-xs text-[var(--usha-muted)]">
            {t("passSessions", { n: p.sessionCount })}
            {p.covers ? ` · ${p.covers}` : ""}
            {/* Giltighetstiden är ett villkor för köpet och måste stå FÖRE
                man köper. Den låg bara i kortets beskrivning, och den
                beskrivningen renderas aldrig för köparen. */}
            {p.sessionCount > 0 ? ` · ${t("passValidMonths", { n: p.sessionCount })}` : ""}
          </span>
          {/* Priset och "kr/kväll" hör ihop och får aldrig brytas isär; ryms
              inte rabatten på samma rad hoppar den ned i stället. */}
          <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="font-semibold whitespace-nowrap">
              {t("priceLabel", { price: p.price })}
              {p.savings && (
                <span className="ml-1.5 text-xs font-normal whitespace-nowrap text-[var(--usha-muted)]">
                  {t("passPerSession", { price: p.savings.perSession })}
                </span>
              )}
            </span>
            {p.savings && (
              <span className="shrink-0 rounded-md bg-[var(--usha-gold)]/15 px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap text-[var(--usha-gold)]">
                {t("passDiscount", { percent: p.savings.percent })}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  ) : null;

  // Quantity stepper (paid tickets only). Free events stay one-per-order.
  const qtyStepper = !isFree && !selectedPass ? (
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
  const nameInputs = !isFree && !selectedPass && qty > 1 ? (
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

  const attendanceOptIn = isLoggedIn ? (
    <label className="mb-3 flex cursor-pointer items-start gap-2 text-left text-[12px] text-[var(--usha-muted)]">
      <input
        type="checkbox"
        checked={showAttendance}
        onChange={(e) => setShowAttendance(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--usha-gold)]"
      />
      <span>{t("showAttendanceLabel")}</span>
    </label>
  ) : null;

  // Klippkortets villkor FÖRE köpet: sista giltighetsdag, att oanvända klipp
  // förfaller, ångerrätten och var ångerknappen finns. Förfallet måste stå vid
  // köpet och inte bara i villkoren (ARN 2023-17878), och ångerrätten ska vara
  // känd före köpet (2 kap. 2 § p. 10 och 12).
  const passTerms = selectedPass && selectedPass.sessionCount > 0 && selectedPass.price > 0 ? (
    <div className="mb-3 space-y-2 rounded-xl border border-[var(--usha-border)] px-4 py-3 text-left text-[12px] leading-relaxed text-[var(--usha-muted)]">
      <p className="text-[var(--usha-white)]">
        {t("passTermsValidUntil", {
          date: passExpiryFrom(new Date(), selectedPass.sessionCount).toLocaleDateString(
            locale === "en" ? "en-GB" : locale === "es" ? "es-ES" : "sv-SE",
            { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Stockholm" }
          ),
        })}
      </p>
      <p>
        {t("passTermsWithdrawal")}{" "}
        <a href="/refund-policy" target="_blank" rel="noopener" className="text-[var(--usha-gold)] underline underline-offset-2">
          {t("passTermsPolicyLink")}
        </a>
      </p>
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={earlyStart}
          onChange={(e) => setEarlyStart(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--usha-gold)]"
        />
        <span>{t("passEarlyStartLabel")}</span>
      </label>
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

  async function startEpassi() {
    if (!selectedPass) return;
    setEpassiLoading(true);
    try {
      const res = await fetch("/api/passes/epassi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId: selectedPass.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(t("errorTitle"), t("errorRetry"));
        return;
      }
      setEpassiDone({ title: data.title ?? selectedPass.title, price: data.price ?? selectedPass.price });
    } catch {
      toast.error(t("errorTitle"), t("errorRetry"));
    } finally {
      setEpassiLoading(false);
    }
  }

  // Friskvårdsbidrag via Epassi — bara för klippkort som finns i Epassi.
  // Utloggade skickas till inloggningen: kortet måste höra till ett konto för
  // att kunna bekräftas och skannas.
  const epassiBlock = selectedPass?.wellness ? (
    epassiDone ? (
      <div className="mt-3 rounded-2xl border border-[var(--usha-gold)]/40 bg-[var(--usha-card)] p-4 text-sm">
        <p className="font-semibold">{t("epassiStartedTitle")}</p>
        <p className="mt-1 leading-relaxed text-[var(--usha-muted)]">
          {t("epassiStartedBody", { title: epassiDone.title, price: epassiDone.price })}
        </p>
      </div>
    ) : isLoggedIn ? (
      <button
        type="button"
        onClick={startEpassi}
        disabled={epassiLoading}
        className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--usha-border)] px-6 py-3 text-sm font-semibold transition hover:border-[var(--usha-gold)] disabled:opacity-60"
      >
        {epassiLoading ? <Loader2 size={18} className="animate-spin" /> : <HeartPulse size={18} />}
        {t("epassiButton")}
      </button>
    ) : (
      <a
        href={`/login?next=${encodeURIComponent(`${pathname}?kort=${selectedPass.id}`)}`}
        className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--usha-border)] px-6 py-3 text-sm font-semibold transition hover:border-[var(--usha-gold)]"
      >
        <HeartPulse size={18} />
        {t("epassiLoginButton")}
      </a>
    )
  ) : null;

  async function registerSwish() {
    if (!swish || swishLoading) return;
    setSwishLoading(true);
    try {
      const res = await fetch("/api/swish/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, ticketTypeId: selectedTypeId || undefined, quantity: effectiveQty, name: swishName, email: swishEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ticketUrl) {
        toast.error(t("errorTitle"), data.error === "invalidEmail" ? t("swishInvalidEmail") : typeof data.message === "string" ? data.message : t("errorRetry"));
        setSwishLoading(false);
        return;
      }
      trackEvent(ANALYTICS_EVENTS.beginCheckout, { value: total, currency: "SEK", item_id: listingId, item_category: "ticket", quantity: effectiveQty, logged_in: isLoggedIn, payment_method: "swish" });
      // Knappen förblir upptagen tills biljettsidan tagit över.
      window.location.href = data.ticketUrl;
    } catch {
      toast.error(t("errorTitle"), t("errorRetry"));
      setSwishLoading(false);
    }
  }

  // Swish som alternativ till kortet — bara på betalda kvällsbiljetter (inte
  // klippkort: de har Epassi och Stripe, och ett kort över flera kvällar är
  // inget man bekräftar i en dörr). Utan knapp när sidan inte skickat ett
  // erbjudande, dvs. tredje parts kvällar och när numret är tomt.
  const swishAvailable = !!swish && !isFree && !selectedPass;
  const swishBlock = swishAvailable ? (
    !swishOpen ? (
      <>
        {/* Swishs riktlinjer (swish.nu/marknadsmaterial/logotyp): logotypen
            får aldrig redigeras eller färgläggas om, och mot mörk bakgrund
            används varianten med vitt ordmärke på en svart platta. Därför en
            svart knapp med deras egen fil — inte en knapp i "Swish-färger". */}
      <button
        type="button"
        onClick={() => setSwishOpen(true)}
        disabled={typeSoldOut}
        aria-label={`${t("swishButton", { price: total })} Swish`}
        className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-black px-4 py-3 text-sm font-semibold text-white transition hover:border-white/40 disabled:opacity-60"
      >
        <span className="whitespace-nowrap">{t("swishButton", { price: total })}</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/payments/swish-logo-dark.png" alt="Swish" width={66} height={20} className="h-5 w-auto shrink-0" />
      </button>
      {/* Välkomstavdraget dras bara i kortkassan. Utan raden ser Swish ut
          att vara 50 kr dyrare utan förklaring. */}
      {credit > 0 && <p className="mt-1 text-center text-[11px] text-[var(--usha-muted)]">{t("swishNoCredit")}</p>}
      </>
    ) : (
      <div className="mt-3 rounded-2xl border border-[var(--usha-gold)]/40 bg-[var(--usha-card)] p-4 text-sm">
        <p className="font-semibold">{t("swishTitle", { price: total })}</p>
        <p className="mt-1 leading-relaxed text-[var(--usha-muted)]">{t("swishLead")}</p>
        <input
          type="email"
          required
          value={swishEmail}
          onChange={(e) => setSwishEmail(e.target.value)}
          placeholder={t("emailPlaceholder")}
          autoComplete="email"
          className="mt-3 w-full rounded-lg border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2 text-sm"
        />
        <input
          type="text"
          value={swishName}
          onChange={(e) => setSwishName(e.target.value)}
          placeholder={t("namePlaceholder")}
          autoComplete="name"
          className="mt-2 w-full rounded-lg border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={registerSwish}
          disabled={swishLoading || !swishEmail}
          aria-label={`${t("swishContinue")} Swish`}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-black px-4 py-3 text-sm font-bold text-white transition hover:border-white/40 disabled:opacity-60"
        >
          {swishLoading ? <Loader2 size={18} className="animate-spin" /> : <span className="whitespace-nowrap">{t("swishContinue")}</span>}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/payments/swish-logo-dark.png" alt="Swish" width={66} height={20} className="h-5 w-auto shrink-0" />
        </button>
        <p className="mt-2 text-xs leading-relaxed text-[var(--usha-muted)]">{t("swishThenLead")}</p>
        <button type="button" onClick={() => setSwishOpen(false)} className="mt-2 w-full text-center text-xs text-[var(--usha-muted)] underline underline-offset-2">
          {t("swishBack")}
        </button>
      </div>
    )
  ) : null;

  // Logged-in: existing ticket checkout (uses the account).
  if (isLoggedIn) {
    return (
      <>
        {headerBlock}
        {picker}
        {qtyStepper}
        {nameInputs}
        {attendanceOptIn}
        {passTerms}
        {creditNote}
        <button
          onClick={() => checkout("/api/stripe/ticket-checkout", { listingId: selectedPass?.id ?? listingId, ticketTypeId: selectedPass ? undefined : selectedTypeId || undefined, quantity: effectiveQty, attendeeNames, showAttendance, earlyStart: !!selectedPass && earlyStart })}
          disabled={loading || typeSoldOut}
          className={BTN}
        >
          {loading ? <Loader2 size={20} className="animate-spin" /> : <Ticket size={20} />}
          {loading ? t("booking") : label}
        </button>
        {swishBlock}
        {epassiBlock}
      </>
    );
  }

  // Kontovägen fanns inte i köpboxen alls — gästköp var inte det snabbare
  // alternativet, det var det enda som visades. Hälften av alla bokningar blev
  // gästköp, och en gäst blir aldrig en räknad deltagare. Det här är raden som
  // saknades.
  const accountPrompt = !isLoggedIn ? (
    <p className="mb-2 text-center text-[12px] text-[var(--usha-muted)]">
      {t("haveAccountPrefix")}{" "}
      <a
        href={`/login?next=${encodeURIComponent(pathname)}`}
        className="font-medium text-[var(--usha-gold)] underline underline-offset-2"
      >
        {t("haveAccountLink")}
      </a>
    </p>
  ) : null;

  // Utloggad gäst.
  //
  // För ett BETALT köp frågar vi inte längre efter mejladress och namn. Stripe
  // gör det på sin egen sida, så fälten var en dubblett — och det var den
  // dubbletten som stod mellan gästen och Apple Pay-knappen. I dörren, på en
  // telefon i dunkelt ljus, kostade den en halv minut och gav felstavningar.
  // Med plånbok fylls adressen i utan ett enda tecken.
  //
  // GRATISBILJETTER är undantaget: där finns ingen Stripe-sida som kan fråga,
  // och utan adress har biljetten ingenstans att ta vägen.
  if (!isFree) {
    return (
      <div className="space-y-2">
        {headerBlock}
        {picker}
        {qtyStepper}
        {nameInputs}
        {passTerms}
        {accountPrompt}
        <button
          type="button"
          disabled={loading || typeSoldOut}
          onClick={() =>
            checkout("/api/stripe/guest-checkout", {
              listingId: selectedPass?.id ?? listingId,
              ticketTypeId: selectedPass ? undefined : selectedTypeId || undefined,
              quantity: effectiveQty,
              attendeeNames,
              earlyStart: !!selectedPass && earlyStart,
            })
          }
          className={BTN}
        >
          {loading ? <Loader2 size={20} className="animate-spin" /> : <Ticket size={20} />}
          {loading ? t("booking") : label}
        </button>
        {swishBlock}
        {epassiBlock}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        checkout("/api/stripe/guest-checkout", { listingId: selectedPass?.id ?? listingId, email, name, ticketTypeId: selectedPass ? undefined : selectedTypeId || undefined, quantity: effectiveQty, attendeeNames });
      }}
      className="space-y-2"
    >
      {headerBlock}
      {picker}
      {accountPrompt}
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
