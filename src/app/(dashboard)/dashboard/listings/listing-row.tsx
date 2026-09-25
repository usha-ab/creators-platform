"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { deleteListing, toggleListingActive, duplicateListing, moveListing } from "./actions";
import { useToast } from "@/components/ui/toaster";
import Link from "next/link";
import { ArrowDown, ArrowUp, Calendar, Clock, Copy, Crown, MapPin, Pencil, Trash2 } from "lucide-react";
import { CATEGORY_LABELS } from "@/lib/categories";
import { SocialShareButton } from "@/components/social-share-button";
import { eventShareUrl } from "@/lib/events/share";

export interface Listing {
  id: string;
  title: string;
  description: string | null;
  category: string;
  price: number | null;
  duration_minutes: number | null;
  is_active: boolean;
  release_to_gold_at?: string | null;
  event_date?: string | null;
  event_time?: string | null;
  event_location?: string | null;
  event_venue?: string | null;
  series_id?: string | null;
  series_slug?: string | null;
  slug?: string | null;
  user_id?: string;
  created_at: string;
}

export default function ListingRow({
  listing,
  kanFlyttaUpp = false,
  kanFlyttaNer = false,
}: {
  listing: Listing;
  kanFlyttaUpp?: boolean;
  kanFlyttaNer?: boolean;
}) {
  const { toast } = useToast();
  const t = useTranslations("listingsPage");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleDuplicate() {
    startTransition(async () => {
      const result = await duplicateListing(listing.id);
      if (result?.error || !result?.id) {
        toast.error(t("toastDuplicateError"), result?.error);
      } else {
        toast.success(t("toastDuplicated"));
        router.push(`/dashboard/listings/${result.id}/edit`);
      }
    });
  }

  function handleToggle() {
    startTransition(async () => {
      const result = await toggleListingActive(listing.id, !listing.is_active);
      if (result.error) {
        toast.error(t("toastToggleError"), result.error);
      } else {
        toast.success(listing.is_active ? t("toastDeactivated") : t("toastActivated"));
      }
    });
  }

  function handleDelete() {
    if (!confirm(t("confirmDelete"))) return;
    startTransition(async () => {
      const result = await deleteListing(listing.id);
      if (result.error) {
        toast.error(t("toastDeleteError"), result.error);
      } else {
        toast.success(t("toastDeleteSuccess"));
      }
    });
  }

  function handleEarlyBird() {
    if (!confirm(t("confirmEarlyBird"))) return;
    startTransition(async () => {
      try {
        const res = await fetch("/api/listings/early-bird", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingId: listing.id }),
        });
        const data = await res.json();
        if (data.success) {
          toast.success(t("toastEarlyBirdSuccess"));
        } else {
          toast.error(t("toastEarlyBirdError"), data.error);
        }
      } catch {
        toast.error(t("toastGenericError"));
      }
    });
  }

  function handleMove(riktning: "upp" | "ner") {
    startTransition(async () => {
      const result = await moveListing(listing.id, riktning);
      if (result && "error" in result && result.error) toast.error(result.error);
      else router.refresh();
    });
  }

  const hasEarlyBird = listing.release_to_gold_at && new Date(listing.release_to_gold_at) > new Date();

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border p-5 transition-colors sm:flex-row sm:items-center sm:justify-between ${
        listing.is_active
          ? "border-[var(--usha-border)] bg-[var(--usha-card)]"
          : "border-[var(--usha-border)] bg-[var(--usha-card)] opacity-60"
      } ${isPending ? "pointer-events-none opacity-50" : ""}`}
    >
      <Link href={`/listing/${listing.id}`} className="min-w-0 flex-1 transition hover:opacity-80">
        <div className="mb-1 flex items-center gap-3">
          <h3 className="truncate font-semibold">{listing.title}</h3>
          <span className="shrink-0 rounded-full border border-[var(--usha-border)] px-2.5 py-0.5 text-xs text-[var(--usha-muted)]">
            {CATEGORY_LABELS[listing.category] || listing.category}
          </span>
          {!listing.is_active && (
            <span className="shrink-0 rounded-full bg-[var(--usha-border)] px-2.5 py-0.5 text-xs text-[var(--usha-muted)]">
              {t("inactiveBadge")}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--usha-muted)]">
          {listing.price != null && <span>{t("priceSek", { price: listing.price })}</span>}
          {listing.duration_minutes != null && (
            <span className="flex items-center gap-1">
              <Clock size={12} />
              {t("durationMinutes", { minutes: listing.duration_minutes })}
            </span>
          )}
          {listing.event_date && (
            <span className="flex items-center gap-1">
              <Calendar size={12} />
              {new Date(listing.event_date + "T00:00").toLocaleDateString("sv-SE", { day: "numeric", month: "short" })}
            </span>
          )}
          {listing.event_time && (
            <span className="flex items-center gap-1">
              <Clock size={12} />
              {listing.event_time.slice(0, 5)}
            </span>
          )}
          {listing.event_location && (
            <span className="flex items-center gap-1">
              <MapPin size={12} />
              {listing.event_location}
            </span>
          )}
        </div>
      </Link>

      <div className="flex flex-wrap items-center gap-2 sm:ml-4 sm:shrink-0">
        <SocialShareButton
          title={listing.title}
          url={eventShareUrl(
            listing,
            typeof window !== "undefined" ? window.location.origin : null
          )}
          eventDate={listing.event_date}
          eventTime={listing.event_time}
          eventLocation={listing.event_location}
          price={listing.price}
        />
        {listing.is_active && !hasEarlyBird && (
          <button
            onClick={handleEarlyBird}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--usha-gold)]/30 px-3 py-1.5 text-xs font-medium text-[var(--usha-gold)] transition-colors hover:bg-[var(--usha-gold)]/10"
            title={t("earlyBirdButtonTitle")}
          >
            <Crown size={12} />
            {t("earlyBirdButton")}
          </button>
        )}
        {hasEarlyBird && (
          <span className="flex items-center gap-1 rounded-full bg-[var(--usha-gold)]/10 px-2.5 py-1 text-[10px] font-medium text-[var(--usha-gold)]">
            <Crown size={10} />
            {t("goldExclusiveBadge")}
          </span>
        )}
        <button
          onClick={handleToggle}
          className="rounded-lg border border-[var(--usha-border)] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--usha-card-hover)]"
        >
          {listing.is_active ? t("deactivate") : t("activate")}
        </button>
        {(kanFlyttaUpp || kanFlyttaNer) && (
          <>
            <button
              onClick={() => handleMove("upp")}
              disabled={!kanFlyttaUpp}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--usha-muted)] transition-colors hover:bg-[var(--usha-card-hover)] hover:text-[var(--usha-white)] disabled:opacity-25 disabled:hover:bg-transparent"
              aria-label={t("moveUp")}
              title={t("moveUp")}
            >
              <ArrowUp size={14} />
            </button>
            <button
              onClick={() => handleMove("ner")}
              disabled={!kanFlyttaNer}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--usha-muted)] transition-colors hover:bg-[var(--usha-card-hover)] hover:text-[var(--usha-white)] disabled:opacity-25 disabled:hover:bg-transparent"
              aria-label={t("moveDown")}
              title={t("moveDown")}
            >
              <ArrowDown size={14} />
            </button>
          </>
        )}
        <button
          onClick={handleDuplicate}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--usha-muted)] transition-colors hover:bg-[var(--usha-card-hover)] hover:text-[var(--usha-white)]"
          aria-label={t("duplicate")}
          title={t("duplicate")}
        >
          <Copy size={14} />
        </button>
        <Link
          href={`/dashboard/listings/${listing.id}/edit`}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--usha-muted)] transition-colors hover:bg-[var(--usha-card-hover)] hover:text-[var(--usha-white)]"
          aria-label={t("editLabel")}
        >
          <Pencil size={14} />
        </Link>
        <button
          onClick={handleDelete}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--usha-muted)] transition-colors hover:bg-red-500/10 hover:text-red-400"
          aria-label={t("deleteLabel")}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
