"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { authUrlWithNext, callbackUrlWithNext } from "@/lib/auth/next-path";
import { createClient } from "@/lib/supabase/client";
import { isPasswordPwned } from "@/lib/auth/password-strength";
import { isRateLimitError } from "@/lib/auth/rate-limit-error";
import { trackEvent } from "@/lib/analytics";
import { SIGNUP_CREDIT_ORE, SIGNUP_CREDIT_MIN_SPEND_ORE } from "@/lib/credits/signup";
import { Palette, Store, Search, ShieldCheck, Loader2, Music, User, Building2, Gift } from "lucide-react";
import { GoogleIcon, FacebookIcon } from "@/components/brand-icons";

type Role = "creator" | "venue" | "customer";
type CreatorSubcategory = "general" | "taxi_dancer";

// Only creators must verify with BankID at signup. Venues sign up normally and
// verify their company (org-nr) in the dashboard; BankID is optional for them.
const NEEDS_BANKID: Role[] = ["creator"];

function FieldError({ message }: { message: string }) {
  return <p className="mt-1 text-xs text-red-400">{message}</p>;
}

/**
 * Välkomstavdraget, sagt på registreringssidan.
 *
 * Marknadsföringen lovar 50 kr — affischer, QR-koden i projektionen — och den
 * som scannar landar här. Utan den här rutan bekräftar sidan aldrig löftet, och
 * avdraget delas ut helt tyst av triggern i handle_new_user.
 *
 * Beloppen läses från samma konstanter som regeln använder, så texten inte kan
 * påstå ett belopp och koden räkna med ett annat.
 */
function WelcomeCredit() {
  const t = useTranslations("auth");
  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-[var(--usha-gold)]/30 bg-[var(--usha-gold)]/5 px-4 py-3 text-left">
      <Gift size={18} className="mt-0.5 shrink-0 text-[var(--usha-gold)]" />
      <div>
        <p className="text-sm font-semibold text-[var(--usha-gold)]">
          {t("signupCreditTitle", { amount: SIGNUP_CREDIT_ORE / 100 })}
        </p>
        <p className="mt-0.5 text-xs text-[var(--usha-muted)]">
          {t("signupCreditNote", { minSpend: SIGNUP_CREDIT_MIN_SPEND_ORE / 100 })}
        </p>
      </div>
    </div>
  );
}

export default function SignupPage() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState<CreatorSubcategory | null>(null);
  // Creator only: sells as a private individual vs a company (unlocks org.nr steps).
  const [selectedIsCompany, setSelectedIsCompany] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const [nameError, setNameError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);

  // BankID state
  const [bankidVerified, setBankidVerified] = useState(false);
  const [bankidVerifying, setBankidVerifying] = useState(false);
  const [bankidError, setBankidError] = useState("");

  const supabase = createClient();

  const ROLES: { value: Role; label: string; description: string; icon: typeof Palette }[] = [
    { value: "creator", label: t("roleCreator"), description: t("roleCreatorDesc"), icon: Palette },
    { value: "venue", label: t("roleExperience"), description: t("roleExperienceDesc"), icon: Store },
    { value: "customer", label: t("roleCustomer"), description: t("roleCustomerDesc"), icon: Search },
  ];

  const BANKID_ERRORS: Record<string, string> = {
    failed: t("bankidFailed"),
    aborted: t("bankidAborted"),
    duplicate: t("bankidDuplicate"),
    age_restricted: t("bankidAgeRestricted"),
    error: t("bankidError"),
  };

  // Handle BankID callback from URL params
  useEffect(() => {
    const bankidStatus = searchParams.get("bankid");
    if (!bankidStatus) return;

    if (bankidStatus === "success") {
      // Fetch verified data from server
      fetch("/api/auth/bankid/verified-data")
        .then((res) => res.json())
        .then((data) => {
          if (data.error) {
            setBankidError(t("bankidDataError"));
            return;
          }
          setBankidVerified(true);
          setFullName(data.name);
          setSelectedRole(data.role as Role);
          // Restore subcategory from localStorage (only relevant for creator role)
          const savedSubcategory = localStorage.getItem("signup_subcategory");
          if (savedSubcategory && ["general", "taxi_dancer"].includes(savedSubcategory)) {
            setSelectedSubcategory(savedSubcategory as CreatorSubcategory);
          }
          const savedIsCompany = localStorage.getItem("signup_is_company");
          if (savedIsCompany === "true" || savedIsCompany === "false") {
            setSelectedIsCompany(savedIsCompany === "true");
          }
        })
        .catch(() => {
          setBankidError(t("bankidDataError"));
        });
    } else {
      setBankidError(BANKID_ERRORS[bankidStatus] || BANKID_ERRORS.error);
      // Restore role + subcategory from localStorage if available
      const savedRole = localStorage.getItem("signup_role");
      if (savedRole && ["creator", "venue"].includes(savedRole)) {
        setSelectedRole(savedRole as Role);
      }
      const savedSubcategory = localStorage.getItem("signup_subcategory");
      if (savedSubcategory && ["general", "taxi_dancer"].includes(savedSubcategory)) {
        setSelectedSubcategory(savedSubcategory as CreatorSubcategory);
      }
      const savedIsCompany = localStorage.getItem("signup_is_company");
      if (savedIsCompany === "true" || savedIsCompany === "false") {
        setSelectedIsCompany(savedIsCompany === "true");
      }
    }
  }, [searchParams]);

  function validateName(value: string) {
    if (!value.trim()) return t("nameRequired");
    if (value.trim().length < 2) return t("nameMinLength");
    return "";
  }

  function validateEmail(value: string) {
    if (!value) return t("emailRequired");
    if (!value.includes("@") || !value.includes(".")) return t("emailInvalid");
    return "";
  }

  function validatePassword(value: string) {
    if (!value) return t("passwordRequired");
    if (value.length < 8) return t("passwordMinLength");
    return "";
  }

  function inputClass(touched: boolean, hasError: boolean) {
    const base =
      "w-full rounded-xl border bg-[var(--usha-card)] px-4 py-3 text-base sm:text-sm outline-none transition min-h-[44px]";
    if (!touched) return `${base} border-[var(--usha-border)] focus:border-[var(--usha-gold)]/40`;
    if (hasError) return `${base} border-red-500/60 focus:border-red-500/80`;
    return `${base} border-green-500/40 focus:border-green-500/60`;
  }

  async function handleBankIdVerify() {
    if (!selectedRole) return;
    setBankidVerifying(true);
    setBankidError("");

    // Save role + subcategory + company choice so we can restore them after redirect
    localStorage.setItem("signup_role", selectedRole);
    if (selectedSubcategory) {
      localStorage.setItem("signup_subcategory", selectedSubcategory);
    }
    if (selectedIsCompany !== null) {
      localStorage.setItem("signup_is_company", String(selectedIsCompany));
    }

    try {
      const res = await fetch("/api/auth/bankid/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: selectedRole, subcategory: selectedSubcategory ?? "general" }),
      });
      const data = await res.json();

      if (data.error) {
        setBankidError(data.error);
        setBankidVerifying(false);
        return;
      }

      // Redirect to Signicat BankID
      window.location.href = data.authenticationUrl;
    } catch {
      setBankidError(t("bankidStartError"));
      setBankidVerifying(false);
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();

    // For BankID roles, name comes from BankID — skip name validation
    const nErr = bankidVerified ? "" : validateName(fullName);
    const eErr = validateEmail(email);
    const pErr = validatePassword(password);
    setNameError(nErr);
    setEmailError(eErr);
    setPasswordError(pErr);
    if (!bankidVerified) setNameTouched(true);
    setEmailTouched(true);
    setPasswordTouched(true);
    if (nErr || eErr || pErr) return;

    if (selectedRole && NEEDS_BANKID.includes(selectedRole) && !bankidVerified) {
      setError(t("bankidRequiredError"));
      return;
    }

    setLoading(true);
    setError("");

    // Inline leaked-password check (HIBP k-anonymity). Fails open, so it only
    // ever blocks on a confirmed breach match.
    if (await isPasswordPwned(password)) {
      setPasswordError(t("passwordCompromised"));
      setPasswordTouched(true);
      setLoading(false);
      return;
    }

    const refCode = searchParams.get("ref");
    const metadata: Record<string, string> = {
      full_name: fullName,
      role: selectedRole!,
      ...(selectedRole === "creator" && selectedSubcategory
        ? { creator_subcategory: selectedSubcategory }
        : {}),
      ...(selectedRole === "creator" && selectedIsCompany
        ? { is_company: "true" }
        : {}),
      ...(refCode ? { referred_by_code: refCode.toUpperCase() } : {}),
      // Seeds profiles.locale via handle_new_user, so the welcome mail and every
      // later receipt arrive in the language this account was created in.
      locale,
    };

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
        emailRedirectTo: `${window.location.origin}/callback`,
      },
    });

    if (error) {
      if (error.message === "User already registered" && bankidVerified) {
        // Existing account — offer to log in and upgrade with BankID
        setError("EMAIL_EXISTS_BANKID_PENDING");
        setLoading(false);
        return;
      }
      const msg = isRateLimitError(error)
        ? t("tooManyAttempts")
        : error.message === "User already registered"
          ? t("accountExists")
          : error.message;
      setError(msg);
      setLoading(false);
      return;
    }

    // BankID verification is applied server-side from the HMAC-signed
    // bankid_verified cookie issued by /api/auth/bankid/callback. For the
    // immediate-session path, call the apply route now. For the email-
    // confirmation path, /callback applies it after the user confirms.
    if (bankidVerified && data.session) {
      await fetch("/api/auth/signup/apply-verification", { method: "POST" });
    }

    if (data.session) {
      const rawNext = searchParams.get("next") || "";
      const nextPath = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/app";
      trackEvent("sign_up", { method: "email", role: selectedRole ?? "unknown" });
      window.location.href = nextPath;
      return;
    }

    setSuccess(true);
    setLoading(false);
  }

  function storeRoleForOAuth() {
    document.cookie = `pending_role=${selectedRole};path=/;max-age=600;SameSite=Lax`;
  }

  async function handleGoogleSignup() {
    if (!selectedRole) return;
    storeRoleForOAuth();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrlWithNext(window.location.origin, searchParams.get("next")),
        queryParams: { prompt: "select_account" },
      },
    });
  }

  async function handleFacebookSignup() {
    if (!selectedRole) return;
    storeRoleForOAuth();
    await supabase.auth.signInWithOAuth({
      provider: "facebook",
      options: { redirectTo: callbackUrlWithNext(window.location.origin, searchParams.get("next")) },
    });
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <div className="mb-4 text-4xl">📧</div>
          <h1 className="text-2xl font-bold">{t("checkEmail")}</h1>
          <p className="mt-2 text-sm text-[var(--usha-muted)]">
            {t("confirmationSent", { email })}
          </p>
          <a
            href="/login"
            className="mt-6 inline-block text-sm text-[var(--usha-gold)] hover:underline"
          >
            {t("backToLogin")}
          </a>
        </div>
      </div>
    );
  }

  // Step 1: Role selection
  if (!selectedRole && !bankidVerified) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--usha-gold)] to-[var(--usha-accent)]">
              <span className="text-lg font-bold text-black">U</span>
            </div>
            <h1 className="text-2xl font-bold">{t("chooseRole")}</h1>
            <p className="mt-1 text-sm text-[var(--usha-muted)]">{t("howToUse")}</p>
          </div>

          <WelcomeCredit />

          <div className="space-y-3">
            {ROLES.map((role) => (
              <button
                key={role.value}
                onClick={() => setSelectedRole(role.value)}
                className="flex w-full items-center gap-4 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-5 text-left transition hover:border-[var(--usha-gold)]/40"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[var(--usha-gold)]/10">
                  <role.icon size={24} className="text-[var(--usha-gold)]" />
                </div>
                <div>
                  <h3 className="font-semibold">{role.label}</h3>
                  <p className="text-sm text-[var(--usha-muted)]">{role.description}</p>
                </div>
              </button>
            ))}
          </div>

          <p className="mt-6 text-center text-sm text-[var(--usha-muted)]">
            {t("haveAccount")}{" "}
            <a href={authUrlWithNext("/login", searchParams.get("next"))} className="text-[var(--usha-gold)] hover:underline">
              {t("logIn")}
            </a>
          </p>
        </div>
      </div>
    );
  }

  // Step 1.25: Creator subcategory selection (only for creator role)
  if (selectedRole === "creator" && !selectedSubcategory && !bankidVerified) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--usha-gold)] to-[var(--usha-accent)]">
              <span className="text-lg font-bold text-black">U</span>
            </div>
            <h1 className="text-2xl font-bold">{t("chooseSubcategory")}</h1>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => setSelectedSubcategory("general")}
              className="flex w-full items-center gap-4 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-5 text-left transition hover:border-[var(--usha-gold)]/40"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[var(--usha-gold)]/10">
                <Palette size={24} className="text-[var(--usha-gold)]" />
              </div>
              <div>
                <h3 className="font-semibold">{t("subcategoryGeneral")}</h3>
                <p className="text-sm text-[var(--usha-muted)]">{t("subcategoryGeneralDesc")}</p>
              </div>
            </button>

            <button
              onClick={() => setSelectedSubcategory("taxi_dancer")}
              className="flex w-full items-center gap-4 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-5 text-left transition hover:border-[var(--usha-gold)]/40"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[var(--usha-gold)]/10">
                <Music size={24} className="text-[var(--usha-gold)]" />
              </div>
              <div>
                <h3 className="font-semibold">{t("subcategoryTaxiDancer")}</h3>
                <p className="text-sm text-[var(--usha-muted)]">{t("subcategoryTaxiDancerDesc")}</p>
              </div>
            </button>
          </div>

          <p className="mt-6 text-xs text-[var(--usha-muted)]">{t("subcategoryNote")}</p>

          <button
            onClick={() => {
              setSelectedRole(null);
              setSelectedSubcategory(null);
            }}
            className="mt-4 block w-full text-center text-sm text-[var(--usha-gold)] hover:underline"
          >
            {t("changeRole")}
          </button>
        </div>
      </div>
    );
  }

  // Step 1.35: Creator business type — private individual vs company (unlocks org.nr steps)
  if (selectedRole === "creator" && selectedSubcategory && selectedIsCompany === null && !bankidVerified) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--usha-gold)] to-[var(--usha-accent)]">
              <span className="text-lg font-bold text-black">U</span>
            </div>
            <h1 className="text-2xl font-bold">{t("chooseBusinessType")}</h1>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => setSelectedIsCompany(false)}
              className="flex w-full items-center gap-4 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-5 text-left transition hover:border-[var(--usha-gold)]/40"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[var(--usha-gold)]/10">
                <User size={24} className="text-[var(--usha-gold)]" />
              </div>
              <div>
                <h3 className="font-semibold">{t("businessIndividual")}</h3>
                <p className="text-sm text-[var(--usha-muted)]">{t("businessIndividualDesc")}</p>
              </div>
            </button>

            <button
              onClick={() => setSelectedIsCompany(true)}
              className="flex w-full items-center gap-4 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-5 text-left transition hover:border-[var(--usha-gold)]/40"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[var(--usha-gold)]/10">
                <Building2 size={24} className="text-[var(--usha-gold)]" />
              </div>
              <div>
                <h3 className="font-semibold">{t("businessCompany")}</h3>
                <p className="text-sm text-[var(--usha-muted)]">{t("businessCompanyDesc")}</p>
              </div>
            </button>
          </div>

          <p className="mt-6 text-xs text-[var(--usha-muted)]">{t("businessTypeNote")}</p>

          <button
            onClick={() => setSelectedSubcategory(null)}
            className="mt-4 block w-full text-center text-sm text-[var(--usha-gold)] hover:underline"
          >
            {t("back")}
          </button>
        </div>
      </div>
    );
  }

  // Step 1.5: BankID verification (only for creator/experience, before registration)
  if (selectedRole && NEEDS_BANKID.includes(selectedRole) && !bankidVerified) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--usha-gold)]/20 to-[var(--usha-accent)]/20">
              <ShieldCheck size={28} className="text-[var(--usha-gold)]" />
            </div>
            <h1 className="text-2xl font-bold">{t("verifyIdentity")}</h1>
            <p className="mt-2 text-sm text-[var(--usha-muted)]">
              {t("bankidRequired", { role: (ROLES.find((r) => r.value === selectedRole)?.label ?? "").toLowerCase() })}
            </p>
          </div>

          {bankidError && (
            <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {bankidError}
            </div>
          )}

          <button
            onClick={handleBankIdVerify}
            disabled={bankidVerifying}
            className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] py-3 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-50"
          >
            {bankidVerifying ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                {t("openingBankid")}
              </>
            ) : (
              <>
                <ShieldCheck size={18} />
                {t("verifyWithBankid")}
              </>
            )}
          </button>

          <p className="mt-3 text-center text-xs text-[var(--usha-muted)]">
            {t("bankidRedirectInfo")}
          </p>

          <button
            onClick={() => {
              setSelectedRole(null);
              setSelectedSubcategory(null);
              setBankidError("");
            }}
            className="mt-6 block w-full text-center text-xs text-[var(--usha-gold)] hover:underline"
          >
            {t("changeRole")}
          </button>

          <p className="mt-4 text-center text-sm text-[var(--usha-muted)]">
            {t("haveAccount")}{" "}
            <a href={authUrlWithNext("/login", searchParams.get("next"))} className="text-[var(--usha-gold)] hover:underline">
              {t("logIn")}
            </a>
          </p>
        </div>
      </div>
    );
  }

  // Step 2: Registration form
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--usha-gold)] to-[var(--usha-accent)]">
            <span className="text-lg font-bold text-black">U</span>
          </div>
          <h1 className="text-2xl font-bold">{t("createAccount")}</h1>
          <p className="mt-1 text-sm text-[var(--usha-muted)]">
            {t("trialPeriod", { role: ROLES.find((r) => r.value === selectedRole)?.label ?? "" })}
          </p>
          {bankidVerified && (
            <p className="mt-1 flex items-center justify-center gap-1 text-xs text-green-400">
              <ShieldCheck size={12} /> {t("identityVerified")}
            </p>
          )}
          {!bankidVerified && (
            <button
              onClick={() => {
                setSelectedRole(null);
                setSelectedSubcategory(null);
                setBankidError("");
              }}
              className="mt-1 text-xs text-[var(--usha-gold)] hover:underline"
            >
              {t("changeRole")}
            </button>
          )}
        </div>

        <WelcomeCredit />

        {/* OAuth buttons — only available after BankID for creator/experience */}
        {(!NEEDS_BANKID.includes(selectedRole!) || bankidVerified) && (
          <>
            <button
              onClick={handleGoogleSignup}
              className="mb-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-[var(--usha-border)] py-3 text-sm font-medium transition hover:bg-[var(--usha-card)]"
            >
              <GoogleIcon />
              {t("continueWithGoogle")}
            </button>

            <button
              onClick={handleFacebookSignup}
              className="mb-4 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-[var(--usha-border)] py-3 text-sm font-medium transition hover:bg-[var(--usha-card)]"
            >
              <FacebookIcon />
              {t("continueWithFacebook")}
            </button>

            <div className="mb-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-[var(--usha-border)]" />
              <span className="text-xs text-[var(--usha-muted)]">{t("or")}</span>
              <div className="h-px flex-1 bg-[var(--usha-border)]" />
            </div>
          </>
        )}

        <form onSubmit={handleSignup} className="space-y-4" noValidate>
          <div>
            <label className="mb-1.5 block text-sm text-[var(--usha-muted)]">{t("name")}</label>
            {bankidVerified ? (
              <div className="flex items-center gap-2 rounded-xl border border-green-500/30 bg-[var(--usha-card)] px-4 py-3 text-base sm:text-sm">
                <ShieldCheck size={14} className="shrink-0 text-green-400" />
                <span>{fullName}</span>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    if (nameTouched) setNameError(validateName(e.target.value));
                  }}
                  onBlur={() => {
                    setNameTouched(true);
                    setNameError(validateName(fullName));
                  }}
                  autoComplete="name"
                  className={inputClass(nameTouched, !!nameError)}
                />
                {nameTouched && nameError && <FieldError message={nameError} />}
              </>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-[var(--usha-muted)]">{t("email")}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailTouched) setEmailError(validateEmail(e.target.value));
              }}
              onBlur={() => {
                setEmailTouched(true);
                setEmailError(validateEmail(email));
              }}
              autoCapitalize="none"
              autoComplete="email"
              className={inputClass(emailTouched, !!emailError)}
            />
            {emailTouched && emailError && <FieldError message={emailError} />}
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-[var(--usha-muted)]">{t("password")}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (passwordTouched) setPasswordError(validatePassword(e.target.value));
              }}
              onBlur={() => {
                setPasswordTouched(true);
                setPasswordError(validatePassword(password));
              }}
              autoComplete="new-password"
              className={inputClass(passwordTouched, !!passwordError)}
            />
            {passwordTouched && passwordError && <FieldError message={passwordError} />}
            {passwordTouched && !passwordError && password && (
              <p className="mt-1 text-xs text-green-400">{t("passwordLooksGood")}</p>
            )}
          </div>

          {error === "EMAIL_EXISTS_BANKID_PENDING" ? (
            <div className="rounded-lg border border-[var(--usha-gold)]/30 bg-[var(--usha-gold)]/5 px-4 py-3 text-sm">
              <p className="font-semibold text-[var(--usha-gold)]">
                Det finns redan ett konto med {email}
              </p>
              <p className="mt-1 text-[var(--usha-muted)]">
                Logga in på ditt befintliga konto så aktiverar vi
                BankID-verifieringen automatiskt.
              </p>
              <a
                href={`/login?bankid_pending=1&email=${encodeURIComponent(email)}`}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] py-2.5 text-sm font-bold text-black transition hover:opacity-90"
              >
                <ShieldCheck size={14} /> Logga in och slutför verifiering
              </a>
            </div>
          ) : error ? (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-[44px] rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] py-3 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-50"
          >
            {loading ? t("creatingAccount") : t("createAccount")}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--usha-muted)]">
          {t("haveAccount")}{" "}
          <a href="/login" className="text-[var(--usha-gold)] hover:underline">
            {t("logIn")}
          </a>
        </p>
      </div>
    </div>
  );
}
