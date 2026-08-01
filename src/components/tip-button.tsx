"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Heart, X } from "lucide-react";

const PRESETS = [50, 100, 200];
const MAX_MESSAGE = 140;

export function TipButton({
  recipientId,
  recipientName,
}: {
  recipientId: string;
  recipientName?: string | null;
}) {
  const t = useTranslations("creatorProfile.tip");
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | "">(100);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const value = typeof amount === "number" ? amount : parseInt(String(amount), 10);
    if (!value || value < 20 || value > 5000) {
      setError(t("invalidAmount"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/tip-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId, amountSek: value, message: message.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.error || t("error"));
        setLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError(t("error"));
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl border border-[var(--usha-gold)]/30 bg-[var(--usha-card)] px-4 py-2.5 text-sm font-semibold text-[var(--usha-gold)] transition hover:border-[var(--usha-gold)]/60"
      >
        <Heart size={16} />
        {t("button")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
          onClick={() => !loading && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-t-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold">{t("title")}</h3>
                <p className="mt-0.5 text-sm text-[var(--usha-muted)]">
                  {recipientName ? t("subtitleNamed", { name: recipientName }) : t("subtitle")}
                </p>
              </div>
              <button
                onClick={() => !loading && setOpen(false)}
                className="rounded-lg p-1 text-[var(--usha-muted)] transition hover:text-[var(--usha-white)]"
                aria-label={t("cancel")}
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setAmount(p)}
                  className={`rounded-xl border py-3 text-sm font-semibold transition ${
                    amount === p
                      ? "border-[var(--usha-gold)] bg-[var(--usha-gold)]/10 text-[var(--usha-gold)]"
                      : "border-[var(--usha-border)] text-[var(--usha-white)] hover:border-[var(--usha-gold)]/40"
                  }`}
                >
                  {p} kr
                </button>
              ))}
            </div>

            <div className="mt-3">
              <label className="text-xs text-[var(--usha-muted)]">{t("customLabel")}</label>
              <div className="mt-1 flex items-center gap-2 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={20}
                  max={5000}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-full bg-transparent text-sm outline-none"
                  placeholder="100"
                />
                <span className="text-sm text-[var(--usha-muted)]">kr</span>
              </div>
            </div>

            <div className="mt-3">
              <label className="text-xs text-[var(--usha-muted)]">{t("messageLabel")}</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE))}
                rows={2}
                placeholder={t("messagePlaceholder")}
                className="mt-1 w-full resize-none rounded-xl border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2 text-sm outline-none focus:border-[var(--usha-gold)]/40"
              />
              <p className="mt-1 text-right text-[10px] text-[var(--usha-muted)]">
                {message.length}/{MAX_MESSAGE}
              </p>
            </div>

            {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] py-3 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-60"
            >
              <Heart size={16} />
              {loading ? t("submitting") : t("submit")}
            </button>
            <p className="mt-2 text-center text-[11px] text-[var(--usha-muted)]">{t("disclaimer")}</p>
          </div>
        </div>
      )}
    </>
  );
}
