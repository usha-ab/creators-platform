import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { unsubscribeEmailFollowByToken } from "@/lib/follows/email-follow";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("emailFollow");
  return { title: t("metaUnsub"), robots: { index: false, follow: false } };
}

/** Avslutalänken från varje mejl. Idempotent, ingen inloggning. */
export default async function UnsubscribeFollowPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const t = await getTranslations("emailFollow");
  const row = /^[0-9a-f-]{36}$/i.test(token) ? await unsubscribeEmailFollowByToken(createAdminClient(), token) : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--usha-black)] p-6 text-[var(--usha-white)]">
      <div className="max-w-md rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-8 text-center">
        {row ? (
          <>
            <h1 className="text-xl font-bold text-[var(--usha-gold)]">{t("unsubTitle")}</h1>
            <p className="mt-3 text-sm text-[var(--usha-muted)]">{t("unsubBody")}</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">{t("unsubInvalidTitle")}</h1>
            <p className="mt-3 text-sm text-[var(--usha-muted)]">{t("unsubInvalidBody")}</p>
          </>
        )}
      </div>
    </main>
  );
}
