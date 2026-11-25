"use client";

import { useState, useTransition } from "react";
import { Loader2, Undo2 } from "lucide-react";

export interface WithdrawalLabels {
  title: string;
  lead: string;
  open: string;
  nameLabel: string;
  emailLabel: string;
  confirmText: string;
  confirm: string;
  cancel: string;
  doneTitle: string;
  doneBody: string;
  refundStripe: string;
  refundManual: string;
  errors: Record<string, string>;
  policyLink: string;
}

/**
 * "Ångra köpet" på biljetten (2 kap. 10 a § distansavtalslagen).
 *
 * Två steg med flit: knappen öppnar formuläret, och köpet ångras först när
 * köparen bekräftat med namn och e-post. Lika lätt att nå som köpet, men inte
 * så lätt att ett felklick avslutar kortet.
 */
export default function WithdrawalCard({
  bookingId,
  locale,
  initialName,
  initialEmail,
  labels,
  done: initialDone,
}: {
  bookingId: string;
  locale: string;
  initialName: string;
  initialEmail: string;
  labels: WithdrawalLabels;
  /** Redan ångrat: visa beskedet direkt. */
  done?: { receivedAt: string; refundMethod: "stripe" | "manual" } | null;
}) {
  const [step, setStep] = useState<"idle" | "form">("idle");
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(initialDone ?? null);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/bookings/withdraw", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId, name, email, confirm: true, locale }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) {
          setError(labels.errors[json.error] ?? labels.errors.failed);
          return;
        }
        setDone({ receivedAt: json.receivedAt, refundMethod: json.refundMethod });
      } catch {
        setError(labels.errors.failed);
      }
    });
  }

  if (done) {
    const intl = locale === "en" ? "en-GB" : locale === "es" ? "es-ES" : "sv-SE";
    const when = new Date(done.receivedAt).toLocaleString(intl, {
      timeZone: "Europe/Stockholm",
      dateStyle: "long",
      timeStyle: "short",
    });
    return (
      <div id="angra" className="rounded-2xl border border-[var(--usha-gold)]/40 bg-[var(--usha-card)] p-5 text-sm">
        <p className="font-semibold">{labels.doneTitle}</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--usha-muted)]">
          {labels.doneBody.replace("{when}", when)}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-[var(--usha-muted)]">
          {done.refundMethod === "stripe" ? labels.refundStripe : labels.refundManual}
        </p>
      </div>
    );
  }

  return (
    <div id="angra" className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-5 text-sm">
      <p className="font-medium">{labels.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--usha-muted)]">{labels.lead}</p>

      {step === "idle" ? (
        <button
          type="button"
          onClick={() => setStep("form")}
          className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--usha-border)] px-4 py-2 text-xs font-semibold transition hover:border-[var(--usha-gold)]/50"
        >
          <Undo2 size={13} />
          {labels.open}
        </button>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block text-xs text-[var(--usha-muted)]">
            {labels.nameLabel}
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              className="mt-1 w-full rounded-lg border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2 text-sm text-[var(--usha-white)]"
            />
          </label>
          <label className="block text-xs text-[var(--usha-muted)]">
            {labels.emailLabel}
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="mt-1 w-full rounded-lg border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2 text-sm text-[var(--usha-white)]"
            />
          </label>
          <p className="text-xs leading-relaxed text-[var(--usha-white)]">{labels.confirmText}</p>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-4 py-2 text-xs font-bold text-black transition hover:opacity-90 disabled:opacity-50"
            >
              {isPending && <Loader2 size={13} className="animate-spin" />}
              {labels.confirm}
            </button>
            <button
              type="button"
              onClick={() => setStep("idle")}
              disabled={isPending}
              className="rounded-full border border-[var(--usha-border)] px-4 py-2 text-xs font-medium transition hover:border-[var(--usha-gold)]/40 disabled:opacity-50"
            >
              {labels.cancel}
            </button>
          </div>
        </form>
      )}
      <a href="/refund-policy" className="mt-3 block text-xs text-[var(--usha-gold)] hover:underline">
        {labels.policyLink}
      </a>
    </div>
  );
}
