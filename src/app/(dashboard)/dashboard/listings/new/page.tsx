import Link from "next/link";
import { creatorSeriesOptions } from "@/lib/passes/series-options";
import { ArrowLeft } from "lucide-react";
import { redirect } from "next/navigation";
import ListingForm from "../listing-form";
import { createListing } from "../actions";
import { getSubscriptionStatus } from "@/lib/subscription/check";
import { BETA_MODE } from "@/lib/beta";
import { createClient } from "@/lib/supabase/server";

export default async function NewListingPage() {
  // Server-side guard: redirect gratis users (skipped in beta)
  if (!BETA_MODE) {
    const { tier } = await getSubscriptionStatus();
    if (tier === "gratis") {
      redirect("/dashboard/billing");
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("creator_subcategory")
        .eq("id", user.id)
        .single()
    : { data: null };
  const creatorSubcategory = (profile as { creator_subcategory?: string | null } | null)?.creator_subcategory ?? null;

  const seriesOptions = user ? await creatorSeriesOptions(supabase, user.id) : [];

  return (
    <>
      <div className="mb-8">
        <Link
          href="/dashboard/listings"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--usha-muted)] transition-colors hover:text-[var(--usha-white)]"
        >
          <ArrowLeft size={14} />
          Tillbaka
        </Link>
        <h1 className="text-3xl font-bold">Ny tjänst</h1>
        <p className="mt-1 text-[var(--usha-muted)]">
          Skapa en ny tjänst som kunder kan hitta och boka.
        </p>
      </div>

      <div className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6 sm:p-8">
        <ListingForm action={createListing} creatorSubcategory={creatorSubcategory} seriesOptions={seriesOptions} />
      </div>
    </>
  );
}
