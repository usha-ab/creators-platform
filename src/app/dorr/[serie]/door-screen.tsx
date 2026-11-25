"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EntryCountsBar, type EntryCountsLabels } from "@/components/tickets/entry-counts-bar";

/**
 * Dörrskärmens yta. Medvetet ett enda mörkt tema: en platta i en dunkel bar ska
 * aldrig slå om till vitt och blända den som tittar. QR-rutan är alltid vit —
 * det är kameran som ställer det kravet.
 */

interface Ticket {
  id: string;
  name: string;
  price: number;
  /** Rad under namnet, t.ex. "81 kr per kväll" på ett klippkort. */
  sub: string | null;
  url: string;
  svg: string;
}

const RESET_SECONDS = 45;

export function DoorScreen({
  title,
  dateLabel,
  isToday,
  tickets,
  passes,
  entry = null,
}: {
  title: string | null;
  dateLabel: string | null;
  isToday: boolean;
  tickets: Ticket[];
  passes: Ticket[];
  /** Räknare och kvällens färg — bara när plattan har skanningsrätt. */
  entry?: { listingId: string; labels: EntryCountsLabels } | null;
}) {
  const [open, setOpen] = useState<Ticket | null>(null);
  const [left, setLeft] = useState(0);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [awake, setAwake] = useState(false);
  const backRef = useRef<HTMLButtonElement>(null);
  const lockRef = useRef<{ release: () => Promise<void> } | null>(null);

  const close = useCallback(() => setOpen(null), []);

  // Plattan står obevakad. Lämnas den på en QR-vy ska nästa gäst inte möta
  // föregåendes val — nedräkningen tar den hem av sig själv.
  useEffect(() => {
    if (!open) return;
    setLeft(RESET_SECONDS);
    backRef.current?.focus();
    const id = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          setOpen(null);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  // Helskärm kräver en användargest, därför en knapp. Döljs om API:et saknas.
  useEffect(() => {
    const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    setCanFullscreen(!!(root.requestFullscreen || root.webkitRequestFullscreen));
    const sync = () => {
      const d = document as Document & { webkitFullscreenElement?: Element };
      setIsFullscreen(!!(document.fullscreenElement || d.webkitFullscreenElement));
      setOpen(null);
    };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  function toggleFullscreen() {
    const d = document as Document & { webkitExitFullscreen?: () => void; webkitFullscreenElement?: Element };
    const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    try {
      if (document.fullscreenElement || d.webkitFullscreenElement) {
        (document.exitFullscreen ?? d.webkitExitFullscreen)?.call(document);
      } else {
        const r = (root.requestFullscreen ?? root.webkitRequestFullscreen)?.call(root);
        if (r && "catch" in r) (r as Promise<void>).catch(() => {});
      }
    } catch {
      // Biljetterna är det viktiga; sidan fungerar utan helskärm.
    }
  }

  // Skärmen ska inte somna. Låset släpps av webbläsaren när sidan göms och
  // måste tas om när den syns igen. Pricken visar bara ett faktiskt lås.
  useEffect(() => {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void>; addEventListener: (e: string, f: () => void) => void }> };
    };
    if (!nav.wakeLock) return;
    const take = () => {
      if (document.visibilityState !== "visible" || lockRef.current) return;
      nav.wakeLock!
        .request("screen")
        .then((l) => {
          lockRef.current = l;
          setAwake(true);
          l.addEventListener("release", () => {
            lockRef.current = null;
            setAwake(false);
          });
        })
        .catch(() => setAwake(false));
    };
    take();
    const onVis = () => (document.visibilityState === "visible" ? take() : setAwake(false));
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("fullscreenchange", take);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("fullscreenchange", take);
      lockRef.current?.release().catch(() => {});
    };
  }, []);

  return (
    <div className="dorr">
      <style>{CSS}</style>
      <div className="dorr-skarm">
        <header className="dorr-topp">
          <div className="dorr-toppror">
            <h1 className="dorr-kvall">{title ?? "Ingen kväll just nu"}</h1>
            {awake && <span className="dorr-vaken">Skärmen vaken</span>}
            {canFullscreen && (
              <button type="button" className="dorr-helskarm" onClick={toggleFullscreen}>
                {isFullscreen ? "Avsluta helskärm" : "Helskärm"}
              </button>
            )}
          </div>
          {dateLabel && (
            <div className="dorr-dagar">
              <span className="dorr-dag">{isToday ? `I kväll · ${dateLabel}` : `Nästa kväll · ${dateLabel}`}</span>
            </div>
          )}
        </header>

        {entry && isToday && <EntryCountsBar listingId={entry.listingId} labels={entry.labels} variant="door" />}

        {tickets.length > 0 ? (
          <>
            <p className="dorr-instruktion">
              Tryck på det du vill köpa. Sedan <b>skannar du koden med din telefon</b> och betalar där.
            </p>
            <div className="dorr-val">
              {tickets.map((t, i) => (
                <TicketButton key={t.id} t={t} highlight={i === 0} onOpen={setOpen} />
              ))}
              {passes.length > 0 && <p className="dorr-grupp">Klippkort – gäller alla kvällar i serien</p>}
              {passes.map((t) => (
                <TicketButton key={t.id} t={t} highlight={false} onOpen={setOpen} />
              ))}
            </div>
            <p className="dorr-fot">
              Betalning sker i din egen telefon. Biljetten hamnar direkt i mobilen — du behöver inte visa något i dörren.
            </p>
          </>
        ) : (
          <p className="dorr-instruktion">
            {title ? "Det finns inga biljetter att köpa till kvällen just nu." : "Serien har inga kommande kvällar."}
          </p>
        )}
      </div>

      {open && (
        <div className="dorr-kod" role="dialog" aria-modal="true" aria-label={open.name}>
          <h2 className="dorr-kod-namn">{open.name}</h2>
          <div className="dorr-kod-pris">
            {open.price} kr{open.sub && <span className="dorr-kod-sub"> · {open.sub}</span>}
          </div>
          <div className="dorr-papper" dangerouslySetInnerHTML={{ __html: open.svg }} />
          <p className="dorr-adress">{open.url.replace(/^https?:\/\//, "")}</p>
          <button ref={backRef} type="button" className="dorr-tillbaka" onClick={close}>
            Tillbaka
          </button>
          <p className="dorr-aterstaller">{left > 0 ? `Återgår till listan om ${left} s` : ""}</p>
        </div>
      )}
    </div>
  );
}

function TicketButton({ t, highlight, onOpen }: { t: Ticket; highlight: boolean; onOpen: (t: Ticket) => void }) {
  return (
    <button type="button" className={`dorr-biljett${highlight ? " dorr-framhavd" : ""}`} onClick={() => onOpen(t)}>
      <span className="dorr-text">
        <span className="dorr-namn">{t.name}</span>
        {t.sub && <span className="dorr-sub">{t.sub}</span>}
      </span>
      <span className="dorr-pris">
        {t.price}
        <span>KR</span>
      </span>
    </button>
  );
}

const CSS = `
.dorr {
  --ground:#0E0D10; --surface:#17151C; --surface-hi:#201D28; --line:#2E2A38;
  --gold:#D4AF37; --gold-dim:#8A7226; --text:#F4F1F6; --muted:#918B9E; --qr-paper:#FFFFFF;
  position: fixed; inset: 0; overflow-y: auto; z-index: 100;
  background: var(--ground); color: var(--text); color-scheme: dark;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased; overscroll-behavior: none;
}
.dorr * { box-sizing: border-box; }
.dorr-skarm { min-height: 100%; display: flex; flex-direction: column; max-width: 720px; margin: 0 auto;
  padding: clamp(16px,3vw,28px); padding-left: max(clamp(16px,3vw,28px), env(safe-area-inset-left,0px));
  padding-right: max(clamp(16px,3vw,28px), env(safe-area-inset-right,0px)); gap: clamp(14px,2.4vw,22px); justify-content: center; }
.dorr-topp { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; }
.dorr-toppror { display: flex; justify-content: center; }
.dorr-kvall { font-weight: 900; font-size: clamp(22px,4.4vw,34px); letter-spacing: -0.02em; line-height: 1.05; margin: 0; text-wrap: balance; }
.dorr-dagar { display: flex; justify-content: center; gap: 8px; }
.dorr-dag { display: inline-block; border: 1px solid var(--gold-dim); color: var(--gold); background: var(--surface);
  font-size: clamp(12px,2vw,14px); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; padding: 7px 16px; border-radius: 999px; }
.dorr-vaken { position: fixed; top: max(19px, env(safe-area-inset-top,0px)); left: max(16px, env(safe-area-inset-left,0px)); display: inline-flex; align-items: center; gap: 7px; color: var(--muted);
  font-size: clamp(10px,1.6vw,12px); font-weight: 500; letter-spacing: 0.04em; white-space: nowrap; }
.dorr-vaken::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--gold); }
.dorr-helskarm { position: fixed; top: max(12px, env(safe-area-inset-top,0px)); right: max(12px, env(safe-area-inset-right,0px)); background: transparent; border: 1px solid var(--line); color: var(--muted); font: inherit;
  font-size: clamp(11px,1.8vw,13px); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; padding: 7px 15px; border-radius: 999px; cursor: pointer; white-space: nowrap; }
.dorr-helskarm:hover { background: var(--surface); color: var(--text); }
.dorr-instruktion { font-size: clamp(14px,2.4vw,17px); margin: 0; text-align: center; text-wrap: balance; }
.dorr-instruktion b { color: var(--gold); font-weight: 600; }
.dorr-val { display: flex; flex-direction: column; gap: clamp(10px,1.8vw,14px); }
.dorr-grupp { margin: clamp(6px,1.2vw,10px) 0 0; font-size: clamp(11px,1.9vw,13px); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); text-align: center; }
.dorr-text { display: flex; flex-direction: column; min-width: 0; }
.dorr-sub { margin-top: 3px; font-size: clamp(12px,2.1vw,15px); color: var(--muted); font-variant-numeric: tabular-nums; }
.dorr-kod-sub { color: var(--muted); font-weight: 500; font-size: 0.7em; }
.dorr-biljett { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 16px; width: 100%; text-align: left;
  background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: clamp(16px,2.8vw,24px) clamp(18px,3vw,26px);
  color: inherit; font: inherit; cursor: pointer; transition: background 120ms ease; }
.dorr-biljett:hover, .dorr-biljett:active { background: var(--surface-hi); }
.dorr-framhavd { border-color: var(--gold-dim); }
.dorr-namn { font-weight: 700; font-size: clamp(19px,3.6vw,27px); letter-spacing: -0.01em; line-height: 1.15; min-width: 0; }
.dorr-pris { font-weight: 900; font-size: clamp(22px,4.2vw,32px); color: var(--gold); font-variant-numeric: tabular-nums; white-space: nowrap; }
.dorr-pris span { font-size: 0.5em; font-weight: 700; margin-left: 3px; letter-spacing: 0.06em; }
.dorr-fot { font-size: clamp(11px,1.9vw,13px); color: var(--muted); text-align: center; line-height: 1.5; margin: 0; }
.dorr-kod { position: fixed; inset: 0; background: var(--ground); display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: clamp(12px,2.2vw,20px); padding: clamp(16px,3vw,28px); z-index: 110; }
.dorr-kod-namn { font-weight: 900; font-size: clamp(26px,5.6vw,44px); letter-spacing: -0.02em; line-height: 1.05; margin: 0; text-align: center; text-wrap: balance; }
.dorr-kod-pris { color: var(--gold); font-weight: 700; font-size: clamp(20px,3.6vw,28px); font-variant-numeric: tabular-nums; }
.dorr-papper { background: var(--qr-paper); padding: clamp(10px,2vw,16px); border-radius: 12px; width: min(58vh, 78vw); max-width: 440px; aspect-ratio: 1; display: flex; }
.dorr-papper svg { width: 100%; height: 100%; display: block; }
.dorr-adress { font-size: clamp(11px,1.9vw,13px); color: var(--muted); margin: 0; text-align: center; word-break: break-all; max-width: 440px; }
.dorr-tillbaka { background: transparent; border: 1px solid var(--line); color: var(--text); font: inherit; font-size: clamp(15px,2.6vw,18px);
  font-weight: 500; padding: 14px 32px; border-radius: 999px; cursor: pointer; min-width: 200px; }
.dorr-tillbaka:hover { background: var(--surface); }
.dorr-aterstaller { font-size: clamp(11px,1.9vw,13px); color: var(--muted); margin: 0; min-height: 1.4em; }
.dorr button:focus-visible { outline: 3px solid var(--gold); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { .dorr * { transition: none !important; } }
`;
