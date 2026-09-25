"use client";

import TimeSelect from "@/components/time-select";
import { useTransition, useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/toaster";
import { CATEGORIES } from "@/lib/categories";
import { uploadImage } from "@/lib/storage/upload-client";
import { ImagePlus, Loader2, X } from "lucide-react";
import PlacesAutocomplete from "@/components/places-autocomplete";

interface Listing {
  id: string;
  title: string;
  description: string | null;
  category: string;
  price: number | null;
  duration_minutes: number | null;
  image_url?: string | null;
  event_date?: string | null;
  event_time?: string | null;
  event_end_time?: string | null;
  event_location?: string | null;
  event_lat?: number | null;
  event_lng?: number | null;
  event_place_id?: string | null;
  listing_type?: string | null;
  pass_series_id?: string | null;
  pass_series_ids?: string[] | null;
  pass_reference_price?: number | null;
  pass_covers?: string | null;
  session_count?: number | null;
}

export default function ListingForm({
  listing,
  action,
  creatorSubcategory,
  seriesOptions = [],
}: {
  listing?: Listing;
  action: (formData: FormData) => Promise<{ error?: string } | void>;
  creatorSubcategory?: string | null;
  /** Kreatörens egna serier, för klippkort som ska gälla som biljett. */
  seriesOptions?: { id: string; title: string }[];
}) {
  const t = useTranslations("listingForm");
  const ta = useTranslations("a11y");
  const isTaxiDancer = creatorSubcategory === "taxi_dancer";
  // Kortet kan gälla flera serier. Äldre kort har bara pass_series_id.
  const selectedSeries =
    listing?.pass_series_ids?.length
      ? listing.pass_series_ids
      : listing?.pass_series_id
        ? [listing.pass_series_id]
        : [];
  const [listingType, setListingType] = useState<string>(
    listing?.listing_type ?? (isTaxiDancer ? "package" : "service")
  );
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [imageUrl, setImageUrl] = useState<string | null>(listing?.image_url ?? null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const url = await uploadImage(file, "listing-images");
      setImageUrl(url);
    } catch (err) {
      toast.error(t("uploadFailed"), err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  function handleSubmit(formData: FormData) {
    if (imageUrl) {
      formData.set("image_url", imageUrl);
    }
    formData.set("listing_type", listingType);
    startTransition(async () => {
      const result = await action(formData);
      if (result && "error" in result) {
        toast.error(t("saveFailed"), result.error);
      } else {
        toast.success(listing ? t("savedToast") : t("createdToast"));
      }
    });
  }

  return (
    <form action={handleSubmit} className="space-y-6">
      {/* Image Upload */}
      <div>
        <label className="mb-1.5 block text-sm text-[var(--usha-muted)]">{t("imageLabel")}</label>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          className="hidden"
        />
        {imageUrl ? (
          <div className="relative w-full overflow-hidden rounded-xl border border-[var(--usha-border)]" style={{ aspectRatio: "1.91 / 1" }}>
            <img src={imageUrl} alt="Listing" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => { setImageUrl(null); if (fileRef.current) fileRef.current.value = ""; }}
              aria-label={ta("removeImage")}
              className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white transition hover:bg-black/80"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex h-32 w-full items-center justify-center rounded-xl border-2 border-dashed border-[var(--usha-border)] transition hover:border-[var(--usha-gold)]/30 disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 size={20} className="animate-spin text-[var(--usha-muted)]" />
            ) : (
              <div className="flex flex-col items-center gap-1 text-[var(--usha-muted)]">
                <ImagePlus size={20} />
                <span className="text-xs">{t("uploadImage")}</span>
              </div>
            )}
          </button>
        )}
      </div>

      {/* Title */}
      <div>
        <label htmlFor="title" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
          {t("titleLabel")}
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          defaultValue={listing?.title || ""}
          placeholder={t("titlePlaceholder")}
          className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
        />
      </div>

      {/* Description */}
      <div>
        <label htmlFor="description" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
          {t("descriptionLabel")}
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          defaultValue={listing?.description || ""}
          placeholder={t("descriptionPlaceholder")}
          className="w-full resize-none rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
        />
      </div>

      {/* Typväljaren visas för ALLA kreatörer. Tidigare låg hela blocket bakom
          isTaxiDancer, så en boxningstränare kunde varken se eller välja
          klippkort — serverns grind var lyft men knappen fanns inte.
          Coaching och B2B är fortsatt taxidansarnas och listas bara för dem. */}
      <div>
          <label htmlFor="listing_type" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
            {t("listingTypeLabel")}
          </label>
          <select
            id="listing_type"
            value={listingType}
            onChange={(e) => setListingType(e.target.value)}
            className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
          >
            <option value="service">{t("typeService")}</option>
            <option value="package">{t("typePackage")}</option>
            {isTaxiDancer && (
              <>
                <option value="coaching_session">{t("typeCoachingSession")}</option>
                <option value="b2b_offering">{t("typeB2bOffering")}</option>
              </>
            )}
          </select>
          {listingType === "package" && (
            <>
              <p className="mt-1.5 text-xs text-[var(--usha-muted)]">
                {t("packageHint")}
              </p>
              <div className="mt-3">
                <label htmlFor="session_count" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
                  {t("sessionCountLabel")}
                </label>
                <input
                  id="session_count"
                  name="session_count"
                  type="number"
                  min={1}
                  step={1}
                  required
                  defaultValue={listing?.session_count ?? 5}
                  placeholder={t("sessionCountPlaceholder")}
                  className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
                />
              </div>
              {seriesOptions.length > 0 && (
                <div className="mt-3">
                  <span className="mb-1.5 block text-sm text-[var(--usha-muted)]">
                    {t("passSeriesLabel")}
                  </span>
                  <div className="flex flex-col gap-2 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3">
                    {seriesOptions.map((s) => (
                      <label key={s.id} className="flex items-center gap-2.5 text-sm">
                        <input
                          type="checkbox"
                          name="pass_series_id"
                          value={s.id}
                          defaultChecked={selectedSeries.includes(s.id)}
                          className="h-4 w-4 accent-[var(--usha-gold)]"
                        />
                        <span>{s.title}</span>
                      </label>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-[var(--usha-muted)]">{t("passSeriesHint")}</p>
                  <label htmlFor="pass_covers" className="mb-1.5 mt-3 block text-sm text-[var(--usha-muted)]">
                    {t("passCoversLabel")}
                  </label>
                  <input
                    id="pass_covers"
                    name="pass_covers"
                    type="text"
                    maxLength={80}
                    defaultValue={listing?.pass_covers ?? ""}
                    placeholder={t("passCoversPlaceholder")}
                    className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
                  />
                  <label htmlFor="pass_reference_price" className="mb-1.5 mt-3 block text-sm text-[var(--usha-muted)]">
                    {t("passReferencePriceLabel")}
                  </label>
                  <input
                    id="pass_reference_price"
                    name="pass_reference_price"
                    type="number"
                    min={1}
                    step={1}
                    defaultValue={listing?.pass_reference_price ?? ""}
                    className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
                  />
                  <p className="mt-1.5 text-xs text-[var(--usha-muted)]">{t("passReferencePriceHint")}</p>
                </div>
              )}
            </>
          )}
          {listingType === "coaching_session" && (
            <p className="mt-1.5 text-xs text-[var(--usha-muted)]">
              {t("coachingSessionHint")}
            </p>
          )}
          {listingType === "b2b_offering" && (
            <p className="mt-1.5 text-xs text-[var(--usha-muted)]">
              {t("b2bOfferingHint")}
            </p>
          )}
      </div>

      {/* Category + Price */}
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="category" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
            {t("categoryLabel")}
          </label>
          <select
            id="category"
            name="category"
            required
            defaultValue={listing?.category || ""}
            className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
          >
            <option value="">{t("categoryPlaceholder")}</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {t(`category_${c.value}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="price" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
            {t("priceLabel")}
          </label>
          <input
            id="price"
            name="price"
            type="number"
            min={0}
            defaultValue={listing?.price ?? ""}
            placeholder={t("pricePlaceholder")}
            className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
          />
        </div>
      </div>

      {/* Duration */}
      <div className="sm:w-1/2">
        <label htmlFor="duration_minutes" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
          {t("durationLabel")}
        </label>
        <input
          id="duration_minutes"
          name="duration_minutes"
          type="number"
          min={0}
          step={15}
          defaultValue={listing?.duration_minutes ?? ""}
          placeholder={t("durationPlaceholder")}
          className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
        />
      </div>

      {/* Date */}
      <div>
        <label htmlFor="event_date" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
          {t("dateLabel")}
        </label>
        <input
          id="event_date"
          name="event_date"
          type="date"
          defaultValue={listing?.event_date ?? ""}
          className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
        />
      </div>

      {/* Start + End time */}
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="event_time" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
            {t("startTimeLabel")}
          </label>
          <TimeSelect id="event_time" name="event_time" defaultValue={listing?.event_time ?? ""} />
        </div>
        <div>
          <label htmlFor="event_end_time" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
            {t("endTimeLabel")}
          </label>
          <TimeSelect id="event_end_time" name="event_end_time" defaultValue={listing?.event_end_time ?? ""} />
        </div>
      </div>

      {/* Location with Google Places Autocomplete */}
      <PlacesAutocomplete
        defaultValue={listing?.event_location ?? ""}
        defaultLat={listing?.event_lat}
        defaultLng={listing?.event_lng}
        defaultPlaceId={listing?.event_place_id}
      />

      {/* Submit */}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-8 py-3 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? t("saving") : listing ? t("saveChanges") : t("createListing")}
        </button>
      </div>
    </form>
  );
}
