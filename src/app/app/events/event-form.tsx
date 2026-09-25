"use client";

import { useRef, useState, useTransition } from "react";
import { utcToStockholmLocal } from "@/lib/time";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, ImagePlus, X, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/toaster";
import { uploadImage } from "@/lib/storage/upload-client";
import { EVENT_CATEGORIES } from "./constants";
import TimeSelect from "@/components/time-select";
import PlacesAutocomplete from "@/components/places-autocomplete";

import type { ListingType, ExperienceDetails } from "@/types/database";

interface EventData {
  id: string;
  title: string;
  description: string | null;
  category: string;
  price: number | null;
  duration_minutes: number | null;
  event_tier: string | null;
  image_url: string | null;
  event_date: string | null;
  event_time: string | null;
  event_location: string | null;
  event_end_time: string | null;
  event_lat: number | null;
  event_lng: number | null;
  event_place_id: string | null;
  event_city?: string | null;
  event_venue?: string | null;
  venue_profile_id?: string | null;
  venue_confirmed_at?: string | null;
  listing_type: ListingType | null;
  open_to_instructors: boolean | null;
  service_fee_mode?: string | null;
  is_public?: boolean | null;
  content_language?: string | null;
  early_bird_start?: string | null;
  early_bird_end?: string | null;
  early_bird_price?: number | null;
  public_sale_at?: string | null;
  capacity?: number | null;
  min_guests: number | null;
  max_guests: number | null;
  experience_details: ExperienceDetails | null;
  ticketTypes?: { id: string; name: string; price: number; capacity: number | null; pools?: string[] }[];
}

// Auto-derive listing type from category
function suggestListingType(category: string): ListingType {
  switch (category) {
    case "restaurant": return "table_reservation";
    case "spa": case "retreat": return "spa_treatment";
    case "fitness": return "group_activity";
    default: return "event";
  }
}

export interface VenueOption {
  id: string;
  name: string;
}

/** Lokaler den inloggade får skapa evenemang i namnet på. */
export interface OrganiserOption {
  id: string;
  name: string;
}

export default function EventForm({
  event,
  action,
  venues = [],
  organisers = [],
  selfName = "",
}: {
  event?: EventData;
  /** Lokaler på plattformen som evenemanget kan kopplas till. */
  venues?: VenueOption[];
  /** Lokaler den inloggade kan skapa i namnet på (tomt = bara sig själv). */
  organisers?: OrganiserOption[];
  selfName?: string;
  action: (
    formData: FormData
  ) => Promise<{ error?: string; locked?: boolean; id?: string } | void>;
  /** Still accepted by callers; upload now happens server-side via the API route. */
  userId?: string;
}) {
  const { toast } = useToast();
  const t = useTranslations("eventForm");
  const tCat = useTranslations("eventForm.categories");
  const router = useRouter();

  const CATEGORIES = EVENT_CATEGORIES.map((value) => ({ value, label: tCat(value) }));
  const TIERS = [
    { value: "", label: t("tierAll") },
    { value: "guld", label: t("tierGold") },
    { value: "premium", label: t("tierPremium") },
  ];
  const LISTING_TYPES: { value: ListingType; label: string }[] = [
    { value: "event", label: t("typeEvent") },
    { value: "table_reservation", label: t("typeTable") },
    { value: "spa_treatment", label: t("typeSpa") },
    { value: "group_activity", label: t("typeGroup") },
  ];

  const [isPending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState("");
  const [imageUrl, setImageUrl] = useState<string>(event?.image_url ?? "");
  const [uploading, setUploading] = useState(false);
  // Free-ticket option: an existing event with no/zero price is treated as free.
  const [isFree, setIsFree] = useState<boolean>(event ? !event.price : false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [listingType, setListingType] = useState<ListingType>(
    event?.listing_type ?? suggestListingType(event?.category ?? "")
  );
  const [category, setCategory] = useState(event?.category ?? "");
  const [amenities, setAmenities] = useState<string>(
    (event?.experience_details?.amenities ?? []).join(", ")
  );
  const [included, setIncluded] = useState<string>(
    (event?.experience_details?.included ?? []).join(", ")
  );
  const showGuestFields = ["table_reservation", "spa_treatment", "group_activity"].includes(listingType);
  const isEditing = !!event?.id;
  const [recurring, setRecurring] = useState(false);
  const [recurInterval, setRecurInterval] = useState("weekly");
  const [occurrences, setOccurrences] = useState(4);
  const [fbAutoPost, setFbAutoPost] = useState(true);
  const [openToInstructors, setOpenToInstructors] = useState(event?.open_to_instructors ?? false);
  const [unlisted, setUnlisted] = useState(event?.is_public === false);
  // Tickster-style service fee: organizer chooses who pays Usha's per-ticket fee.
  const [serviceFeeMode, setServiceFeeMode] = useState<"buyer" | "absorb">(
    event?.service_fee_mode === "absorb" ? "absorb" : "buyer"
  );
  // Ticket types (price tiers). Empty = single-price event (unchanged behaviour).
  const [types, setTypes] = useState<{ id?: string; name: string; price: string; capacity: string; pools: string }[]>(
    () =>
      (event?.ticketTypes ?? []).map((tt) => ({
        id: tt.id,
        name: tt.name,
        price: String(tt.price),
        capacity: tt.capacity != null ? String(tt.capacity) : "",
        pools: (tt.pools ?? []).join(", "),
      }))
  );
  const addType = () => setTypes((p) => [...p, { name: "", price: "", capacity: "", pools: "" }]);
  const updateType = (i: number, field: "name" | "price" | "capacity" | "pools", val: string) =>
    setTypes((p) => p.map((t, idx) => (idx === i ? { ...t, [field]: val } : t)));
  const removeType = (i: number) => setTypes((p) => p.filter((_, idx) => idx !== i));
  const typesJson = JSON.stringify(
    types
      .filter((t) => t.name.trim())
      .map((t) => ({
        ...(t.id ? { id: t.id } : {}),
        name: t.name.trim(),
        price: parseInt(t.price || "0", 10) || 0,
        capacity: t.capacity.trim() === "" ? null : parseInt(t.capacity, 10) || null,
        pools: t.pools,
      }))
  );
  const hasTypes = types.some((t) => t.name.trim());

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Note: don't reject by file.type / size here — phone photos are HEIC, can
    // have an empty MIME type, and are often >5 MB. uploadImage() downscales and
    // re-encodes to JPEG, which normalises all of that.
    if (file.type && !file.type.startsWith("image/")) {
      toast.error(t("toastInvalidFileTitle"), t("toastInvalidFileBody"));
      return;
    }

    setUploading(true);
    try {
      const url = await uploadImage(file, "event-images");
      setImageUrl(`${url}?t=${Date.now()}`);
    } catch (err) {
      toast.error(t("toastUploadFailed"), err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  function handleSubmit(formData: FormData) {
    setSubmitError("");
    startTransition(async () => {
      const result = await action(formData);
      if (result && "error" in result && result.error) {
        // Persistent inline error (in addition to the toast): a toast is easy to
        // miss, and the page can scroll on submit, so a failed save otherwise
        // looks like nothing happened. Keep it visible next to the button.
        setSubmitError(result.error);
        toast.error(t("toastSaveFailedTitle"), result.error);
        return;
      }
      // Ticketed event pending unlock: it was saved as a draft. Send the host to
      // its dashboard, where they unlock to publish it.
      if (result && result.locked && result.id) {
        toast.info(t("toastUnlockTitle"), t("toastUnlockBody"));
        router.push(`/app/events/${result.id}/live`);
        return;
      }
      // Otherwise the server action redirects on success.
    });
  }

  return (
    <div className="px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--usha-border)] text-[var(--usha-muted)] hover:text-[var(--usha-white)]"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-xl font-bold">
          {event?.id ? t("editTitle") : t("newTitle")}
        </h1>
      </div>

      <form action={handleSubmit} className="space-y-5">
        {/* Event image */}
        <div>
          <label className="mb-1.5 block text-sm text-[var(--usha-muted)]">
            {t("image")}
          </label>
          <div
            onClick={() => !uploading && fileInputRef.current?.click()}
            className="group relative cursor-pointer overflow-hidden rounded-xl border border-dashed border-[var(--usha-border)] bg-[var(--usha-card)] transition hover:border-[var(--usha-gold)]/40"
          >
            {imageUrl ? (
              <div className="relative aspect-[1.91/1] bg-black">
                <img
                  src={imageUrl}
                  alt={t("imageAlt")}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <ImagePlus size={24} className="text-white" />
                </div>
              </div>
            ) : (
              <div className="flex aspect-[1.91/1] flex-col items-center justify-center gap-2 text-[var(--usha-muted)]">
                {uploading ? (
                  <Loader2 size={24} className="animate-spin" />
                ) : (
                  <>
                    <ImagePlus size={24} />
                    <span className="text-xs">{t("imageUpload")}</span>
                    <span className="text-[10px]">{t("imageHint")}</span>
                  </>
                )}
              </div>
            )}
          </div>
          {imageUrl && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setImageUrl("");
              }}
              className="mt-2 flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
            >
              <X size={12} />
              {t("imageRemove")}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
          />
          <input type="hidden" name="image_url" value={imageUrl} />
        </div>

        {/* Title */}
        <div>
          <label htmlFor="title" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
            {t("title")} <span className="text-red-400">*</span>
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            defaultValue={event?.title ?? ""}
            placeholder={t("titlePlaceholder")}
            className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
            {t("description")}
          </label>
          <textarea
            id="description"
            name="description"
            rows={4}
            defaultValue={event?.description ?? ""}
            placeholder={t("descriptionPlaceholder")}
            className="w-full resize-none rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
          />
        </div>

        {/* Date */}
        <div>
          <label htmlFor="event_date" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
            {t("date")}
          </label>
          <input
            id="event_date"
            name="event_date"
            type="date"
            defaultValue={event?.event_date ?? ""}
            className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
          />
        </div>

        {/* Start + End time */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="event_time" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
              {t("startTime")} <span className="text-[var(--usha-gold)]">*</span>
            </label>
            <TimeSelect id="event_time" name="event_time" defaultValue={event?.event_time ?? ""} />
          </div>
          <div>
            <label htmlFor="event_end_time" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
              {t("endTime")} <span className="text-[var(--usha-gold)]">*</span>
            </label>
            <TimeSelect id="event_end_time" name="event_end_time" defaultValue={event?.event_end_time ?? ""} />
            {/* Skälet står här, inte i ett felmeddelande efter att någon
                försökt spara. Sluttiden är den enda uppgiften vars nytta syns
                först hos besökaren, inte hos arrangören. */}
            <p className="mt-1.5 text-xs text-[var(--usha-muted)]">{t("endTimeHint")}</p>
          </div>
        </div>

        {/* Recurring series — only when creating */}
        {!isEditing && (
          <div className="space-y-3 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4">
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={recurring}
                onChange={(e) => setRecurring(e.target.checked)}
                className="h-4 w-4 accent-[var(--usha-gold)]"
              />
              <span className="font-medium">{t("recurring")}</span>
            </label>
            {recurring && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="recur_interval" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
                      {t("interval")}
                    </label>
                    <select
                      id="recur_interval"
                      value={recurInterval}
                      onChange={(e) => setRecurInterval(e.target.value)}
                      className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-bg,var(--usha-card))] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
                    >
                      <option value="weekly">{t("intervalWeekly")}</option>
                      <option value="biweekly">{t("intervalBiweekly")}</option>
                      <option value="monthly">{t("intervalMonthly")}</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="occurrences" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
                      {t("occurrences")}
                    </label>
                    <input
                      id="occurrences"
                      type="number"
                      min={2}
                      max={52}
                      value={occurrences}
                      onChange={(e) => setOccurrences(Math.min(Math.max(parseInt(e.target.value) || 2, 2), 52))}
                      className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-bg,var(--usha-card))] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
                    />
                  </div>
                </div>
                <p className="text-xs text-[var(--usha-muted)]">
                  {t("recurringHint", { count: occurrences })}
                </p>
              </>
            )}
          </div>
        )}
        <input type="hidden" name="recurrence" value={recurring ? recurInterval : "none"} />
        <input type="hidden" name="occurrences" value={occurrences} />

        {/* Auto-publish to Facebook — only when creating */}
        {!isEditing && (
          <div className="space-y-2 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4">
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                name="fb_auto_post"
                checked={fbAutoPost}
                onChange={(e) => setFbAutoPost(e.target.checked)}
                className="h-4 w-4 accent-[var(--usha-gold)]"
              />
              <span className="font-medium">{t("fbAutoPost")}</span>
            </label>
            <p className="text-xs text-[var(--usha-muted)]">
              {recurring ? t("fbAutoPostHintRecurring") : t("fbAutoPostHint")}
            </p>
          </div>
        )}

        {/* Per-event språk — tvingar event-sidan till valt språk för alla besökare */}
        <div className="space-y-2 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4">
          <label className="block text-sm font-medium" htmlFor="content_language">
            {t("contentLanguageLabel")}
          </label>
          <select
            id="content_language"
            name="content_language"
            defaultValue={event?.content_language ?? ""}
            className="w-full rounded-lg border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2 text-sm text-[var(--usha-white)]"
          >
            <option value="">{t("langAuto")}</option>
            <option value="sv">{t("langSv")}</option>
            <option value="en">{t("langEn")}</option>
          </select>
          <p className="text-xs text-[var(--usha-muted)]">{t("contentLanguageHelp")}</p>
        </div>

        {/* Olistat event — nåbart via direktlänk men dolt från marknadsplats/sök */}
        <div className="space-y-2 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              name="unlisted"
              checked={unlisted}
              onChange={(e) => setUnlisted(e.target.checked)}
              className="h-4 w-4 accent-[var(--usha-gold)]"
            />
            <span className="font-medium">{t("unlistedLabel")}</span>
          </label>
          <p className="text-xs text-[var(--usha-muted)]">
            {t("unlistedHelp")}
          </p>
        </div>

        {/* Tidsstyrd automatisering — förköpsfönster, schemalagt släpp, kapacitet */}
        <details className="rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4">
          <summary className="cursor-pointer text-sm font-medium">{t("automationSummary")}</summary>
          <p className="mt-2 text-xs text-[var(--usha-muted)]">
            {t("automationHelp")}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-[var(--usha-muted)]">
              {t("ebStart")}
              <input
                type="datetime-local"
                name="early_bird_start"
                defaultValue={utcToStockholmLocal(event?.early_bird_start)}
                className="mt-1 w-full rounded-lg border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2 text-sm text-[var(--usha-white)]"
              />
            </label>
            <label className="text-xs text-[var(--usha-muted)]">
              {t("ebEnd")}
              <input
                type="datetime-local"
                name="early_bird_end"
                defaultValue={utcToStockholmLocal(event?.early_bird_end)}
                className="mt-1 w-full rounded-lg border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2 text-sm text-[var(--usha-white)]"
              />
            </label>
            <label className="text-xs text-[var(--usha-muted)]">
              {t("ebPrice")}
              <input
                type="number"
                name="early_bird_price"
                min={0}
                defaultValue={event?.early_bird_price ?? ""}
                className="mt-1 w-full rounded-lg border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2 text-sm text-[var(--usha-white)]"
              />
            </label>
            <label className="text-xs text-[var(--usha-muted)]">
              {t("publicSale")}
              <input
                type="datetime-local"
                name="public_sale_at"
                defaultValue={utcToStockholmLocal(event?.public_sale_at)}
                className="mt-1 w-full rounded-lg border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2 text-sm text-[var(--usha-white)]"
              />
            </label>
            <label className="text-xs text-[var(--usha-muted)]">
              {t("capacityField")}
              <input
                type="number"
                name="capacity"
                min={0}
                defaultValue={event?.capacity ?? ""}
                className="mt-1 w-full rounded-lg border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2 text-sm text-[var(--usha-white)]"
              />
            </label>
          </div>
        </details>

        {/* Open to instructors — shown on both create and edit */}
        <div className="space-y-2 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              name="open_to_instructors"
              checked={openToInstructors}
              onChange={(e) => setOpenToInstructors(e.target.checked)}
              className="h-4 w-4 accent-[var(--usha-gold)]"
            />
            <span className="font-medium">{t("openToInstructors")}</span>
          </label>
          <p className="text-xs text-[var(--usha-muted)]">
            {t("openToInstructorsHint")}
          </p>
        </div>

        {/* Vem evenemanget läggs upp i namnet på. Visas bara för den som
            tillhör minst en lokal med rätt att skapa — för alla andra finns
            inget val att göra, och en väljare med ett alternativ är brus.

            Valet styr ÄGARSKAPET av raden, alltså vart pengarna går. Därför
            ligger det överst och inte gömt bland detaljerna. */}
        {organisers.length > 0 && !event && (
          <div className="rounded-xl border border-[var(--usha-gold)]/25 bg-[var(--usha-gold)]/5 p-4">
            <label htmlFor="create_as_venue" className="mb-1.5 block text-sm font-medium">
              {t("organiser")}
            </label>
            <select
              id="create_as_venue"
              name="create_as_venue"
              defaultValue=""
              className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
            >
              <option value="">{selfName || t("organiserSelf")}</option>
              {organisers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-[var(--usha-muted)]">{t("organiserHint")}</p>
          </div>
        )}

        {/* Location with Google Places Autocomplete */}
        <PlacesAutocomplete
          defaultValue={event?.event_location ?? ""}
          defaultLat={event?.event_lat}
          defaultLng={event?.event_lng}
          defaultPlaceId={event?.event_place_id}
          defaultCity={event?.event_city ?? null}
          defaultVenue={event?.event_venue ?? null}
        />

        {/* Koppling till en lokal på plattformen. Skilt från adressen ovan:
            adressen säger var, den här säger HOS VEM — och det är den som gör
            att lokalens följare får veta, och att evenemanget syns på deras
            sida. Döljs helt när det inte finns någon lokal att välja. */}
        {venues.length > 0 && (
          <div className="space-y-2">
            <label htmlFor="venue_profile_id" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
              {t("venueProfile")}
            </label>
            <select
              id="venue_profile_id"
              name="venue_profile_id"
              defaultValue={event?.venue_profile_id ?? ""}
              className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
            >
              <option value="">{t("venueProfileNone")}</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-[var(--usha-muted)]">
              {event?.venue_profile_id && !event?.venue_confirmed_at
                ? t("venueProfilePending")
                : t("venueProfileHint")}
            </p>
          </div>
        )}

        {/* Category + Price */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="category" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
              {t("category")} <span className="text-red-400">*</span>
            </label>
            <select
              id="category"
              name="category"
              required
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setListingType(suggestListingType(e.target.value));
              }}
              className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
            >
              <option value="">{t("categoryPlaceholder")}</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 flex items-center gap-2 text-sm text-[var(--usha-muted)]">
              <input
                type="checkbox"
                checked={isFree}
                onChange={(e) => setIsFree(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--usha-border)] accent-[var(--usha-gold)]"
              />
              {t("freeTicket")}
            </label>
            {isFree ? (
              <input type="hidden" name="price" value="0" />
            ) : (
              <>
                <input
                  id="price"
                  name="price"
                  type="number"
                  min={0}
                  defaultValue={event?.price ?? ""}
                  placeholder={t("pricePlaceholder")}
                  disabled={hasTypes}
                  className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40 disabled:opacity-40"
                />
                {hasTypes && (
                  <p className="mt-1 text-xs text-[var(--usha-muted)]">{t("ticketTypesOverridePrice")}</p>
                )}
              </>
            )}

            {/* Service fee — organizer chooses who pays Usha's per-ticket fee.
                Only relevant for paid tickets; the fee itself stays inactive
                until the platform enables it. */}
            {!isFree && (
              <div className="mt-3">
                <input type="hidden" name="service_fee_mode" value={serviceFeeMode} />
                <p className="mb-1.5 text-sm text-[var(--usha-muted)]">{t("serviceFeeLabel")}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setServiceFeeMode("buyer")}
                    className={`rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                      serviceFeeMode === "buyer"
                        ? "border-[var(--usha-gold)]/60 bg-[var(--usha-gold)]/10 text-[var(--usha-white)]"
                        : "border-[var(--usha-border)] bg-[var(--usha-card)] text-[var(--usha-muted)]"
                    }`}
                  >
                    <span className="block font-medium">{t("serviceFeeBuyerTitle")}</span>
                    <span className="block text-xs opacity-80">{t("serviceFeeBuyerHint")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setServiceFeeMode("absorb")}
                    className={`rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                      serviceFeeMode === "absorb"
                        ? "border-[var(--usha-gold)]/60 bg-[var(--usha-gold)]/10 text-[var(--usha-white)]"
                        : "border-[var(--usha-border)] bg-[var(--usha-card)] text-[var(--usha-muted)]"
                    }`}
                  >
                    <span className="block font-medium">{t("serviceFeeAbsorbTitle")}</span>
                    <span className="block text-xs opacity-80">{t("serviceFeeAbsorbHint")}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Ticket types (price tiers). Optional — leave empty for a single
                price. When present, buyers pick a type and its price applies. */}
            {!isFree && (
              <div className="mt-4">
                <input type="hidden" name="ticket_types" value={typesJson} />
                <p className="mb-1.5 text-sm text-[var(--usha-muted)]">{t("ticketTypesLabel")}</p>
                {types.length > 0 && (
                  <div className="space-y-2">
                    {types.map((tt, i) => (
                      // Stack on mobile (name on its own row, then price/capacity/
                      // remove) so nothing overflows off-screen; single row on sm+.
                      <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          value={tt.name}
                          onChange={(e) => updateType(i, "name", e.target.value)}
                          placeholder={t("ticketTypeNamePlaceholder")}
                          className="w-full min-w-0 rounded-lg border border-[var(--usha-border)] bg-[var(--usha-card)] px-3 py-2 text-sm outline-none focus:border-[var(--usha-gold)]/40 sm:flex-1"
                        />
                        <div className="flex items-center gap-2">
                          <input
                            value={tt.price}
                            onChange={(e) => updateType(i, "price", e.target.value)}
                            type="number"
                            min={0}
                            placeholder={t("ticketTypePricePlaceholder")}
                            className="min-w-0 flex-1 rounded-lg border border-[var(--usha-border)] bg-[var(--usha-card)] px-3 py-2 text-sm outline-none focus:border-[var(--usha-gold)]/40 sm:w-24 sm:flex-none"
                          />
                          <input
                            value={tt.capacity}
                            onChange={(e) => updateType(i, "capacity", e.target.value)}
                            type="number"
                            min={1}
                            placeholder={t("ticketTypeCapacityPlaceholder")}
                            className="min-w-0 flex-1 rounded-lg border border-[var(--usha-border)] bg-[var(--usha-card)] px-3 py-2 text-sm outline-none focus:border-[var(--usha-gold)]/40 sm:w-24 sm:flex-none"
                          />
                          <input
                            value={tt.pools}
                            onChange={(e) => updateType(i, "pools", e.target.value)}
                            placeholder={t("ticketTypePoolPlaceholder")}
                            title={t("ticketTypePoolHint")}
                            className="min-w-0 flex-1 rounded-lg border border-[var(--usha-border)] bg-[var(--usha-card)] px-3 py-2 text-sm outline-none focus:border-[var(--usha-gold)]/40 sm:w-28 sm:flex-none"
                          />
                          <button
                            type="button"
                            onClick={() => removeType(i)}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--usha-border)] text-[var(--usha-muted)] hover:text-red-400"
                            aria-label={t("ticketTypeRemove")}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={addType}
                  className="mt-2 rounded-lg border border-dashed border-[var(--usha-border)] px-3 py-2 text-sm text-[var(--usha-muted)] transition hover:border-[var(--usha-gold)]/40 hover:text-[var(--usha-white)]"
                >
                  + {t("ticketTypeAdd")}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Duration + Tier */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="duration_minutes" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
              {t("duration")}
            </label>
            <input
              id="duration_minutes"
              name="duration_minutes"
              type="number"
              min={0}
              step={15}
              defaultValue={event?.duration_minutes ?? ""}
              placeholder={t("durationPlaceholder")}
              className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
            />
          </div>

          <div>
            <label htmlFor="event_tier" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
              {t("availability")}
            </label>
            <select
              id="event_tier"
              name="event_tier"
              defaultValue={event?.event_tier ?? ""}
              className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
            >
              {TIERS.map((tier) => (
                <option key={tier.value} value={tier.value}>
                  {tier.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Listing type */}
        <div>
          <label htmlFor="listing_type" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
            {t("listingType")}
          </label>
          <select
            id="listing_type"
            name="listing_type"
            value={listingType}
            onChange={(e) => setListingType(e.target.value as ListingType)}
            className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
          >
            {LISTING_TYPES.map((lt) => (
              <option key={lt.value} value={lt.value}>
                {lt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Guest capacity (only for relevant types) */}
        {showGuestFields && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="min_guests" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
                {t("minGuests")}
              </label>
              <input
                id="min_guests"
                name="min_guests"
                type="number"
                min={1}
                defaultValue={event?.min_guests ?? 1}
                className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
              />
            </div>
            <div>
              <label htmlFor="max_guests" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
                {t("maxGuests")}
              </label>
              <input
                id="max_guests"
                name="max_guests"
                type="number"
                min={1}
                defaultValue={event?.max_guests ?? ""}
                placeholder={t("maxGuestsPlaceholder")}
                className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
              />
            </div>
          </div>
        )}

        {/* Experience details */}
        <div>
          <label htmlFor="amenities" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
            {t("amenities")} <span className="text-xs">{t("commaSeparated")}</span>
          </label>
          <input
            id="amenities"
            name="amenities"
            type="text"
            value={amenities}
            onChange={(e) => setAmenities(e.target.value)}
            placeholder={t("amenitiesPlaceholder")}
            className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
          />
        </div>

        <div>
          <label htmlFor="included" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
            {t("included")} <span className="text-xs">{t("commaSeparated")}</span>
          </label>
          <input
            id="included"
            name="included"
            type="text"
            value={included}
            onChange={(e) => setIncluded(e.target.value)}
            placeholder={t("includedPlaceholder")}
            className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
          />
        </div>

        {submitError && (
          <p
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
          >
            {submitError}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex-1 rounded-xl border border-[var(--usha-border)] py-3 text-sm font-medium text-[var(--usha-muted)] transition hover:text-[var(--usha-white)]"
          >
            {t("cancel")}
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="flex-1 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] py-3 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? t("saving") : event ? t("saveChanges") : t("create")}
          </button>
        </div>
      </form>
    </div>
  );
}
