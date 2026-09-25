import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { confirmEmailFollowByToken } from "@/lib/follows/email-follow";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("emailFollow");
  return { title: t("metaConfirm"), robots: { index: false, follow: false } };
}

/** Bekräftelselänken från mejlet. Idempotent. */
export default async function ConfirmFollowPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const t = await getTranslations("emailFollow");
  const admin = createAdminClient();
  const row = /^[0-9a-f-]{36}$/i.test(token) ? await confirmEmailFollowByToken(admin, token) : null;
  const { data: target } = row
    ? await admin.from("profiles").select("full_name, slug, id").eq("id", row.followed_id).maybeSingle()
    : { data: null };
  const name = target?.full_name || "Usha";

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--usha-black)] p-6 text-[var(--usha-white)]">
      <div className="max-w-md rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-8 text-center">
        {row ? (
          <>
            <h1 className="text-xl font-bold text-[var(--usha-gold)]">{t("confirmTitle", { name })}</h1>
            <p className="mt-3 text-sm text-[var(--usha-muted)]">{t("confirmBody")}</p>
            {target && (
              <Link
                href={`/creators/${target.slug || target.id}`}
                className="mt-6 inline-block rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-5 py-2.5 text-sm font-semibold text-black"
              >
                {t("toProfile", { name })}
              </Link>
            )}
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">{t("confirmInvalidTitle")}</h1>
            <p className="mt-3 text-sm text-[var(--usha-muted)]">{t("confirmInvalidBody")}</p>
          </>
        )}
      </div>
    </main>
  );
}
