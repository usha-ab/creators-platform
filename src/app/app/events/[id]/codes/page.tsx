import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { CodesManager } from "./codes-manager";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("hostEvent");
  return { title: `${t("codesTitle")} – Usha Platform` };
}

export default async function CodesPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const t = await getTranslations("hostEvent");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: listing } = await admin
    .from("listings")
    .select("id, title, slug, user_id")
    .eq("id", id)
    .maybeSingle();
  if (!listing || listing.user_id !== user.id) notFound();

  // Visa värden samma uppsättning som dörren kommer att godta: seriens stående
  // koder kopieras ner först, så en kväll som tänts igen inte ser kodlös ut.
  await admin.rpc("materialize_series_access_codes", { p_listing: id });

  const { data: codes } = await admin
    .from("event_access_codes")
    .select("id, code, label, max_uses, used_count, is_active, discount_price")
    .eq("listing_id", id)
    .order("created_at", { ascending: true });

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 text-[var(--usha-white)]">
      <Link
        href={`/event/${listing.slug ?? ""}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--usha-muted)] hover:text-[var(--usha-white)]"
      >
        <ChevronLeft className="h-4 w-4" /> {t("backToEvent")}
      </Link>

      <h1 className="text-2xl font-bold">{t("codesTitle")}</h1>
      <p className="mb-6 mt-1 text-sm text-[var(--usha-muted)]">
        {listing.title} · {t("codesDesc")}
      </p>

      <CodesManager listingId={id} codes={codes ?? []} />
    </main>
  );
}
