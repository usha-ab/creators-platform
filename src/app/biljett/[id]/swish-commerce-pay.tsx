"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Swish Handel på biljettsidan. Gästen trycker Betala → servern skapar en
 * betalningsförfrågan → på mobilen öppnas Swish-appen direkt, på datorn
 * visas Swishs QR-kod. Sedan frågar sidan servern varannan sekund tills
 * betalningen är klar; då laddas sidan om och QR-biljetten visas.
 *
 * Syns bara när SWISH_COMMERCE_ENABLED är på. Annars visar sidan Swish
 * Företag-rutan som förut.
 */

export interface SwishCommerceLabels {
  pay: string;
  starting: string;
  waiting: string;
  qrHint: string;
  openHere: string;
  declined: string;
  failed: string;
  retry: string;
  done: string;
}

type Phase = "idle" | "starting" | "waiting" | "declined" | "failed" | "done";

const POLL_MS = 2_000;
/** Swish ger upp efter fem och en halv minut. Lite marginal till det. */
const GIVE_UP_MS = 6.5 * 60_000;

function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function SwishCommercePay({ bookingId, labels }: { bookingId: string; labels: SwishCommerceLabels }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [appUrl, setAppUrl] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const startedAt = useRef<number>(0);

  useEffect(() => setMobile(isMobile()), []);

  const check = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch(`/api/swish/commerce/status?booking=${bookingId}`, { cache: "no-store" });
      if (!res.ok) return null;
      const j = (await res.json()) as { state?: string };
      return j.state ?? null;
    } catch {
      return null;
    }
  }, [bookingId]);

  // Kommer gästen tillbaka från Swish-appen (callbackurl) står en förfrågan
  // redan och väntar: börja fråga direkt i stället för att visa knappen.
  useEffect(() => {
    let alive = true;
    check().then((s) => {
      if (!alive) return;
      if (s === "confirmed") {
        setPhase("done");
        router.refresh();
      } else if (s === "waiting") {
        startedAt.current = Date.now();
        setPhase("waiting");
      }
    });
    return () => {
      alive = false;
    };
  }, [check, router]);

  useEffect(() => {
    if (phase !== "waiting") return;
    const id = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const s = await check();
      if (s === "confirmed") {
        setPhase("done");
        router.refresh();
      } else if (s === "declined") {
        setPhase("declined");
      } else if (s === "error" || s === "canceled") {
        setPhase("failed");
      } else if (Date.now() - startedAt.current > GIVE_UP_MS) {
        setPhase("failed");
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [phase, check, router]);

  const start = async () => {
    setPhase("starting");
    try {
      const res = await fetch("/api/swish/commerce/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId }),
      });
      const j = (await res.json().catch(() => ({}))) as { appUrl?: string; qrUrl?: string; error?: string };
      if (res.status === 409 && j.error === "alreadyPaid") {
        startedAt.current = Date.now();
        setPhase("waiting");
        return;
      }
      if (!res.ok || !j.appUrl) {
        setPhase("failed");
        return;
      }
      setAppUrl(j.appUrl);
      setQrUrl(j.qrUrl ?? null);
      startedAt.current = Date.now();
      setPhase("waiting");
      if (isMobile()) window.location.href = j.appUrl;
    } catch {
      setPhase("failed");
    }
  };

  const payButton = (label: string, onClick: () => void, disabled = false) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`${label} Swish`}
      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-black px-4 py-3 text-sm font-bold text-white transition hover:border-white/40 disabled:opacity-60"
    >
      <span className="whitespace-nowrap">{label}</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/payments/swish-logo-dark.png" alt="Swish" width={66} height={20} className="h-5 w-auto shrink-0" />
    </button>
  );

  if (phase === "done") return <p className="text-center text-xs text-[var(--usha-muted)]">{labels.done}</p>;

  if (phase === "waiting") {
    return (
      <div className="space-y-3" aria-live="polite">
        {!mobile && qrUrl && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrUrl} alt="" className="mx-auto w-full max-w-[220px] rounded-xl bg-white p-2" />
            <p className="text-center text-xs text-[var(--usha-muted)]">{labels.qrHint}</p>
          </>
        )}
        <p className="text-center text-xs font-medium text-[var(--usha-white)]">{labels.waiting}</p>
        {appUrl && (
          <p className="text-center text-xs">
            <a href={appUrl} className="text-[var(--usha-gold)] underline underline-offset-2">
              {labels.openHere}
            </a>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {phase === "declined" && <p className="text-center text-xs text-red-400">{labels.declined}</p>}
      {phase === "failed" && <p className="text-center text-xs text-red-400">{labels.failed}</p>}
      {payButton(phase === "starting" ? labels.starting : phase === "idle" ? labels.pay : labels.retry, start, phase === "starting")}
    </div>
  );
}
