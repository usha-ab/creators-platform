"use client";

import { useState, useTransition } from "react";
import { Check, X, Loader2 } from "lucide-react";

interface Labels {
  question: string;
  explain: string;
  yes: string;
  no: string;
  active: string;
  unsubscribed: string;
  change: string;
  failed: string;
}

/**
 * "Mejla mig när nästa tillfälle läggs upp" för gästköpare.
 *
 * Samma princip som lokalens samtyckeskort: frågan ställs efter köpet, svaret
 * är ett aktivt val, och det är lika lätt att ångra som att säga ja. Ingen
 * bekräftelselänk behövs — den som är här har öppnat sin egen biljettlänk.
 */
export default function EmailFollowCard({
  bookingId,
  email,
  followedId,
  locale,
  initialState,
  labels,
}: {
  bookingId: string;
  email: string;
  followedId: string;
  locale: string;
  initialState: "none" | "pending" | "active" | "unsubscribed";
  labels: Labels;
}) {
  const [state, setState] = useState(initialState);
  const [error, setError] = useState(false);
  const [isPending, startTransition] = useTransition();

  function answer(yes: boolean) {
    setError(false);
    startTransition(async () => {
      try {
        const res = await fetch("/api/email-follows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: yes ? "subscribe" : "unsubscribe", source: "ticket", bookingId, email, followedId, locale }),
        });
        if (!res.ok) throw new Error();
        setState(yes ? "active" : "unsubscribed");
      } catch {
        setError(true);
      }
    });
  }

  const answered = state === "active" || state === "unsubscribed";

  return (
    <div className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-5">
      {!answered ? (
        <>
          <p className="text-sm font-medium">{labels.question}</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--usha-muted)]">{labels.explain}</p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => answer(true)}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-4 py-2 text-xs font-bold text-black transition hover:opacity-90 disabled:opacity-50"
            >
              {isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {labels.yes}
            </button>
            <button
              onClick={() => answer(false)}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--usha-border)] px-4 py-2 text-xs font-medium transition hover:border-[var(--usha-gold)]/40 disabled:opacity-50"
            >
              <X size={13} />
              {labels.no}
            </button>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-[var(--usha-muted)]">{state === "active" ? labels.active : labels.unsubscribed}</p>
          <button
            onClick={() => answer(state !== "active")}
            disabled={isPending}
            className="shrink-0 text-xs font-medium text-[var(--usha-gold)] underline underline-offset-2 transition hover:opacity-80 disabled:opacity-50"
          >
            {labels.change}
          </button>
        </div>
      )}
      {error && <p className="mt-3 text-xs text-red-300">{labels.failed}</p>}
    </div>
  );
}
