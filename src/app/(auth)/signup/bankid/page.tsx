"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ShieldCheck } from "lucide-react";
import { AuthBrand } from "@/components/auth-brand";
import { trackEvent } from "@/lib/analytics";

/**
 * Konto med BankID. Identiteten är redan bevisad (bankid_verified-cookien från
 * BankID-callbacken); här bevisas e-postadressen med en kod. Inget lösenord.
 * Finns redan ett konto på adressen loggas det in och BankID kopplas till det.
 */
export default function BankIdCreatePage() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const rawNext = searchParams.get("next") || "";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/app";

  const [name, setName] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [email, setEmail] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/bankid/verified-data")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setName(d.name))
      .catch(() => setExpired(true));
  }, []);

  function errorText(code: string | undefined): string {
    switch (code) {
      case "bankid_expired":
        setExpired(true);
        return t("bankidSessionExpired");
      case "code_wrong":
        return t("codeWrong");
      case "code_expired":
      case "code_missing":
        return t("codeExpired");
      case "other_bankid":
      case "duplicate":
        return t("accountOtherBankid");
      case "invalid_email":
        return t("emailInvalid");
      case "rate_limited":
        return t("tooManyAttempts");
      default:
        return t("createFailed");
    }
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (!email.includes("@") || !email.includes(".")) {
      setError(t("emailInvalid"));
      return;
    }
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/bankid/create/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, locale }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) {
      setError(errorText(data.error));
      return;
    }
    setCode("");
    setCodeSent(true);
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/bankid/create/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, marketingConsent, locale, ref: searchParams.get("ref"), next }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) {
      setBusy(false);
      setError(errorText(data.error));
      return;
    }
    if (data.created) trackEvent("sign_up", { method: "bankid" });
    window.location.href = data.next || next;
  }

  const inputClass =
    "w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-base outline-none transition focus:border-[var(--usha-gold)] sm:text-sm";
  const primaryClass =
    "flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] py-3 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-50";

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <AuthBrand />
          <h1 className="text-2xl font-bold">{t("bankidCreateTitle")}</h1>
          {name && (
            <p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-green-400">
              <ShieldCheck size={14} /> {name}
            </p>
          )}
        </div>

        {expired ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-[var(--usha-muted)]">{t("bankidSessionExpired")}</p>
            <a href={`/login${rawNext ? `?next=${encodeURIComponent(rawNext)}` : ""}`} className={primaryClass}>
              <ShieldCheck size={16} /> {t("startOverBankid")}
            </a>
          </div>
        ) : !codeSent ? (
          <form onSubmit={sendCode} className="space-y-4" noValidate>
            <p className="text-sm text-[var(--usha-muted)]">{t("bankidCreateIntro")}</p>
            <div>
              <label className="mb-1.5 block text-sm text-[var(--usha-muted)]">{t("email")}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
                className={inputClass}
              />
            </div>
            <label className="flex cursor-pointer items-start gap-3 text-left text-sm text-[var(--usha-muted)]">
              <input
                type="checkbox"
                checked={marketingConsent}
                onChange={(e) => setMarketingConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--usha-gold)]"
              />
              <span>{t("marketingConsent")}</span>
            </label>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button type="submit" disabled={busy || !name} className={primaryClass}>
              {busy ? t("sendingCode") : t("sendCode")}
            </button>
          </form>
        ) : (
          <form onSubmit={confirm} className="space-y-4" noValidate>
            <p className="text-sm text-[var(--usha-muted)]">{t("codeSentTo", { email })}</p>
            <div>
              <label className="mb-1.5 block text-sm text-[var(--usha-muted)]">{t("enterCode")}</label>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                autoFocus
                className={`${inputClass} text-center font-mono text-2xl tracking-[0.4em] sm:text-2xl`}
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button type="submit" disabled={busy || code.length !== 6} className={primaryClass}>
              {busy ? t("confirmingCode") : t("confirmCode")}
            </button>
            <div className="flex justify-between text-xs">
              <button type="button" onClick={() => sendCode()} disabled={busy} className="text-[var(--usha-gold)] hover:underline">
                {t("resendCode")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCodeSent(false);
                  setError("");
                }}
                className="text-[var(--usha-muted)] hover:underline"
              >
                {t("changeEmail")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
