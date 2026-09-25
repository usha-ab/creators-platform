import { requireAdmin } from "@/lib/admin/guard";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCreatorRole } from "@/lib/roles";
import Link from "next/link";
import { AdminNav } from "@/components/admin/admin-nav";
import { adminDestinationsFor } from "@/lib/navigation/registry";
import { Search, Building2, User } from "lucide-react";
import { setCreatorIsCompany } from "./actions";

/**
 * Admin: look up a creator by email and flip their is_company flag (privatperson
 * ↔ företag) after signup. Company creators get the org.nr verification step +
 * company receipt / on_behalf_of path.
 */
export default async function AdminCreatorsPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; updated?: string; error?: string }>;
}) {
  const { email, updated, error } = await searchParams;
  const access = await requireAdmin("creators");

  const t = await getTranslations("adminCreators");
  const admin = createAdminClient();
  const query = (email ?? "").trim();
  let profile:
    | { id: string; full_name: string | null; email: string; role: string | null; is_company: boolean | null; company_verified_at: string | null }
    | null = null;
  if (query) {
    const { data } = await admin
      .from("profiles")
      .select("id, full_name, email, role, is_company, company_verified_at")
      .ilike("email", query)
      .maybeSingle();
    profile = data ?? null;
  }

  return (
    <>
      <AdminNav paths={adminDestinationsFor(access).map((d) => d.path)} />

      <div className="mb-8">
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-[var(--usha-muted)]">{t("intro")}</p>
      </div>

      {updated === "1" && (
        <div className="mb-6 rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm font-medium text-green-400">
          {t("updated")}
        </div>
      )}
      {error === "not_creator" && (
        <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-400">
          {t("errorNotCreator")}
        </div>
      )}

      {/* Search by email */}
      <form method="GET" className="mb-8 flex gap-2">
        <input
          type="email"
          name="email"
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

      {query && !profile && (
        <p className="text-sm text-[var(--usha-muted)]">{t("noMatch", { query })}</p>
      )}

      {profile && (
        <div className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6">
          <div className="mb-4">
            <p className="font-semibold">{profile.full_name || t("noName")}</p>
            <Link href={`/creators/${profile.id}`} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm text-[var(--usha-gold)] hover:underline">{t("previewProfile")}</Link>
            <p className="text-sm text-[var(--usha-muted)]">{profile.email} · {t("roleLabel", { role: profile.role ?? "–" })}</p>
          </div>

          {!isCreatorRole(profile.role) ? (
            <p className="text-sm text-[var(--usha-muted)]">{t("onlyCreators")}</p>
          ) : (
            <>
              <div className="mb-4 flex items-center gap-2 text-sm">
                <span className="text-[var(--usha-muted)]">{t("statusNow")}</span>
                {profile.is_company ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-[var(--usha-gold)]">
                    <Building2 size={14} /> {t("company")}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <User size={14} /> {t("privatePerson")}
                  </span>
                )}
                {profile.company_verified_at && (
                  <span className="text-xs text-[var(--usha-muted)]">{t("companyVerified")}</span>
                )}
              </div>

              <div className="flex gap-2">
                <form action={setCreatorIsCompany}>
                  <input type="hidden" name="userId" value={profile.id} />
                  <input type="hidden" name="isCompany" value="true" />
                  <button
                    type="submit"
                    disabled={!!profile.is_company}
                    className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-black"
                  >
                    {t("setCompany")}
                  </button>
                </form>
                <form action={setCreatorIsCompany}>
                  <input type="hidden" name="userId" value={profile.id} />
                  <input type="hidden" name="isCompany" value="false" />
                  <button
                    type="submit"
                    disabled={!profile.is_company}
                    className="rounded-lg border border-[var(--usha-border)] px-4 py-2 text-sm font-semibold disabled:opacity-40"
                  >
                    {t("setPrivatePerson")}
                  </button>
                </form>
              </div>
              {profile.is_company && profile.company_verified_at && (
                <p className="mt-3 text-xs text-[var(--usha-muted)]">{t("verifiedWarning")}</p>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
