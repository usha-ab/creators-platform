"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Calendar, ChevronRight, Eye, ImageIcon } from "lucide-react";

export interface OwnListing {
  listing_type?: string | null;
  id: string;
  title: string;
  category?: string | null;
  price?: number | null;
  duration_minutes?: number | null;
  is_active?: boolean;
  event_date?: string | null;
  event_time?: string | null;
  image_url?: string | null;
  slug?: string | null;
}

/**
 * En rad i startsidans lista över det man själv säljer.
 *
 * Raden var tidigare en punkt, en titel, ett datum och en minutsiffra. Den såg
 * ut som en platshållare bredvid Evenemang-flikens kort — samma evenemang, men
 * utan affisch, pris eller status, och utan att visa om det gick att se
 * publikt. "Knapphändig och ofullständig" var ordet.
 *
 * Två fel utöver det tunna: raden ledde till det gamla tjänsteformuläret
 * (/dashboard/listings/[id]/edit) med sju fält, inte till evenemangets riktiga
 * redigering med hela knappraden. Och ingenstans i appen fanns en väg till hur
 * sidan faktiskt ser ut för en besökare.
 */
export function OwnListingRow({ listing }: { listing: OwnListing }) {
  const t = useTranslations("home");
  const te = useTranslations("myEvents");

  const datum = listing.event_date
    ? new Date(`${listing.event_date}T12:00:00+02:00`).toLocaleDateString("sv-SE", {
        day: "numeric",
        month: "short",
      })
    : null;
  const tid = listing.event_time ? String(listing.event_time).slice(0, 5) : null;
  const pris =
    typeof listing.price === "number" && listing.price > 0
      ? `${listing.price} kr`
      : listing.price === 0
        ? te("free")
        : null;

  // Förhandsgranskningen kräver en publik adress. Ett utkast utan slug har
  // ingen sida att visa, och då är knappen bara en besvikelse.
  const previewHref = listing.slug ? `/event/${listing.slug}` : null;

  return (
    <div className="flex items-stretch gap-2 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] transition hover:border-[var(--usha-gold)]/30">
      <Link
        href={`/app/events/${listing.id}/edit`}
        className="flex min-w-0 flex-1 items-center gap-3 p-2.5"
      >
        {listing.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.image_url}
            alt=""
            className="h-14 w-14 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-[var(--usha-black)] text-[var(--usha-muted)]">
            <ImageIcon size={18} />
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                listing.is_active ? "bg-green-400" : "bg-[var(--usha-muted)]"
              }`}
              aria-hidden
            />
            <span className="truncate text-sm font-medium">{listing.title}</span>
          </span>

          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--usha-muted)]">
            {datum && (
              <span className="flex items-center gap-1">
                <Calendar size={11} />
                {datum}
                {tid ? ` · ${tid}` : ""}
              </span>
            )}
            {pris && <span className="text-[var(--usha-gold)]">{pris}</span>}
            {!listing.is_active && <span>{te("statusDraft")}</span>}
          </span>
        </span>
      </Link>

      {previewHref && (
        <a
          href={previewHref}
          target="_blank"
          rel="noopener noreferrer"
          title={t("preview")}
          aria-label={t("preview")}
          className="flex shrink-0 items-center border-l border-[var(--usha-border)] px-3 text-[var(--usha-muted)] transition hover:text-[var(--usha-gold)]"
        >
          <Eye size={16} />
        </a>
      )}

      <Link
        href={`/app/events/${listing.id}/edit`}
        aria-hidden
        tabIndex={-1}
        className="flex shrink-0 items-center pr-2 text-[var(--usha-muted)]"
      >
        <ChevronRight size={16} />
      </Link>
    </div>
  );
}
