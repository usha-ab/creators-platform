"use client";

import { useEffect, useState } from "react";

/**
 * Räknaren och kvällens färg i dörren (kiosken och dörrskärmen).
 *
 * Hämtar /api/events/[id]/entry/counts var 10:e sekund. Färgen är samma som
 * på gästernas levande biljetter — den som står i dörren jämför dem. Svarar
 * servern 401/403 (ingen skanningsrätt på den här enheten) visas ingenting.
 */

export const ENTRY_COUNTS_POLL_MS = 10_000;

export interface EntryCountsLabels {
  sold: string;
  checkedIn: string;
  waiting: string;
  colorLabel: string;
  colors: Record<string, string>;
}

interface CountsResponse {
  sold: number;
  checkedIn: number;
  notArrived: number;
  color: { bg: string; fg: string; key: string } | null;
}

export function EntryCountsBar({
  listingId,
  labels,
  variant = "kiosk",
}: {
  listingId: string;
  labels: EntryCountsLabels;
  variant?: "kiosk" | "door";
}) {
  const [data, setData] = useState<CountsResponse | null>(null);

  useEffect(() => {
    let active = true;
    let stopped = false;
    const load = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/events/${listingId}/entry/counts`, { cache: "no-store" });
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          stopped = true;
          return;
        }
        if (!res.ok) return;
        const json = (await res.json()) as CountsResponse;
        if (active) setData(json);
      } catch {
        // nätet hackar — nästa varv försöker igen
      }
    };
    load();
    const id = setInterval(load, ENTRY_COUNTS_POLL_MS);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      active = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [listingId]);

  if (!data) return null;
  const door = variant === "door";

  return (
    <div className={`flex w-full flex-wrap items-stretch gap-2 ${door ? "justify-center" : ""}`}>
      {data.color && (
        <div
          className="flex min-w-[8rem] flex-1 flex-col items-center justify-center rounded-xl px-3 py-2 text-center"
          style={{ backgroundColor: data.color.bg, color: data.color.fg }}
        >
          <span className="text-[10px] font-semibold uppercase tracking-widest opacity-80">{labels.colorLabel}</span>
          <span className="text-lg font-black uppercase tracking-wide">{labels.colors[data.color.key] ?? data.color.key}</span>
        </div>
      )}
      {[
        { label: labels.sold, value: data.sold },
        { label: labels.checkedIn, value: data.checkedIn },
        { label: labels.waiting, value: data.notArrived },
      ].map((c) => (
        <div key={c.label} className="flex min-w-[5.5rem] flex-1 flex-col items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-center">
          <span className="text-2xl font-black tabular-nums">{c.value}</span>
          <span className="text-[11px] uppercase tracking-wider text-white/60">{c.label}</span>
        </div>
      ))}
    </div>
  );
}
