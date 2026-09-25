import { createAdminClient } from "@/lib/supabase/admin";
import { getTranslations } from "next-intl/server";
import { privatePage } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const t = await getTranslations("eventPage");
  return { title: t("unsubMetaTitle"), ...privatePage() };
}

// GDPR: a guest unsubscribes from an event waitlist via their unique token.
// Idempotent — re-visiting an already-unsubscribed token still confirms.
export default async function UnsubscribePage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  const t = await getTranslations("eventPage");
  const admin = createAdminClient();

  // Match on the token only; set unsubscribed_at if not already set.
  const { data: row } = await admin
    .from("event_waitlist")
    .select("id, unsubscribed_at")
    .eq("unsubscribe_token", token)
    .maybeSingle();

  let ok = false;
  if (row) {
    ok = true;
    if (!row.unsubscribed_at) {
      await admin
        .from("event_waitlist")
        .update({ unsubscribed_at: new Date().toISOString() })
        .eq("id", row.id);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--usha-black)] p-6 text-[var(--usha-white)]">
      <div className="max-w-md rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-8 text-center">
        {ok ? (
          <>
            <h1 className="text-xl font-bold text-[var(--usha-gold)]">{t("unsubSuccessTitle")}</h1>
            <p className="mt-3 text-sm text-[var(--usha-muted)]">
              {t("unsubSuccessBody")}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">{t("unsubInvalidTitle")}</h1>
            <p className="mt-3 text-sm text-[var(--usha-muted)]">
              {t("unsubInvalidBody")}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
