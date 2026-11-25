"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogIn } from "lucide-react";
import { vibrate } from "@/lib/haptics";

/**
 * "Checka in" på biljetten. Fönstret och betalningen avgörs på servern
 * (/api/tickets/self-checkin); knappen visas bara när servern sagt att
 * fönstret är öppet, men den litar inte på det — svaret är det som gäller.
 *
 * Flerbiljett: gästen bockar i vilka i sällskapet som går in nu. Alla som inte
 * redan är inne är förvalda.
 */

export interface SelfCheckinAttendee {
  id: string;
  label: string;
  checkedIn: boolean;
}

export interface SelfCheckinLabels {
  button: string;
  buttonParty: string;
  choose: string;
  working: string;
  failed: string;
  network: string;
}

export function SelfCheckinButton({
  bookingId,
  attendees,
  labels,
  onDone,
}: {
  bookingId: string;
  attendees?: SelfCheckinAttendee[];
  labels: SelfCheckinLabels;
  /** Annars laddas sidan om (server-komponenten ritar den levande biljetten). */
  onDone?: () => void;
}) {
  const router = useRouter();
  const open = (attendees ?? []).filter((a) => !a.checkedIn);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(open.map((a) => a.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const party = open.length > 1;

  async function go() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tickets/self-checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId, ...(attendees && attendees.length ? { attendeeIds: [...chosen] } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success || data.alreadyCheckedIn) {
        vibrate([50, 30, 50]);
        if (onDone) onDone();
        else router.refresh();
        return;
      }
      setError(data.error || labels.failed);
    } catch {
      setError(labels.network);
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {party && (
        <fieldset className="space-y-1.5 rounded-xl border border-[var(--usha-border)] p-3 text-sm">
          <legend className="px-1 text-xs text-[var(--usha-muted)]">{labels.choose}</legend>
          {open.map((a) => (
            <label key={a.id} className="flex items-center gap-2">
              <input type="checkbox" checked={chosen.has(a.id)} onChange={() => toggle(a.id)} className="h-4 w-4 accent-green-600" />
              <span>{a.label}</span>
            </label>
          ))}
        </fieldset>
      )}
      <button
        type="button"
        onClick={go}
        disabled={busy || (party && chosen.size === 0)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-green-600 px-4 py-4 text-lg font-bold text-white transition hover:bg-green-500 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
        {busy ? labels.working : party ? labels.buttonParty.replace("{n}", String(chosen.size)) : labels.button}
      </button>
      {error && <p className="text-center text-sm text-red-400" role="alert">{error}</p>}
    </div>
  );
}
