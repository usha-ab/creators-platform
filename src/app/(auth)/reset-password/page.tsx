"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { isPasswordPwned } from "@/lib/auth/password-strength";

export default function ResetPasswordPage() {
  const t = useTranslations("resetPassword");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [checking, setChecking] = useState(true);
  /** Kod från Ushas eget återställningsmejl. Används först när man sparar. */
  const [tokenHash, setTokenHash] = useState<string | null>(null);

  useEffect(() => {
    // An expired or already-consumed recovery link (e.g. burned by an email
    // link-scanner) redirects here with the error in the URL hash/query instead
    // of a session. Detect that explicitly, and always clear `checking`, so we
    // show the "request a new link" card instead of a permanent blank page.
    const hashParams = new URLSearchParams(
      typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : ""
    );
    const queryParams = new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : ""
    );
    if (hashParams.get("error") || queryParams.get("error")) {
      setHasSession(false);
      setChecking(false);
      return;
    }

    // Länken från Ushas eget mejl bär koden i adressen. Den verifieras inte
    // här — en länkskanner som öppnar sidan ska inte kunna förbruka den — utan
    // först när det nya lösenordet sparas.
    const hash = queryParams.get("token_hash");
    if (hash && queryParams.get("type") === "recovery") {
      setTokenHash(hash);
      setHasSession(true);
      setChecking(false);
      return;
    }

    const supabase = createClient();
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => setHasSession(!!session))
      .catch(() => setHasSession(false))
      .finally(() => setChecking(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError(t("errorPasswordTooShort"));
      return;
    }
    if (password !== confirm) {
      setError(t("errorPasswordMismatch"));
      return;
    }

    setLoading(true);

    // Inline leaked-password check (HIBP k-anonymity). Fails open.
    if (await isPasswordPwned(password)) {
      setError(t("errorPasswordPwned"));
      setLoading(false);
      return;
    }

    const supabase = createClient();
    if (tokenHash) {
      // Servern löser in länken och markerar adressen som bevisad.
      const res = await fetch("/api/auth/recovery-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token_hash: tokenHash }),
      }).catch(() => null);
      if (!res?.ok) {
        // Utgången eller redan använd: visa "begär ny länk".
        setHasSession(false);
        setLoading(false);
        return;
      }
    }
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
    } else {
      setDone(true);
    }
    setLoading(false);
  }

  if (checking) {
    return null;
  }

  if (!hasSession) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-6">
            <p className="font-semibold text-red-400">
              {t("invalidLink")}
            </p>
          </div>
          <a
            href="/forgot-password"
            className="mt-4 inline-block rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-6 py-3 text-sm font-bold text-black transition hover:opacity-90"
          >
            {t("requestNewLink")}
          </a>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-6">
            <p className="font-semibold text-green-400">
              {t("successHeading")}
            </p>
            <p className="mt-2 text-sm text-[var(--usha-muted)]">
              {t("successBody")}
            </p>
          </div>
          <a
            href="/login"
            className="mt-4 inline-block rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-6 py-3 text-sm font-bold text-black transition hover:opacity-90"
          >
            {t("goToLogin")}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">{t("heading")}</h1>
          <p className="mt-1 text-sm text-[var(--usha-muted)]">
            {t("subheading")}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm text-[var(--usha-muted)]">
              {t("newPasswordLabel")}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              placeholder={t("newPasswordPlaceholder")}
              autoComplete="new-password"
              className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-[var(--usha-muted)]">
              {t("confirmPasswordLabel")}
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              placeholder={t("confirmPasswordPlaceholder")}
              autoComplete="new-password"
              className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] py-3 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-50"
          >
            {loading ? t("submitting") : t("submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
