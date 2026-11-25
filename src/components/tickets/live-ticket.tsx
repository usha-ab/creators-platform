"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";

/**
 * Den levande biljetten: det gästen visar i dörren efter självincheckningen.
 *
 * Tre saker gör den svår att förfalska med en skärmdump:
 *  - den rör sig (ett ljussvep och en pulserande ring — en bild står still),
 *  - klockan tickar med sekunder,
 *  - kvällens färg, som räknas fram på servern med en hemlighet och är
 *    densamma på kiosken och dörrskärmen. Förra veckans skärmdump har fel färg.
 * Saknas färgen (ingen hemlighet satt) visas biljetten utan färgband.
 */

export interface LiveTicketProps {
  checkedInAt: string;
  title: string;
  dateLabel: string;
  holder: string | null;
  color: { bg: string; fg: string; name: string } | null;
  /** Rad under rubriken, t.ex. "2 av 3 incheckade". */
  note?: string | null;
  labels: { title: string; hint: string; now: string; colorLabel: string };
}

function clock(d: Date, seconds: boolean): string {
  return d.toLocaleTimeString("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
    timeZone: "Europe/Stockholm",
  });
}

export function LiveTicket({ checkedInAt, title, dateLabel, holder, color, note, labels }: LiveTicketProps) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const at = clock(new Date(checkedInAt), false);

  return (
    <div className="live-ticket relative overflow-hidden rounded-2xl bg-green-600 p-5 text-center text-white" role="status" aria-live="polite">
      <style>{CSS}</style>
      <div className="live-ticket-sweep pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative flex flex-col items-center gap-2">
        <span className="live-ticket-ring flex h-16 w-16 items-center justify-center rounded-full bg-white/15">
          <CheckCircle2 className="h-10 w-10" />
        </span>
        <p className="text-2xl font-black tracking-tight">{labels.title.replace("{time}", at)}</p>
        {note && <p className="text-sm font-medium text-white/90">{note}</p>}
        <p className="text-lg font-semibold">{title}</p>
        <p className="text-sm capitalize text-white/90">{dateLabel}</p>
        {holder && <p className="text-base font-medium">{holder}</p>}
        <p className="mt-1 font-mono text-3xl font-bold tabular-nums" aria-label={labels.now}>
          {now ? clock(now, true) : " "}
        </p>
        {color && (
          <div
            className="mt-2 w-full rounded-xl px-4 py-3 text-base font-bold uppercase tracking-wider"
            style={{ backgroundColor: color.bg, color: color.fg }}
          >
            {labels.colorLabel}: {color.name}
          </div>
        )}
        <p className="mt-1 text-xs text-white/85">{labels.hint}</p>
      </div>
    </div>
  );
}

const CSS = `
@keyframes live-ticket-sweep { 0% { transform: translateX(-120%) skewX(-20deg); } 100% { transform: translateX(220%) skewX(-20deg); } }
@keyframes live-ticket-ring { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0.55); } 50% { box-shadow: 0 0 0 14px rgba(255,255,255,0); } }
.live-ticket-sweep::before { content: ""; position: absolute; top: 0; bottom: 0; width: 45%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.28), transparent);
  animation: live-ticket-sweep 2.4s linear infinite; }
.live-ticket-ring { animation: live-ticket-ring 1.6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .live-ticket-sweep::before { animation-duration: 6s; }
  .live-ticket-ring { animation-duration: 4s; }
}
`;
