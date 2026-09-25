"use client";

import { useState, useTransition } from "react";
import { Mail, Loader2, Check } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";

interface Labels {
  prompt: string;
  placeholder: string;
  button: string;
  pending: string;
  active: string;
  failed: string;
}

/**
 * Följ via e-post för den som inte har konto. Adressen bekräftas via länk i
 * mejlet (dubbel opt-in) innan något annat skickas.
 */
export function EmailFollowForm({
  followedId,
  locale,
  labels,
  className = "",
}: {
  followedId: string;
  locale: string;
  labels: Labels;
  className?: string;
}) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "pending" | "active" | "error">("idle");
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const res = await fetch("/api/email-follows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "subscribe", source: "event_page", email, followedId, locale }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error();
        setState(data.state === "active" ? "active" : "pending");
        trackEvent(ANALYTICS_EVENTS.followEmail, { creator: followedId, state: data.state ?? "pending" });
      } catch {
        setState("error");
      }
    });
  }

  if (state === "pending" || state === "active") {
    return (
      <p className={`flex items-center gap-2 text-sm text-green-400 ${className}`}>
        <Check size={14} /> {state === "active" ? labels.active : labels.pending}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className={`rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4 ${className}`}>
      <p className="text-sm font-medium">{labels.prompt}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={labels.placeholder}
          autoComplete="email"
          className="min-w-0 flex-1 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2 text-sm outline-none focus:border-[var(--usha-gold)]/50"
        />
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-60"
        >
          {isPending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
          {labels.button}
        </button>
      </div>
      {state === "error" && <p className="mt-2 text-xs text-red-300">{labels.failed}</p>}
    </form>
  );
}
