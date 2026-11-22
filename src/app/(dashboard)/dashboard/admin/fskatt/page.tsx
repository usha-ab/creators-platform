import { requireAdmin } from "@/lib/admin/guard";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminNav } from "@/components/admin/admin-nav";
import { adminDestinationsFor } from "@/lib/navigation/registry";
import { Search } from "lucide-react";
import { formatOrgNumber, normalizeOrgNumber } from "@/lib/org-number";
import {
  COMPANY_FORMS,
  F_TAX_MAX_AGE_DAYS,
  payeeBlockCode,
} from "@/lib/payments/beta-gate";
import { registerFTax, removeFTax } from "./actions";

/**
 * Admin: registrera kontrollerad F-skatt och bolagsform för en mottagare.
 * Kravet gäller alla utbetalningsvägar (lib/payments/beta-gate.ts). Kontrollen
 * görs manuellt i Skatteverkets "Hämta företagsinformation"; här sparas datum
 * och källa, och varje registrering loggas i payee_f_tax_checks.
 */
interface Row {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  company_name: string | null;
  org_number: string | null;
  company_verified_at: string | null;
  company_form: string | null;
  f_tax_verified_at: string | null;
  f_tax_source: string | null;
}

const COLUMNS =
  "id, full_name, email, role, company_name, org_number, company_verified_at, company_form, f_tax_verified_at, f_tax_source";

export default async function AdminFTaxPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; updated?: string; removed?: string; error?: string }>;
}) {
  const { q, updated, removed, error } = await searchParams;
  const access = await requireAdmin("full");
  const t = await getTranslations("adminFTax");
  const admin = createAdminClient();
  const query = (q ?? "").trim();

  let profile: Row | null = null;
  let history: { action: string; checked_at: string | null; source: string | null; created_at: string }[] = [];
  if (query) {
    const org = normalizeOrgNumber(query);
    const { data } = org
      ? await admin.from("profiles").select(COLUMNS).eq("org_number", org).limit(1).maybeSingle()
      : await admin.from("profiles").select(COLUMNS).ilike("email", query).maybeSingle();
    profile = (data as Row | null) ?? null;
    if (profile) {
      const { data: h } = await admin
        .from("payee_f_tax_checks")
        .select("action, checked_at, source, created_at")
        .eq("profile_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(10);
      history = h ?? [];
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const block = profile ? payeeBlockCode(profile) : null;
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "–");
  const expires = (iso: string | null) =>
    iso ? new Date(new Date(iso).getTime() + F_TAX_MAX_AGE_DAYS * 86_400_000).toISOString().slice(0, 10) : "–";

  return (
    <>
      <AdminNav paths={adminDestinationsFor(access).map((d) => d.path)} />

      <div className="mb-8">
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-[var(--usha-muted)]">{t("intro", { days: F_TAX_MAX_AGE_DAYS })}</p>
      </div>

      {updated === "1" && (
        <div className="mb-6 rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm font-medium text-green-400">
          {t("updated")}
        </div>
      )}
      {removed === "1" && (
        <div className="mb-6 rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm font-medium text-green-400">
          {t("removed")}
        </div>
      )}
      {error && (
        <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-400">
          {t.has(`error_${error}`) ? t(`error_${error}`) : t("error_save_failed")}
        </div>
      )}

      <form method="GET" className="mb-8 flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder={t("searchPlaceholder")}
          className="w-full max-w-sm rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-2.5 text-sm outline-none focus:border-[var(--usha-gold)]/40"
        />
        <button
          type="submit"
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-5 py-2.5 text-sm font-semibold text-black transition hover:opacity-90"
        >
          <Search size={16} />
          {t("searchButton")}
        </button>
      </form>

      {query && !profile && <p className="text-sm text-[var(--usha-muted)]">{t("noMatch", { query })}</p>}

      {profile && (
        <div className="space-y-6 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6">
          <div>
            <p className="font-semibold">{profile.company_name || profile.full_name || t("noName")}</p>
            <p className="text-sm text-[var(--usha-muted)]">
              {profile.email ?? "–"} · {t("roleLabel", { role: profile.role ?? "–" })}
            </p>
          </div>

          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <dt className="text-[var(--usha-muted)]">{t("orgNumber")}</dt>
            <dd>{profile.org_number ? formatOrgNumber(profile.org_number) : "–"}</dd>
            <dt className="text-[var(--usha-muted)]">{t("vatStatus")}</dt>
            <dd>{profile.company_verified_at ? t("vatVerified", { date: day(profile.company_verified_at) }) : t("vatNone")}</dd>
            <dt className="text-[var(--usha-muted)]">{t("companyForm")}</dt>
            <dd>{profile.company_form ? t(`form_${profile.company_form}`) : "–"}</dd>
            <dt className="text-[var(--usha-muted)]">{t("fTax")}</dt>
            <dd>
              {profile.f_tax_verified_at
                ? t("fTaxChecked", { date: day(profile.f_tax_verified_at), expires: expires(profile.f_tax_verified_at) })
                : t("fTaxNone")}
            </dd>
            <dt className="text-[var(--usha-muted)]">{t("payoutStatus")}</dt>
            <dd className={block ? "text-amber-400" : "text-green-400"}>
              {block ? t(`block_${block}`) : t("payoutOk")}
            </dd>
          </dl>

          <form action={registerFTax} className="space-y-3 border-t border-[var(--usha-border)] pt-5">
            <h2 className="font-semibold">{t("registerTitle")}</h2>
            <p className="text-xs text-[var(--usha-muted)]">{t("registerHelp")}</p>
            <input type="hidden" name="userId" value={profile.id} />
            <input type="hidden" name="q" value={query} />
            <input type="hidden" name="source" value="skatteverket_manuell" />
            <label className="block text-sm">
              {t("companyForm")}
              <select
                name="companyForm"
                required
                defaultValue={profile.company_form ?? ""}
                className="mt-1 block w-full max-w-sm rounded-lg border border-[var(--usha-border)] bg-transparent px-3 py-2"
              >
                <option value="" disabled>{t("choose")}</option>
                {COMPANY_FORMS.map((f) => (
                  <option key={f} value={f}>{t(`form_${f}`)}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              {t("orgNumber")}
              <input
                name="orgNumber"
                required
                defaultValue={profile.org_number ?? ""}
                readOnly={!!profile.company_verified_at}
                className="mt-1 block w-full max-w-sm rounded-lg border border-[var(--usha-border)] bg-transparent px-3 py-2"
              />
            </label>
            {!profile.company_verified_at && (
              <label className="block text-sm">
                {t("companyName")}
                <input
                  name="companyName"
                  defaultValue={profile.company_name ?? ""}
                  className="mt-1 block w-full max-w-sm rounded-lg border border-[var(--usha-border)] bg-transparent px-3 py-2"
                />
              </label>
            )}
            <label className="block text-sm">
              {t("checkedOn")}
              <input
                type="date"
                name="checkedOn"
                required
                max={today}
                defaultValue={today}
                className="mt-1 block w-full max-w-sm rounded-lg border border-[var(--usha-border)] bg-transparent px-3 py-2"
              />
            </label>
            <p className="text-sm">
              {t("source")}: <span className="font-medium">{t("source_skatteverket_manuell")}</span>
            </p>
            <button
              type="submit"
              className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black"
            >
              {t("registerButton")}
            </button>
          </form>

          {profile.f_tax_verified_at && (
            <form action={removeFTax} className="border-t border-[var(--usha-border)] pt-5">
              <input type="hidden" name="userId" value={profile.id} />
              <input type="hidden" name="q" value={query} />
              <button
                type="submit"
                className="rounded-lg border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-400"
              >
                {t("removeButton")}
              </button>
            </form>
          )}

          {history.length > 0 && (
            <div className="border-t border-[var(--usha-border)] pt-5">
              <h2 className="mb-2 font-semibold">{t("historyTitle")}</h2>
              <ul className="space-y-1 text-xs text-[var(--usha-muted)]">
                {history.map((h, i) => (
                  <li key={i}>
                    {day(h.created_at)} · {t(`history_${h.action}`)}
                    {h.checked_at ? ` · ${t("checkedOn")} ${day(h.checked_at)}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}
