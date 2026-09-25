"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Calendar, MapPin, Clock, QrCode, X, Ticket, User, CheckCircle2, Maximize2, ScanLine } from "lucide-react";
import { useToast } from "@/components/ui/toaster";
import { useSubscription } from "@/lib/subscription/context";
import { trackEvent, trackPurchase } from "@/lib/analytics";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import Image from "next/image";
import QRCode from "qrcode";
import { ShareEventButton } from "@/components/share-event-button";

interface TicketData {
  id: string;
  listingId: string;
  code: string;
  title: string;
  date: string;
  time: string;
  location: string;
  status: "active" | "used" | "upcoming";
  type: string;
  amountPaid: number | null;
  bookingType: string;
  imageUrl: string | null;
  creatorName: string | null;
  creatorAvatar: string | null;
  /** Confirmed but unpaid priced booking the customer can still pay in-app. */
  payable: boolean;
  price: number | null;
  /** Ticket has been scanned/checked in at the door. */
  checkedIn: boolean;
  checkedInAt: string | null;
}

interface BookingData {
  id: string;
  listing_id?: string;
  scheduled_at: string;
  status: string;
  notes: string | null;
  amount_paid: number | null;
  stripe_payment_id?: string | null;
  is_free?: boolean | null;
  booking_type: string | null;
  ticket_type_name?: string | null;
  checked_in_at?: string | null;
  guest_count?: number | null;
  listings: {
    title: string;
    category: string;
    price?: number | null;
    listing_type?: string | null;
    image_url?: string | null;
    event_date?: string | null;
    event_time?: string | null;
    event_location?: string | null;
  } | null;
  creator: {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
  } | null;
}

interface TicketsContentProps {
  bookings: BookingData[];
  appleWallet?: boolean;
  googleWallet?: boolean;
  /** Host (creator/venue) → show the "Scan tickets" entry point here. */
  canScan?: boolean;
}

/** Host-only link into the door scanner, surfaced from the Tickets page. */
function ScanTicketsButton() {
  const t = useTranslations("myTickets");
  return (
    <a
      href="/app/scan"
      className="flex items-center justify-center gap-2 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm font-semibold transition hover:border-[var(--usha-gold)]/40"
    >
      <ScanLine size={16} className="text-[var(--usha-gold)]" />
      {t("scanTickets")}
    </a>
  );
}

/** Shared QR renderer — used both inline on the card and large in the modal. */
function TicketQR({ ticket, size }: { ticket: TicketData; size: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const url = `${window.location.origin}/api/tickets/verify?code=${ticket.code}&id=${ticket.id}`;
    QRCode.toDataURL(url, {
      width: size * 2, // 2× for crisp rendering when scaled up on-screen
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
      errorCorrectionLevel: "Q", // survives glare/angle better than M at the door
    })
      .then(setDataUrl)
      .catch(() => setFailed(true));
  }, [ticket.code, ticket.id, size]);

  if (failed) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 text-center" style={{ width: size, height: size }}>
        <QrCode size={Math.min(48, size / 4)} className="text-gray-400" />
        <p className="text-xs text-gray-500">{ticket.code}</p>
      </div>
    );
  }
  if (!dataUrl) {
    return (
      <div className="flex items-center justify-center" style={{ width: size, height: size }}>
        <QrCode size={Math.min(48, size / 4)} className="animate-pulse text-gray-300" />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={dataUrl} alt={`QR ${ticket.code}`} width={size} height={size} />;
}

function bookingToTicket(
  booking: BookingData,
  fallbackLabel: string
): TicketData {
  const scheduledDate = new Date(booking.scheduled_at);
  const now = new Date();
  const isPast = scheduledDate < now;
  const isCompleted = booking.status === "completed" || booking.status === "canceled";

  let status: "active" | "used" | "upcoming";
  if (isCompleted || isPast) {
    status = "used";
  } else {
    const hoursUntil = (scheduledDate.getTime() - now.getTime()) / (1000 * 60 * 60);
    status = hoursUntil <= 24 ? "active" : "upcoming";
  }

  const listing = booking.listings;
  let displayDate: string;
  let displayTime: string;

  if (listing?.event_date) {
    displayDate = new Date(listing.event_date + "T00:00").toLocaleDateString("sv-SE", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } else {
    displayDate = scheduledDate.toLocaleDateString("sv-SE", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  if (listing?.event_time) {
    displayTime = listing.event_time.slice(0, 5);
  } else {
    displayTime = scheduledDate.toLocaleTimeString("sv-SE", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const displayLocation = listing?.event_location || booking.notes || "-";

  // A paid service/B2B booking that the creator confirmed but the customer
  // hasn't paid yet → let them pay in-app (booking-pay).
  const isPaid =
    booking.stripe_payment_id != null ||
    (booking.amount_paid != null && booking.amount_paid > 0);
  const listingType = listing?.listing_type ?? null;
  const price = listing?.price ?? null;
  const payable =
    booking.status === "confirmed" &&
    !isPaid &&
    !booking.is_free && // creator waived payment (e.g. a free intro)
    (price ?? 0) > 0 &&
    (listingType === "service" || listingType === "b2b_offering");

  return {
    id: booking.id,
    listingId: booking.listing_id || "",
    code: `USH-${booking.id.slice(0, 8).toUpperCase()}`,
    payable,
    price,
    checkedIn: !!booking.checked_in_at,
    checkedInAt: booking.checked_in_at ?? null,
    title: listing?.title
      ? booking.ticket_type_name
        ? `${listing.title} · ${booking.ticket_type_name}`
        : listing.title
      : fallbackLabel,
    date: displayDate,
    time: displayTime,
    location: displayLocation,
    status,
    type: listing?.category || fallbackLabel,
    amountPaid: booking.amount_paid,
    bookingType: booking.booking_type || "manual",
    imageUrl: listing?.image_url || null,
    creatorName: booking.creator?.full_name || null,
    creatorAvatar: booking.creator?.avatar_url || null,
  };
}

export function TicketsContent({ bookings, appleWallet, googleWallet, canScan }: TicketsContentProps) {
  const [selectedTicket, setSelectedTicket] = useState<TicketData | null>(null);
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const t = useTranslations("myTickets");

  const tickets = bookings.map((b) => bookingToTicket(b, t("bookingFallback")));
  const activeTickets = tickets.filter(
    (t) => t.status === "active" || t.status === "upcoming"
  );
  const usedTickets = tickets.filter((t) => t.status === "used");

  useEffect(() => {
    if (searchParams.get("success") === "true") {
      toast.success(t("toastPurchasedTitle"), t("toastPurchasedBody"));
      // Köpet rapporteras från bokningen som faktiskt skapades, inte från
      // adressen: beloppet blir det betalda och transaction_id blir bokningens
      // id, så en omladdning av sidan inte räknas som ett andra köp.
      const senaste = [...bookings].sort(
        (a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime()
      )[0];
      if (senaste) {
        trackPurchase({
          transaction_id: senaste.id,
          value: (senaste.amount_paid ?? 0) / 100,
          currency: "SEK",
          items: [
            {
              item_id: senaste.listing_id ?? senaste.id,
              item_name: senaste.listings?.title ?? t("bookingFallback"),
              item_category: senaste.listings?.listing_type === "package" ? "pass" : "ticket",
              price: (senaste.amount_paid ?? 0) / 100,
              quantity: senaste.guest_count ?? 1,
            },
          ],
        });
        if (senaste.listings?.listing_type === "package") {
          trackEvent(ANALYTICS_EVENTS.passPurchase, { listing: senaste.listing_id ?? "" });
        }
      }
      window.history.replaceState({}, "", "/app/tickets");
    }
    // Deep-link straight to a ticket's QR (e.g. after purchase): /app/tickets?show=<id>
    const show = searchParams.get("show");
    if (show) {
      const t = tickets.find((x) => x.id === show);
      if (t) setSelectedTicket(t);
      window.history.replaceState({}, "", "/app/tickets");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, toast]);

  if (tickets.length === 0) {
    return (
      <div className="px-4 py-6 space-y-8">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        {canScan && <ScanTicketsButton />}
        <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] py-16">
          <Ticket size={40} className="mb-4 text-[var(--usha-muted)]" />
          <p className="text-base font-medium text-[var(--usha-muted)]">
            {t("emptyTitle")}
          </p>
          <p className="mt-1 text-sm text-[var(--usha-muted)]">
            {t("emptyBody")}
          </p>
          <a
            href="/marketplace"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-6 py-2.5 text-sm font-bold text-black transition hover:opacity-90"
          >
            {t("exploreExperiences")}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <span className="rounded-full bg-[var(--usha-gold)]/10 px-3 py-1 text-xs font-medium text-[var(--usha-gold)]">
          {tickets.length === 1
            ? t("countSingular", { count: tickets.length })
            : t("countPlural", { count: tickets.length })}
        </span>
      </div>

      {canScan && <ScanTicketsButton />}

      {/* Active Tickets */}
      {activeTickets.length > 0 && (
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--usha-muted)]">
            {t("activeTicketsHeading")}
          </h2>
          <div className="space-y-4 md:grid md:grid-cols-2 md:gap-4 md:space-y-0">
            {activeTickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                inlineQr={!ticket.checkedIn}
                onShowQR={() => setSelectedTicket(ticket)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Used Tickets */}
      {usedTickets.length > 0 && (
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--usha-muted)]">
            {t("usedTicketsHeading")}
          </h2>
          <div className="space-y-4 md:grid md:grid-cols-2 md:gap-4 md:space-y-0">
            {usedTickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                used
                onShowQR={() => setSelectedTicket(ticket)}
              />
            ))}
          </div>
        </section>
      )}

      {/* QR Code Modal */}
      {selectedTicket && (
        <QRModal
          ticket={selectedTicket}
          appleWallet={appleWallet}
          googleWallet={googleWallet}
          onClose={() => setSelectedTicket(null)}
        />
      )}
    </div>
  );
}

function TicketCard({
  ticket,
  onShowQR,
  used = false,
  inlineQr = false,
}: {
  ticket: TicketData;
  onShowQR?: () => void;
  used?: boolean;
  inlineQr?: boolean;
}) {
  const { tier } = useSubscription();
  const { toast } = useToast();
  const t = useTranslations("myTickets");
  const [paying, setPaying] = useState(false);
  const tierBadge = tier === "premium" ? { label: t("tierVip"), className: "bg-purple-500/90 text-white" }
    : tier === "guld" ? { label: t("tierGold"), className: "bg-[var(--usha-gold)]/90 text-black" }
    : null;

  async function handlePay() {
    setPaying(true);
    try {
      const res = await fetch("/api/stripe/booking-pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: ticket.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(t("payErrorTitle"), data.error);
        setPaying(false);
        return;
      }
      if (data.url) window.location.href = data.url;
      else setPaying(false);
    } catch {
      toast.error(t("errorTitle"), t("payStartError"));
      setPaying(false);
    }
  }

  return (
    <div className={`overflow-hidden rounded-xl border ${tierBadge ? "border-[var(--usha-gold)]/30" : "border-[var(--usha-border)]"} bg-[var(--usha-card)] ${used && !ticket.payable ? "opacity-60" : ""}`}>
      {/* Event image */}
      {ticket.imageUrl && (
        <div className="relative h-32 w-full">
          <Image
            src={ticket.imageUrl}
            alt={ticket.title}
            fill
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--usha-card)] to-transparent" />
          <span
            className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
              ticket.status === "active"
                ? "bg-green-500/90 text-white"
                : ticket.status === "upcoming"
                  ? "bg-blue-500/90 text-white"
                  : "bg-black/60 text-white/80"
            }`}
          >
            {ticket.status === "active"
              ? t("statusActive")
              : ticket.status === "upcoming"
                ? t("statusUpcoming")
                : t("statusUsed")}
          </span>
        </div>
      )}

      {/* Ticket info */}
      <div className="p-4">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="font-semibold">{ticket.title}</h3>
            <span className="mt-1 inline-block rounded-full bg-[var(--usha-gold)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--usha-gold)]">
              {ticket.type}
            </span>
          </div>
          {!ticket.imageUrl && (
            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                ticket.status === "active"
                  ? "bg-green-500/20 text-green-400"
                  : ticket.status === "upcoming"
                    ? "bg-blue-500/20 text-blue-400"
                    : "bg-[var(--usha-muted)]/20 text-[var(--usha-muted)]"
              }`}
            >
              {ticket.status === "active"
                ? t("statusActive")
                : ticket.status === "upcoming"
                  ? t("statusUpcoming")
                  : t("statusUsed")}
            </span>
          )}
        </div>

        {/* Creator info */}
        {ticket.creatorName && (
          <div className="mb-3 flex items-center gap-2">
            {ticket.creatorAvatar ? (
              <Image
                src={ticket.creatorAvatar}
                alt={ticket.creatorName}
                width={20}
                height={20}
                className="rounded-full object-cover"
              />
            ) : (
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--usha-border)]">
                <User size={10} className="text-[var(--usha-muted)]" />
              </div>
            )}
            <span className="text-xs text-[var(--usha-muted)]">{ticket.creatorName}</span>
          </div>
        )}

        <div className="space-y-1.5 text-xs text-[var(--usha-muted)]">
          <div className="flex items-center gap-2">
            <Calendar size={12} />
            <span>{ticket.date}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock size={12} />
            <span>{ticket.time}</span>
          </div>
          {ticket.location !== "-" && (
            <div className="flex items-center gap-2">
              <MapPin size={12} />
              <span>{ticket.location}</span>
            </div>
          )}
        </div>

        {/* Check-in status — makes door control obvious at a glance */}
        {ticket.checkedIn && (
          <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-green-500/10 px-3 py-2 text-xs font-semibold text-green-500">
            <CheckCircle2 size={14} />
            {ticket.checkedInAt
              ? t("checkedInAt", {
                  time: new Date(ticket.checkedInAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }),
                })
              : t("checkedIn")}
          </div>
        )}

        {/* Unpaid, confirmed booking → pay directly here */}
        {ticket.payable && (
          <div className="mt-4">
            <button
              onClick={handlePay}
              disabled={paying}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-4 py-2.5 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-50"
            >
              {paying ? t("openingPayment") : t("payPrice", { price: ticket.price ?? 0 })}
            </button>
            <p className="mt-1.5 text-center text-[11px] text-[var(--usha-muted)]">
              {t("unpaidNotice")}
            </p>
          </div>
        )}
      </div>

      {/* Ticket divider (perforated line effect) */}
      <div className="relative flex items-center">
        <div className="absolute -left-3 h-6 w-6 rounded-full bg-[var(--usha-black)]" />
        <div className="flex-1 border-t border-dashed border-[var(--usha-border)]" />
        <div className="absolute -right-3 h-6 w-6 rounded-full bg-[var(--usha-black)]" />
      </div>

      {/* Ticket bottom */}
      {inlineQr && onShowQR ? (
        /* Active ticket: show the scannable QR right on the card — tap to enlarge
           to a bright full-screen view for the door. Zero extra taps to see it. */
        <button
          onClick={onShowQR}
          className="flex w-full flex-col items-center gap-2 p-4 transition-opacity hover:opacity-90"
          aria-label={t("enlargeQr")}
        >
          <div className="rounded-xl border-2 border-[var(--usha-gold)]/30 bg-white p-3">
            <TicketQR ticket={ticket} size={150} />
          </div>
          <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--usha-gold)]">
            <Maximize2 size={13} /> {t("tapToEnlarge")}
          </span>
          <p className="font-mono text-[11px] text-[var(--usha-muted)]">{ticket.code}</p>
        </button>
      ) : (
        <div className="flex items-center justify-between p-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-mono text-xs text-[var(--usha-muted)]">
                {ticket.code}
              </p>
              {tierBadge && !used && (
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${tierBadge.className}`}>
                  {tierBadge.label}
                </span>
              )}
            </div>
            {ticket.amountPaid != null && ticket.bookingType === "ticket" && (
              <p className="mt-0.5 text-xs font-semibold text-[var(--usha-gold)]">
                {t("paidAmount", { amount: (ticket.amountPaid / 100).toFixed(0) })}
              </p>
            )}
          </div>
          {onShowQR && (
            <button
              onClick={onShowQR}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-3 py-2 text-xs font-semibold text-black transition-opacity hover:opacity-90"
            >
              <QrCode size={14} />
              {t("showQr")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function QRModal({
  ticket,
  appleWallet,
  googleWallet,
  onClose,
}: {
  ticket: TicketData;
  appleWallet?: boolean;
  googleWallet?: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("myTickets");
  const tc = useTranslations("common");
  const panelRef = useRef<HTMLDivElement>(null);

  // Move focus into the dialog on open so keyboard/screen-reader users land
  // inside it. QRModal only mounts when open, so mount-time focus is correct.
  // The labeled X button remains the way out (no Escape/backdrop close — see below).
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Keep the screen awake (and thus at the user's brightness) while the QR is up
  // at the door — a screen that dims mid-scan is the classic e-ticket frustration.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> };
    };
    nav.wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => {});
    return () => { lock?.release().catch(() => {}); };
  }, []);

  const checkedIn = ticket.checkedIn;
  const walletQ = `id=${ticket.id}`;

  // Bright, near-white full-screen surface: maximises reflected light so the QR
  // scans fast even on a dim phone. NOTE: no backdrop click-to-close — at the
  // door an accidental tap must not dismiss the ticket; only the X closes it.
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
      tabIndex={-1}
      className="fixed inset-0 z-[100] flex flex-col items-center overflow-y-auto bg-white px-5 py-6 text-gray-900 outline-none"
    >
      <div className="flex w-full max-w-sm items-center justify-between">
        <h3 id="qr-modal-title" className="text-base font-bold text-gray-900">{t("yourTicket")}</h3>
        <button
          onClick={onClose}
          className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
          aria-label={t("close")}
        >
          <X size={20} />
        </button>
      </div>

      {/* Status banner — instant read for door control */}
      <div
        className={`mt-4 flex w-full max-w-sm items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${
          checkedIn ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-800"
        }`}
      >
        {checkedIn ? (
          <>
            <CheckCircle2 size={16} />
            {ticket.checkedInAt
              ? t("checkedInAt", {
                  time: new Date(ticket.checkedInAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }),
                })
              : t("checkedIn")}
          </>
        ) : (
          <>{t("validShowAtEntrance")}</>
        )}
      </div>

      {/* Big QR */}
      <div className="mt-6 rounded-2xl border-2 border-gray-200 bg-white p-4">
        <div className={checkedIn ? "opacity-30" : ""}>
          <TicketQR ticket={ticket} size={280} />
        </div>
      </div>

      {/* Ticket info */}
      <div className="mt-5 w-full max-w-sm text-center">
        <h4 className="text-lg font-bold text-gray-900">{ticket.title}</h4>
        {ticket.creatorName && (
          <p className="mt-0.5 text-sm text-gray-500">{t("byCreator", { name: ticket.creatorName })}</p>
        )}
        <p className="mt-1 text-sm text-gray-600">{ticket.date} · {ticket.time}</p>
        {ticket.location !== "-" && (
          <p className="mt-0.5 text-sm text-gray-600">{ticket.location}</p>
        )}
        <p className="mt-3 font-mono text-xs tracking-wider text-gray-400">{ticket.code}</p>
      </div>

      {/* Wallet passes — skip once checked in (no longer needed at the door) */}
      {!checkedIn && (appleWallet || googleWallet) && (
        <div className="mt-5 flex w-full max-w-sm flex-col gap-2">
          {appleWallet && (
            <a
              href={`/api/tickets/wallet?${walletQ}&provider=apple`}
              className="flex items-center justify-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
            >
              {t("addToAppleWallet")}
            </a>
          )}
          {googleWallet && (
            <a
              href={`/api/tickets/wallet?${walletQ}&provider=google`}
              className="flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-900 transition hover:bg-gray-50"
            >
              {t("saveToGoogleWallet")}
            </a>
          )}
        </div>
      )}

      {ticket.listingId && (
        <div className="mt-4 w-full max-w-sm">
          <ShareEventButton
            url={`${typeof window !== "undefined" ? window.location.origin : "https://usha.se"}/event/${ticket.listingId}`}
            title={ticket.title}
            text={t("shareText", { title: ticket.title })}
            label={t("inviteFriends")}
            copiedLabel={tc("linkCopied")}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          />
        </div>
      )}
    </div>
  );
}
