import { createClient } from "@/lib/supabase/server";
import { creatorSeriesOptions } from "@/lib/passes/series-options";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ScanLine, Users, Radio, BarChart3 } from "lucide-react";
import ListingForm from "../../listing-form";
import { updateListing } from "../../actions";

export default async function EditListingPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = await props.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: listing } = await supabase
    .from("listings")
    .select("id, title, description, category, price, duration_minutes, image_url, event_date, event_time, event_end_time, event_location, event_lat, event_lng, event_place_id, listing_type, session_count, pass_series_id, pass_series_ids, pass_covers, pass_reference_price")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (!listing) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("creator_subcategory")
    .eq("id", user.id)
    .single();
  const creatorSubcategory = (profile as { creator_subcategory?: string | null } | null)?.creator_subcategory ?? null;

  const updateWithId = updateListing.bind(null, listing.id);

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
        <h1 className="text-3xl font-bold">Redigera tjänst</h1>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          href="/app/scan"
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-4 py-2 text-sm font-bold text-black transition hover:opacity-90"
        >
          <ScanLine size={15} />
          Skanna biljetter
        </Link>
        <Link
          href={`/app/events/${listing.id}/crew`}
          className="inline-flex items-center gap-2 rounded-full border border-[var(--usha-border)] px-4 py-2 text-sm font-medium text-[var(--usha-white)] transition hover:border-[var(--usha-gold)]/60 hover:text-[var(--usha-gold)]"
        >
          <Users size={15} />
          Crew
        </Link>
        <Link
          href={`/app/events/${listing.id}/live`}
          className="inline-flex items-center gap-2 rounded-full border border-[var(--usha-border)] px-4 py-2 text-sm font-medium text-green-400 transition hover:border-green-400/60"
        >
          <Radio size={15} />
          Live Dashboard
        </Link>
        <Link
          href={`/app/events/${listing.id}/stats`}
          className="inline-flex items-center gap-2 rounded-full border border-[var(--usha-border)] px-4 py-2 text-sm font-medium text-[var(--usha-white)] transition hover:border-[var(--usha-gold)]/60 hover:text-[var(--usha-gold)]"
        >
          <BarChart3 size={15} />
          Statistik
        </Link>
      </div>

      <div className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6 sm:p-8">
        <ListingForm listing={listing} action={updateWithId} creatorSubcategory={creatorSubcategory} seriesOptions={seriesOptions} />
      </div>
    </>
  );
}
