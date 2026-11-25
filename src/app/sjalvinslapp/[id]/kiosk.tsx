"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Camera, CheckCircle2, XCircle, AlertCircle, Loader2, ScanLine } from "lucide-react";
import { vibrate } from "@/lib/haptics";
import { EntryCountsBar, type EntryCountsLabels } from "@/components/tickets/entry-counts-bar";

/**
 * Självinsläppet: plattan i dörren skannar gästens biljett med frontkameran.
 *
 * Tre lägen. STARTSKÄRMEN förklarar vad som händer i tre steg och har en
 * enda knapp — kameran, helskärmen och den vakna skärmen kräver alla ett
 * tryck, så det trycket får bära all förberedelse. IGÅNG visar kameran stort
 * och köp-QR:n mindre bredvid (stående skärm: under). RESULTATET lägger sig
 * över allt: grönt Välkommen, gult Redan incheckad, rött Fel kväll — stort
 * nog att läsas från kön — och försvinner av sig själv.
 *
 * Första versionen låg under /app och i en fast ruta som inte gick att
 * skrolla: på en telefon hamnade kameran under flikraden och gick inte att
 * nå. Nu ligger sidan utanför appen och skrollar som vilken sida som helst.
 *
 * Samma kontroll som skannern i appen: /api/tickets/verify och
 * /api/tickets/checkin, båda bakom inloggning med skanningsrätt.
 */

export interface KioskStrings {
  title: string; startLead: string; startStep1: string; startStep2: string; startStep3: string;
  start: string; starting: string; exit: string;
  buyTitle: string; buyHint: string; priceSuffix: string; noTicketTypes: string;
  showTitle: string; showHint: string; cameraBlocked: string; cameraFailed: string; retry: string;
  welcome: string; wrongDate: string; wrongDateDetail: string; alreadyUsed: string; checkInTime: string;
  canceled: string; pending: string; invalid: string; askCrew: string; seats: string; passRemaining: string;
  noPermission: string; onlyOwnEvents: string; couldNotVerify: string; checkInFailed: string; network: string;
  lockedTitle: string; lockedBody: string; upgrade: string; swapSide: string;
  fullscreen: string; exitFullscreen: string; fullscreenDenied: string;
}

interface TicketType { id: string; name: string; price: number }

interface VerifyResult {
  valid: boolean;
  status: string;
  bookingId: string;
  attendeeId?: string | null;
  ticket: { title: string; date: string; ticketType?: string | null; holder?: string | null; seats?: number };
}

type Shown =
  | { kind: "ok"; ticketType: string | null; holder: string | null; seats: number; passRemaining: number | null }
  | { kind: "already"; ticketType: string | null; holder: string | null; time: string | null }
  | { kind: "wrong_date"; date: string }
  | { kind: "no"; status: string }
  | { kind: "error"; message: string };

const SHOW_OK_MS = 4000;
const SHOW_FAIL_MS = 7000;
/** Samma kod inom den här tiden ignoreras — gästen håller kvar telefonen. */
const SAME_CODE_MS = 15000;
const KEEPALIVE_MS = 10 * 60 * 1000;

const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));

export function Kiosk({ id, ticketTypeId, s, counts }: { id: string; ticketTypeId: string | null; s: KioskStrings; counts: EntryCountsLabels }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [ticketType, setTicketType] = useState<TicketType | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  // Efterköpsfönstret avgörs på servern (entry-rutten); QR:n får då flaggan
  // precis som på entrésidan, annars stängs köpet vid midnatt.
  const [efterkop, setEfterkop] = useState(false);
  const [phase, setPhase] = useState<"start" | "running">("start");
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  // Liggande läge på en telefon: frontkameran sitter i ena kortänden, och
  // skanningsrutan ska ligga närmast den. Vilken sida avgörs av hur telefonen
  // vreds (landscape-primary brukar lägga kameran till vänster), med en knapp
  // att byta om gissningen är fel. Valet minns per enhet.
  const [cameraSide, setCameraSide] = useState<"left" | "right">("left");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("kiosk-camera-side");
      if (saved === "left" || saved === "right") {
        setCameraSide(saved);
        return;
      }
    } catch {
      // ingen lagring — gissa
    }
    const type = (screen.orientation?.type ?? "") as string;
    if (type === "landscape-secondary") setCameraSide("right");
  }, []);
  function swapSide() {
    const next = cameraSide === "left" ? "right" : "left";
    setCameraSide(next);
    try {
      localStorage.setItem("kiosk-camera-side", next);
    } catch {
      // ignorerat
    }
  }

  const scannerRef = useRef<any>(null);
  const busyRef = useRef(false);
  const lastRef = useRef<{ code: string; at: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  // Helskärm går att slå på och av med en egen knapp. Begäran vid start
  // nekas tyst i vissa webbläsare, och Androids bakåtgest tar plattan ur
  // helskärm — då ska den gå att få tillbaka utan att starta om kameran.
  // Knappen döljs om webbläsaren saknar API:et.
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Nekar webbläsaren ska det synas, med skälet — annars ser det ut som att
  // knappen är trasig. Skälet ("TypeError: Permissions check failed" o.d.)
  // är det enda sättet att felsöka en platta vi inte har i handen.
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  useEffect(() => {
    const doc = document as Document & { webkitFullscreenElement?: Element | null };
    const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    setCanFullscreen(!!(root.requestFullscreen || root.webkitRequestFullscreen));
    const sync = () => setIsFullscreen(!!(document.fullscreenElement || doc.webkitFullscreenElement));
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  function toggleFullscreen() {
    const doc = document as Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
    const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    setFullscreenError(null);
    const fail = (e: unknown) => {
      const err = e as { name?: string; message?: string } | null;
      setFullscreenError([err?.name, err?.message].filter(Boolean).join(": ") || String(e));
    };
    try {
      if (document.fullscreenElement || doc.webkitFullscreenElement) {
        if (document.exitFullscreen) document.exitFullscreen().catch(fail);
        else doc.webkitExitFullscreen?.();
      } else if (root.requestFullscreen) {
        root.requestFullscreen({ navigationUI: "hide" }).catch(fail);
      } else {
        root.webkitRequestFullscreen?.();
      }
    } catch (e) {
      fail(e);
    }
    void requestWakeLock();
  }

  useEffect(() => {
    let active = true;
    fetch(`/api/events/${id}/entry`)
      .then(async (res) => {
        if (res.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(`/sjalvinslapp/${id}`)}`);
          return null;
        }
        if (!res.ok) throw new Error(res.status === 403 ? "noPermission" : "loadError");
        return res.json();
      })
      .then((data) => {
        if (!active || !data) return;
        setTitle(data.listing.title);
        if (data.kiosk && !data.kiosk.allowed) setLocked(true);
        setEfterkop(!!data.efterkop?.oppet);
        const types: TicketType[] = data.ticketTypes ?? [];
        setTicketType(types.find((x) => x.id === ticketTypeId) ?? types[0] ?? null);
      })
      .catch((e: Error) => active && setLoadError(e.message === "noPermission" ? s.noPermission : s.network));
    return () => {
      active = false;
    };
  }, [id, ticketTypeId, router, s.noPermission, s.network]);

  // Håll inloggningen vid liv under kvällen.
  useEffect(() => {
    const timer = setInterval(() => fetch("/api/tickets/can-scan").catch(() => {}), KEEPALIVE_MS);
    return () => clearInterval(timer);
  }, []);

  const requestWakeLock = useCallback(async () => {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
      if (nav.wakeLock && !wakeLockRef.current) wakeLockRef.current = await nav.wakeLock.request("screen");
    } catch {
      // ingen rättighet eller inget stöd — plattan får ställas in för hand
    }
  }, []);

  useEffect(() => {
    const onVisible = () => {
      wakeLockRef.current = null;
      if (document.visibilityState === "visible" && phase === "running") requestWakeLock();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [phase, requestWakeLock]);

  useEffect(() => {
    return () => {
      if (scannerRef.current) scannerRef.current.stop().catch(() => {});
      if (hideTimer.current) clearTimeout(hideTimer.current);
      wakeLockRef.current?.release().catch(() => {});
    };
  }, []);

  function show(result: Shown) {
    setShown(result);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setShown(null);
      busyRef.current = false;
      try {
        scannerRef.current?.resume();
      } catch {
        // kameran kan ha tappats — nästa Starta tar om den
      }
    }, result.kind === "ok" ? SHOW_OK_MS : SHOW_FAIL_MS);
  }

  async function handleDecoded(text: string) {
    if (busyRef.current) return;
    const urlMatch = text.match(/code=(USH-[A-Fa-f0-9]{8})/i);
    const direct = text.match(/^USH-([A-Fa-f0-9]{8})$/i);
    const code = (urlMatch?.[1] ?? (direct ? text : null))?.toUpperCase();
    if (!code) return; // någon annans QR-kod — vänta på rätt
    const att = text.match(/[?&]att=([0-9a-f-]{36})/i)?.[1];

    const now = Date.now();
    if (lastRef.current && lastRef.current.code === code && now - lastRef.current.at < SAME_CODE_MS) return;
    lastRef.current = { code, at: now };

    busyRef.current = true;
    try {
      scannerRef.current?.pause(true);
    } catch {
      // ignorerat
    }
    vibrate();

    try {
      const id8 = code.slice(4);
      const res = await fetch(`/api/tickets/verify?code=${encodeURIComponent(code)}&id=${id8}${att ? `&att=${att}` : ""}`);
      const data: VerifyResult & { error?: string } = await res.json();
      if (!res.ok) {
        show({ kind: "error", message: res.status === 403 ? s.onlyOwnEvents : data.error || s.couldNotVerify });
        return;
      }
      if (!data.valid) {
        if (data.status === "wrong_date") show({ kind: "wrong_date", date: data.ticket.date });
        else if (data.status === "already_used")
          show({ kind: "already", ticketType: data.ticket.ticketType ?? null, holder: data.ticket.holder ?? null, time: null });
        else show({ kind: "no", status: data.status });
        return;
      }

      const ci = await fetch("/api/tickets/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: data.bookingId, attendeeId: data.attendeeId ?? undefined }),
      });
      const done = await ci.json();
      if (done.success) {
        vibrate([50, 30, 50]);
        show({
          kind: "ok",
          ticketType: data.ticket.ticketType ?? null,
          holder: data.ticket.holder ?? null,
          seats: data.ticket.seats ?? 1,
          passRemaining: done.passRemaining ?? null,
        });
      } else if (done.alreadyCheckedIn) {
        show({
          kind: "already",
          ticketType: data.ticket.ticketType ?? null,
          holder: data.ticket.holder ?? null,
          time: done.checkedInAt
            ? new Date(done.checkedInAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })
            : null,
        });
      } else {
        show({ kind: "error", message: done.error || s.checkInFailed });
      }
    } catch {
      show({ kind: "error", message: s.network });
    }
  }

  async function start() {
    if (cameraStarting) return;
    setCameraStarting(true);
    setCameraError(null);
    // Helskärm och vaken skärm hör till ett kioskläge; båda får nekas utan
    // att något annat påverkas. Måste ske i samma tryck som kameran startar.
    document.documentElement.requestFullscreen?.().catch(() => {});
    await requestWakeLock();
    setPhase("running");
    try {
      if (scannerRef.current) {
        await scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
      const { Html5Qrcode } = await import("html5-qrcode");
      // Webbläsarens egen QR-läsare (BarcodeDetector) när den finns — den
      // tål frontkamerans spegling och svagt ljus bättre än JS-avkodaren.
      const scanner = new Html5Qrcode("kiosk-reader", { useBarCodeDetectorIfSupported: true, verbose: false });
      scannerRef.current = scanner;
      const config = {
        fps: 10,
        qrbox: (w: number, h: number) => {
          const side = Math.round(Math.min(w, h) * 0.75);
          return { width: side, height: side };
        },
      };
      const onScan = (text: string) => void handleDecoded(text);
      const noop = () => {};
      try {
        await scanner.start({ facingMode: "user" }, config, onScan, noop);
      } catch (e1) {
        if (/NotAllowed|Permission|denied/i.test(String(e1))) throw e1;
        await scanner.start({ facingMode: "environment" }, config, onScan, noop);
      }
    } catch (err) {
      scannerRef.current = null;
      setCameraError(/NotAllowed|Permission|denied/i.test(String(err)) ? s.cameraBlocked : s.cameraFailed);
    } finally {
      setCameraStarting(false);
    }
  }

  const tone = shown?.kind === "ok" ? "bg-green-600" : shown?.kind === "already" ? "bg-yellow-500" : shown ? "bg-red-600" : "";

  // ---- Fel / låst -------------------------------------------------------
  if (loadError || locked) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-black p-8 text-center text-white">
        {locked ? (
          <>
            <p className="text-3xl font-bold">{s.lockedTitle}</p>
            <p className="max-w-md text-lg text-white/70">{s.lockedBody}</p>
            <Link href="/dashboard/billing" className="mt-2 rounded-xl bg-white px-6 py-3 text-base font-semibold text-black">
              {s.upgrade}
            </Link>
          </>
        ) : (
          <p className="text-xl">{loadError}</p>
        )}
        <Link href="/app/dorr" className="mt-4 inline-flex items-center gap-1 text-sm text-white/60">
          <ArrowLeft size={14} /> {s.exit}
        </Link>
      </div>
    );
  }

  // ---- Startskärm -------------------------------------------------------
  if (phase === "start") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-black px-6 py-10 text-white">
        <ScanLine size={48} className="mb-4 text-[var(--usha-gold)]" />
        <h1 className="text-center text-4xl font-black">{s.title}</h1>
        {title && <p className="mt-2 text-center text-lg text-white/60">{title}</p>}
        <p className="mt-6 max-w-md text-center text-lg text-white/80">{s.startLead}</p>
        <ol className="mt-6 w-full max-w-md space-y-3 text-lg">
          {[s.startStep1, s.startStep2, s.startStep3].map((step, i) => (
            <li key={i} className="flex gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <span className="font-black text-[var(--usha-gold)]">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <button
          onClick={start}
          disabled={cameraStarting || !title}
          className="mt-8 flex w-full max-w-md items-center justify-center gap-3 rounded-2xl bg-[var(--usha-gold)] px-8 py-5 text-2xl font-bold text-black disabled:opacity-60"
        >
          {cameraStarting || !title ? <Loader2 size={28} className="animate-spin" /> : <Camera size={28} />}
          {cameraStarting ? s.starting : s.start}
        </button>
        <Link href="/app/dorr" className="mt-6 inline-flex items-center gap-1 text-sm text-white/50">
          <ArrowLeft size={14} /> {s.exit}
        </Link>
      </div>
    );
  }

  // ---- Igång -------------------------------------------------------------
  return (
    <div className="flex min-h-dvh flex-col bg-black text-white landscape:h-dvh landscape:overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs text-white/50">
        <Link href="/app/dorr" className="inline-flex shrink-0 items-center gap-1 hover:text-white">
          <ArrowLeft size={14} /> {s.exit}
        </Link>
        <span className="min-w-0 truncate">{title}</span>
        <div className="flex shrink-0 items-center gap-2">
        {canFullscreen && (
          <button onClick={toggleFullscreen} className="shrink-0 rounded-full border border-white/20 px-2.5 py-1 hover:text-white">
            {isFullscreen ? s.exitFullscreen : s.fullscreen}
          </button>
        )}
        <button onClick={swapSide} className="hidden shrink-0 rounded-full border border-white/20 px-2.5 py-1 hover:text-white landscape:inline-block">
          {s.swapSide}
        </button>
        </div>
      </div>
      {/* Kvällens färg och räknaren: samma färg som på gästernas levande
          biljetter, så att den som står bredvid ser att de hör till i kväll. */}
      <div className="px-4 pb-2 landscape:px-3 landscape:pb-1">
        <EntryCountsBar listingId={id} labels={counts} />
      </div>
      {fullscreenError && (
        <p className="px-4 pb-2 text-xs text-yellow-300">
          {s.fullscreenDenied} <span className="text-white/40">({fullscreenError})</span>
        </p>
      )}

      {/* Liggande: två kolumner som ryms på skärmen utan skroll, skanningen närmast kameran. */}
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-4 p-4 landscape:min-h-0 landscape:flex-1 landscape:grid-cols-2 landscape:gap-3 landscape:p-3 lg:landscape:grid-cols-[3fr_2fr]">
        {/* Visa biljett — det viktigaste, därför först och störst. */}
        <section
          className="flex min-h-0 flex-col items-center rounded-2xl border border-white/10 bg-white/5 p-5 text-center landscape:p-3"
          style={{ order: cameraSide === "right" ? 2 : 1 }}
        >
          <h2 className="text-3xl font-bold text-[var(--usha-gold)] landscape:text-xl">{s.showTitle}</h2>
          <p className="mt-1 text-lg text-white/60 landscape:mt-0 landscape:text-sm">{s.showHint}</p>
          {/* Kvadraten får aldrig bli högre än skärmen: på en telefon i liggande
              läge var den 560 px hög på en 412 px skärm och syntes inte hel. */}
          <div className="relative mt-4 w-full max-w-[min(560px,70dvh)] overflow-hidden rounded-xl bg-black landscape:mt-2 landscape:max-w-[min(560px,calc(100dvh-130px))]" style={{ aspectRatio: "1 / 1" }}>
            <div id="kiosk-reader" className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />
            {/* Pulserande guldram: visar att rutan är aktiv och var biljetten ska hållas. */}
            {!cameraStarting && !cameraError && (
              <div className="pointer-events-none absolute inset-0 animate-pulse rounded-xl border-4 border-[var(--usha-gold)]/70" />
            )}
            {cameraStarting && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                <Loader2 size={40} className="animate-spin" />
              </div>
            )}
            {cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-6">
                <p className="text-lg text-red-300">{cameraError}</p>
                <button onClick={start} className="rounded-xl bg-white px-5 py-3 text-base font-semibold text-black">
                  {s.retry}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Köp */}
        <section
          className="flex min-h-0 flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-5 text-center landscape:p-3"
          style={{ order: cameraSide === "right" ? 1 : 2 }}
        >
          <h2 className="text-2xl font-bold text-[var(--usha-gold)] landscape:text-xl">{s.buyTitle}</h2>
          <p className="mt-1 text-base text-white/60 landscape:mt-0 landscape:text-sm">{s.buyHint}</p>
          {ticketType ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/events/${id}/entry/qr?tt=${encodeURIComponent(ticketType.id)}${efterkop ? "&efterkop=1" : ""}`}
                alt=""
                className="mt-4 w-full max-w-[260px] rounded-xl bg-white p-3 landscape:mt-2 landscape:max-w-[min(260px,calc(100dvh-190px))]"
              />
              <p className="mt-3 text-lg font-semibold landscape:mt-1 landscape:text-base">
                {ticketType.name} · {ticketType.price} {s.priceSuffix}
              </p>
            </>
          ) : (
            <p className="mt-4 text-white/60">{s.noTicketTypes}</p>
          )}
        </section>
      </div>

      {/* Resultatet täcker hela skärmen — det ska synas från två meter. */}
      {shown && (
        <div className={`fixed inset-0 z-[100] flex flex-col items-center justify-center p-8 text-center text-white ${tone}`} aria-live="assertive">
          {shown.kind === "ok" && (
            <>
              <CheckCircle2 size={120} />
              <p className="mt-4 text-6xl font-black">{s.welcome}</p>
              {shown.ticketType && <p className="mt-4 text-4xl font-bold">{shown.ticketType}</p>}
              {(shown.holder || shown.seats > 1) && (
                <p className="mt-2 text-2xl">
                  {shown.holder}
                  {shown.seats > 1 && ` · ${fill(s.seats, { n: shown.seats })}`}
                </p>
              )}
              {shown.passRemaining != null && <p className="mt-2 text-xl">{fill(s.passRemaining, { n: shown.passRemaining })}</p>}
            </>
          )}
          {shown.kind === "already" && (
            <>
              <AlertCircle size={120} />
              <p className="mt-4 text-5xl font-black">{s.alreadyUsed}</p>
              {shown.ticketType && <p className="mt-4 text-3xl font-bold">{shown.ticketType}</p>}
              {shown.holder && <p className="mt-2 text-2xl">{shown.holder}</p>}
              {shown.time && <p className="mt-2 text-xl">{fill(s.checkInTime, { time: shown.time })}</p>}
              <p className="mt-4 text-lg opacity-80">{s.askCrew}</p>
            </>
          )}
          {shown.kind === "wrong_date" && (
            <>
              <XCircle size={120} />
              <p className="mt-4 text-5xl font-black">{s.wrongDate}</p>
              <p className="mt-4 text-2xl">{fill(s.wrongDateDetail, { date: shown.date })}</p>
              <p className="mt-4 text-lg opacity-80">{s.askCrew}</p>
            </>
          )}
          {shown.kind === "no" && (
            <>
              <XCircle size={120} />
              <p className="mt-4 text-5xl font-black">
                {shown.status === "canceled" ? s.canceled : shown.status === "pending" ? s.pending : s.invalid}
              </p>
              <p className="mt-4 text-lg opacity-80">{s.askCrew}</p>
            </>
          )}
          {shown.kind === "error" && (
            <>
              <XCircle size={120} />
              <p className="mt-4 text-3xl font-bold">{shown.message}</p>
              <p className="mt-4 text-lg opacity-80">{s.askCrew}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
