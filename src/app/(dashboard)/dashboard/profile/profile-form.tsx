"use client";

import { useRef, useState, useTransition } from "react";
import { updateProfile, updateAvatar } from "./actions";
import { uploadFile } from "@/lib/storage/upload-client";
import { useToast } from "@/components/ui/toaster";
import { Camera, Loader2, X, Plus, Instagram, ExternalLink } from "lucide-react";
import Image from "next/image";
import { CATEGORIES } from "@/lib/categories";
import { COACHING_FORMATS, COACHING_TITLE_MAX, COACHING_TITLE_PRESETS } from "@/lib/coaching/instructors";
import { CANCELLATION_HOUR_OPTIONS } from "@/lib/bookings/cancellation";
import { useTranslations } from "next-intl";

interface Profile {
  id: string;
  full_name: string | null;
  slug: string | null;
  avatar_url: string | null;
  bio: string | null;
  categories: string[];
  locations: string[];
  rates: Record<string, number>;
  websites: string[];
  social_instagram: string | null;
  social_x: string | null;
  social_facebook: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  terms_url: string | null;
  is_public: boolean;
  whitelabel_enabled: boolean;
  whitelabel_brand_name: string | null;
  whitelabel_logo_url: string | null;
  whitelabel_primary_color: string | null;
  whitelabel_accent_color: string | null;
  whitelabel_accent_color_2: string | null;
  whitelabel_accent_color_3: string | null;
  // Taxi dancer subcategory (set at signup, read-only here)
  creator_subcategory?: string | null;
  role?: string | null;
  dance_styles?: string[] | null;
  dance_languages?: string[] | null;
  dance_experience_years?: number | null;
  offers_coaching?: boolean | null;
  coaching_hourly_rate_sek?: number | null;
  coaching_specialties?: string[] | null;
  coaching_bio?: string | null;
  coaching_title?: string | null;
  coaching_formats?: string[] | null;
  coaching_credentials?: string[] | null;
  cancellation_hours?: number | null;
  // Legacy fields (backward compat during migration)
  category?: string | null;
  location?: string | null;
  hourly_rate?: number | null;
  website?: string | null;
}

const inputClass = "w-full min-h-[44px] rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-base sm:text-sm outline-none transition focus:border-[var(--usha-gold)]/40";

export default function ProfileForm({ profile, isPaidTier, isPremium, isCustomer = false }: { profile: Profile; isPaidTier: boolean; isPremium: boolean; isCustomer?: boolean }) {
  const t = useTranslations("dashProfile.form");
  const ta = useTranslations("a11y");
  const tc = useTranslations("categories");
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Multi-value state
  const initCategories = profile.categories?.length ? profile.categories : (profile.category ? [profile.category] : []);
  const initLocations = profile.locations?.length ? profile.locations : (profile.location ? [profile.location] : []);
  const initRates = profile.rates && Object.keys(profile.rates).length ? profile.rates : (profile.category && profile.hourly_rate ? { [profile.category]: profile.hourly_rate } : {});
  const initWebsites = profile.websites?.length ? profile.websites : (profile.website ? [profile.website] : []);

  const [selectedCategories, setSelectedCategories] = useState<string[]>(initCategories);
  const [locations, setLocations] = useState<string[]>(initLocations);
  const [rates, setRates] = useState<Record<string, number>>(initRates);
  const [websites, setWebsites] = useState<string[]>(initWebsites);
  const [newLocation, setNewLocation] = useState("");
  const [newWebsite, setNewWebsite] = useState("");

  // Taxi dancer fields
  const isTaxiDancer = profile.creator_subcategory === "taxi_dancer";
  const [danceStyles, setDanceStyles] = useState<string[]>(profile.dance_styles ?? []);
  const [danceLanguages, setDanceLanguages] = useState<string[]>(profile.dance_languages ?? []);
  const [danceExperienceYears, setDanceExperienceYears] = useState<string>(
    profile.dance_experience_years != null ? String(profile.dance_experience_years) : ""
  );
  const [offersCoaching, setOffersCoaching] = useState<boolean>(profile.offers_coaching ?? false);
  const [coachingRate, setCoachingRate] = useState<string>(
    profile.coaching_hourly_rate_sek != null ? String(profile.coaching_hourly_rate_sek) : ""
  );
  const [coachingSpecialties, setCoachingSpecialties] = useState<string[]>(
    profile.coaching_specialties ?? []
  );
  const [coachingBio, setCoachingBio] = useState<string>(profile.coaching_bio ?? "");
  // Instruktör, coach, PT … — öppet för alla kreatörer, inte bara taxidansare.
  const isCreatorRole = !isCustomer && profile.role === "creator";
  const [coachingTitle, setCoachingTitle] = useState<string>(profile.coaching_title ?? "");
  const [coachingFormats, setCoachingFormats] = useState<string[]>(profile.coaching_formats ?? []);
  const [coachingCredentials, setCoachingCredentials] = useState<string[]>(profile.coaching_credentials ?? []);

  function toggleCategory(value: string) {
    setSelectedCategories((prev) => {
      if (prev.includes(value)) {
        const next = prev.filter((c) => c !== value);
        // Remove rate for deselected category
        setRates((r) => {
          const { [value]: _, ...rest } = r;
          return rest;
        });
        return next;
      }
      return [...prev, value];
    });
  }

  function addLocation() {
    const trimmed = newLocation.trim();
    if (trimmed && !locations.includes(trimmed)) {
      setLocations((prev) => [...prev, trimmed]);
    }
    setNewLocation("");
  }

  function addWebsite() {
    const trimmed = newWebsite.trim();
    if (trimmed && !websites.includes(trimmed)) {
      setWebsites((prev) => [...prev, trimmed]);
    }
    setNewWebsite("");
  }

  async function resizeImage(file: File, maxSize: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = document.createElement("img");
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          } else {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error(t("compressionFailed")))),
          "image/jpeg",
          0.85
        );
      };
      img.onerror = () => reject(new Error(t("imageReadFailed")));
      img.src = URL.createObjectURL(file);
    });
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error(t("invalidFileTitle"), t("invalidFileDesc"));
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error(t("fileTooLargeTitle"), t("fileTooLargeDesc"));
      return;
    }

    setUploading(true);

    try {
      const compressed = await resizeImage(file, 800);
      const url = await uploadFile(compressed, "avatars", "avatar.jpg");
      const newUrl = `${url}?t=${Date.now()}`;

      const result = await updateAvatar(newUrl);
      if (result.error) {
        toast.error(t("avatarSaveFailedTitle"), result.error);
      } else {
        setAvatarUrl(newUrl);
        toast.success(t("avatarUpdatedTitle"));
      }
    } catch (err) {
      toast.error(t("genericErrorTitle"), (err as Error).message);
    }
    setUploading(false);
  }

  function handleSubmit(formData: FormData) {
    // Inject multi-value fields as JSON
    formData.set("categories", JSON.stringify(selectedCategories));
    formData.set("locations", JSON.stringify(locations));
    formData.set("rates", JSON.stringify(rates));
    formData.set("websites", JSON.stringify(websites));
    if (isTaxiDancer) {
      formData.set("dance_styles", JSON.stringify(danceStyles));
    }
    if (isCreatorRole) {
      formData.set("dance_languages", JSON.stringify(danceLanguages));
      formData.set("coaching_specialties", JSON.stringify(coachingSpecialties));
      formData.set("coaching_formats", JSON.stringify(coachingFormats));
      formData.set("coaching_credentials", JSON.stringify(coachingCredentials));
    }

    startTransition(async () => {
      const result = await updateProfile(formData);
      if (result.error) {
        toast.error(t("profileSaveFailedTitle"), result.error);
      } else {
        toast.success(t("profileSavedTitle"));
      }
    });
  }

  return (
    <form action={handleSubmit} className="space-y-8">
      {/* Avatar */}
      <div className="flex items-center gap-6">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="group relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--usha-border)] bg-[var(--usha-card)] transition-colors hover:border-[var(--usha-gold)]/40"
        >
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt={t("avatarAlt")}
              width={80}
              height={80}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-2xl font-bold text-[var(--usha-muted)]">
              {profile.full_name?.[0]?.toUpperCase() || "?"}
            </span>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            {uploading ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <Camera size={20} />
            )}
          </div>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleAvatarUpload}
          className="hidden"
        />
        <div>
          <p className="text-sm font-medium">{t("avatarLabel")}</p>
          <p className="text-xs text-[var(--usha-muted)]">{t("avatarHint")}</p>
        </div>
      </div>

      {/* Name */}
      <div>
        <label htmlFor="full_name" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
          {t("nameLabel")}
        </label>
        <input
          id="full_name"
          name="full_name"
          type="text"
          defaultValue={profile.full_name || ""}
          className={inputClass}
        />
      </div>

      {/* Customer: simple city field */}
      {isCustomer && (
        <div>
          <label htmlFor="customer_location" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
            {t("cityLabel")}
          </label>
          <input
            id="customer_location"
            name="customer_location"
            type="text"
            defaultValue={locations[0] || ""}
            placeholder={t("cityPlaceholder")}
            className={inputClass}
          />
          <p className="mt-1 text-[10px] text-[var(--usha-muted)]">
            {t("cityHint")}
          </p>
        </div>
      )}

      {/* === Creator-only sections === */}

      {/* Slug (vanity URL) - Guld & Premium.
          id:et är ankaret som "Nå ut"-panelen på startsidan länkar till. */}
      {!isCustomer && <div id="slug-section" style={{ scrollMarginTop: "5rem" }}>
        <label htmlFor="slug" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
          {t("slugLabel")}
          {!isPaidTier && (
            <span className="ml-2 rounded-full bg-[var(--usha-gold)]/15 px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--usha-gold)]">
              {t("slugTierBadge")}
            </span>
          )}
        </label>
        <div className="flex items-center gap-0">
          <span className="flex h-[44px] items-center rounded-l-xl border border-r-0 border-[var(--usha-border)] bg-[var(--usha-black)]/50 px-3 text-sm text-[var(--usha-muted)]">
            {t("slugPrefix")}
          </span>
          <input
            id="slug"
            name="slug"
            type="text"
            defaultValue={profile.slug || ""}
            placeholder={isPaidTier ? t("slugPlaceholderPaid") : t("slugPlaceholderLocked")}
            pattern="[a-z0-9_-]+"
            disabled={!isPaidTier}
            className={`w-full min-h-[44px] rounded-r-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-base sm:text-sm outline-none transition focus:border-[var(--usha-gold)]/40 ${!isPaidTier ? "opacity-50 cursor-not-allowed" : ""}`}
          />
        </div>
        {isPaidTier ? (
          <p className="mt-1 text-[10px] text-[var(--usha-muted)]">
            {t("slugHintPaid")}
          </p>
        ) : (
          <p className="mt-1 text-[10px] text-[var(--usha-muted)]">
            {t("slugHintLocked")}{" "}
            <a href="/dashboard/billing" className="text-[var(--usha-gold)] hover:underline">{t("slugUpgrade")}</a>
          </p>
        )}
      </div>}

      {/* Categories (multi-select pills) */}
      {!isCustomer && <div>
        <label className="mb-1.5 block text-sm text-[var(--usha-muted)]">
          {t("categoriesLabel")}
        </label>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => {
            const selected = selectedCategories.includes(c.value);
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => toggleCategory(c.value)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  selected
                    ? "bg-[var(--usha-gold)] text-black"
                    : "bg-[var(--usha-card)] text-[var(--usha-muted)] ring-1 ring-[var(--usha-border)] hover:ring-[var(--usha-gold)]/40 hover:text-[var(--usha-white)]"
                }`}
              >
                {tc(c.value)}
              </button>
            );
          })}
        </div>
      </div>}

      {/* Bio */}
      {!isCustomer && <div>
        <label htmlFor="bio" className="mb-1.5 block text-sm text-[var(--usha-muted)]">
          {t("bioLabel")}
        </label>
        <textarea
          id="bio"
          name="bio"
          rows={4}
          defaultValue={profile.bio || ""}
          placeholder={t("bioPlaceholder")}
          className="w-full resize-none rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
        />
      </div>}

      {/* Locations (tag input) */}
      {!isCustomer && <div>
        <label className="mb-1.5 block text-sm text-[var(--usha-muted)]">
          {t("locationsLabel")}
        </label>
        {locations.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {locations.map((loc) => (
              <span
                key={loc}
                className="flex items-center gap-1 rounded-full bg-[var(--usha-gold)]/10 px-3 py-1 text-xs font-medium text-[var(--usha-gold)]"
              >
                {loc}
                <button
                  type="button"
                  onClick={() => setLocations((prev) => prev.filter((l) => l !== loc))}
                  aria-label={ta("removeLocation")}
                  className="ml-0.5 rounded-full p-0.5 transition hover:bg-[var(--usha-gold)]/20"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={newLocation}
            onChange={(e) => setNewLocation(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLocation();
              }
            }}
            placeholder={t("locationPlaceholder")}
            className={inputClass}
          />
          <button
            type="button"
            onClick={addLocation}
            className="flex shrink-0 items-center gap-1 rounded-xl border border-[var(--usha-border)] px-3 py-2 text-xs text-[var(--usha-muted)] transition hover:border-[var(--usha-gold)]/40 hover:text-[var(--usha-white)]"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>}

      {/* Rates per category */}
      {!isCustomer && selectedCategories.length > 0 && (
        <div>
          <label className="mb-1.5 block text-sm text-[var(--usha-muted)]">
            {t("ratesLabel")}
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {selectedCategories.map((cat) => (
              <div key={cat} className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-xs font-medium text-[var(--usha-muted)]">
                  {tc(cat)}
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={rates[cat] ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRates((prev) => ({
                      ...prev,
                      [cat]: val ? parseInt(val, 10) : 0,
                    }));
                  }}
                  placeholder={t("ratePlaceholder")}
                  className={inputClass}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Websites (tag input) */}
      {!isCustomer && <div>
        <label className="mb-1.5 block text-sm text-[var(--usha-muted)]">
          {t("websitesLabel")}
        </label>
        {websites.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {websites.map((url) => (
              <span
                key={url}
                className="flex items-center gap-1 rounded-full bg-[var(--usha-gold)]/10 px-3 py-1 text-xs font-medium text-[var(--usha-gold)]"
              >
                {url}
                <button
                  type="button"
                  onClick={() => setWebsites((prev) => prev.filter((w) => w !== url))}
                  aria-label={ta("removeWebsite")}
                  className="ml-0.5 rounded-full p-0.5 transition hover:bg-[var(--usha-gold)]/20"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={newWebsite}
            onChange={(e) => setNewWebsite(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addWebsite();
              }
            }}
            placeholder={t("websitePlaceholder")}
            className={inputClass}
          />
          <button
            type="button"
            onClick={addWebsite}
            className="flex shrink-0 items-center gap-1 rounded-xl border border-[var(--usha-border)] px-3 py-2 text-xs text-[var(--usha-muted)] transition hover:border-[var(--usha-gold)]/40 hover:text-[var(--usha-white)]"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>}

      {/* Social media */}
      {!isCustomer && <div>
        <label className="mb-3 block text-sm text-[var(--usha-muted)]">
          {t("socialLabel")}
        </label>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Instagram size={18} className="shrink-0 text-[var(--usha-muted)]" />
            <input
              name="social_instagram"
              type="text"
              defaultValue={profile.social_instagram || ""}
              placeholder={t("instagramPlaceholder")}
              className={inputClass}
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-sm font-bold text-[var(--usha-muted)]">𝕏</span>
            <input
              name="social_x"
              type="text"
              defaultValue={profile.social_x || ""}
              placeholder={t("xPlaceholder")}
              className={inputClass}
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-sm font-bold text-[var(--usha-muted)]">f</span>
            <input
              name="social_facebook"
              type="text"
              defaultValue={profile.social_facebook || ""}
              placeholder={t("facebookPlaceholder")}
              className={inputClass}
            />
          </div>
        </div>
      </div>}

      {/* Contact info */}
      {!isCustomer && <div>
        <label className="mb-3 block text-sm text-[var(--usha-muted)]">
          {t("contactLabel")}
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="contact_email" className="mb-1 block text-xs text-[var(--usha-muted)]">
              {t("contactEmailLabel")}
            </label>
            <input
              id="contact_email"
              name="contact_email"
              type="email"
              defaultValue={profile.contact_email || ""}
              placeholder={t("contactEmailPlaceholder")}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="contact_phone" className="mb-1 block text-xs text-[var(--usha-muted)]">
              {t("contactPhoneLabel")}
            </label>
            <input
              id="contact_phone"
              name="contact_phone"
              type="tel"
              defaultValue={profile.contact_phone || ""}
              placeholder={t("contactPhonePlaceholder")}
              className={inputClass}
            />
          </div>
        </div>
        <p className="mt-1 text-[10px] text-[var(--usha-muted)]">
          {t("contactHint")}
        </p>
        <div className="mt-4">
          <label htmlFor="terms_url" className="mb-1 block text-xs text-[var(--usha-muted)]">
            Köpvillkor (länk)
          </label>
          <input
            id="terms_url"
            name="terms_url"
            type="url"
            defaultValue={profile.terms_url || ""}
            placeholder="https://…/kopvillkor"
            className={inputClass}
          />
          <p className="mt-1 text-[10px] text-[var(--usha-muted)]">
            Visas i kassan för dina biljett-/produktköp. Kunden godkänner dina villkor vid köp.
          </p>
        </div>
      </div>}

      {/* White label. Öppet för alla sedan nivåerna togs bort (#584); märket
          "Premium" är därför borta. Ankare, se kommentaren vid slug. */}
      {!isCustomer && <div id="whitelabel" style={{ scrollMarginTop: "5rem" }} className={`space-y-4 rounded-xl border p-5 ${isPremium ? "border-[var(--usha-premium)]/20 bg-[var(--usha-premium)]/5" : "border-[var(--usha-border)] opacity-60"}`}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              {t("whitelabelTitle")}
            </h3>
            <p className="mt-0.5 text-[10px] text-[var(--usha-muted)]">
              {isPremium
                ? t("whitelabelHintPremium")
                : t("whitelabelHintLocked")}
            </p>
          </div>
          {/* Reglaget och fälten syns för alla — gråa och avstängda utan Premium. */}
          <label className={`relative inline-flex items-center ${isPremium ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`} title={isPremium ? undefined : t("whitelabelHintLocked")}>
              <input
                type="checkbox"
                name="whitelabel_enabled"
                disabled={!isPremium}
                defaultChecked={profile.whitelabel_enabled}
                className="h-4 w-4 rounded border-[var(--usha-border)] accent-[var(--usha-premium)]"
              />
          </label>
        </div>

        <fieldset disabled={!isPremium} className={isPremium ? "" : "cursor-not-allowed opacity-50"}>
          <div className="space-y-3">
            <div>
              <label htmlFor="whitelabel_brand_name" className="mb-1 block text-xs text-[var(--usha-muted)]">
                {t("whitelabelBrandNameLabel")}
              </label>
              <input
                id="whitelabel_brand_name"
                name="whitelabel_brand_name"
                type="text"
                defaultValue={profile.whitelabel_brand_name || ""}
                placeholder={t("whitelabelBrandNamePlaceholder")}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="whitelabel_logo_url" className="mb-1 block text-xs text-[var(--usha-muted)]">
                {t("whitelabelLogoLabel")}
              </label>
              <input
                id="whitelabel_logo_url"
                name="whitelabel_logo_url"
                type="url"
                defaultValue={profile.whitelabel_logo_url || ""}
                placeholder={t("whitelabelLogoPlaceholder")}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--usha-muted)]">
                {t("whitelabelPrimaryColorLabel")}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  name="whitelabel_primary_color"
                  defaultValue={profile.whitelabel_primary_color || "#d4a853"}
                  className="h-[44px] w-[44px] cursor-pointer rounded-xl border border-[var(--usha-border)] bg-transparent p-1"
                />
                <span className="text-xs text-[var(--usha-muted)]">
                  {t("whitelabelPrimaryColorHint")}
                </span>
              </div>
            </div>
            <div>
              <label className="mb-2 block text-xs text-[var(--usha-muted)]">
                {t("whitelabelAccentColorsLabel")}
              </label>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    name="whitelabel_accent_color"
                    defaultValue={profile.whitelabel_accent_color || "#d4a853"}
                    className="h-[44px] w-[44px] cursor-pointer rounded-xl border border-[var(--usha-border)] bg-transparent p-1"
                  />
                  <span className="text-xs text-[var(--usha-muted)]">{t("whitelabelAccent1")}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    name="whitelabel_accent_color_2"
                    defaultValue={profile.whitelabel_accent_color_2 || "#c9955d"}
                    className="h-[44px] w-[44px] cursor-pointer rounded-xl border border-[var(--usha-border)] bg-transparent p-1"
                  />
                  <span className="text-xs text-[var(--usha-muted)]">{t("whitelabelAccent2")}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    name="whitelabel_accent_color_3"
                    defaultValue={profile.whitelabel_accent_color_3 || "#b8860b"}
                    className="h-[44px] w-[44px] cursor-pointer rounded-xl border border-[var(--usha-border)] bg-transparent p-1"
                  />
                  <span className="text-xs text-[var(--usha-muted)]">{t("whitelabelAccent3")}</span>
                </div>
              </div>
            </div>
          </div>
        </fieldset>

        {isPremium && profile.slug && (
          <a
            href={`/creators/${profile.slug}`}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--usha-premium)]/30 px-4 py-2.5 text-sm font-medium text-[var(--usha-premium)] transition hover:bg-[var(--usha-premium)]/10"
          >
            <ExternalLink size={14} />
            {t("whitelabelPreview")}
          </a>
        )}

        {!isPremium && (
          <a
            href="/dashboard/billing"
            className="inline-block text-xs text-[var(--usha-premium)] hover:underline"
          >
            {t("whitelabelUpgrade")}
          </a>
        )}
      </div>}

      {/* Taxi dancer-specific fields */}
      {isTaxiDancer && (
        <div className="space-y-6 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6">
          <div>
            <h2 className="text-lg font-semibold">{t("taxiTitle")}</h2>
            <p className="mt-1 text-sm text-[var(--usha-muted)]">
              {t("taxiSubtitle")}
            </p>
          </div>

          <TagInput
            label={t("danceStylesLabel")}
            placeholder={t("danceStylesPlaceholder")}
            removeLabel={t("removeAria")}
            values={danceStyles}
            onChange={setDanceStyles}
          />

          {/* Experience years */}
          <div>
            <label className="mb-2 block text-sm font-medium">{t("experienceYearsLabel")}</label>
            <input
              type="number"
              name="dance_experience_years"
              value={danceExperienceYears}
              onChange={(e) => setDanceExperienceYears(e.target.value)}
              min={0}
              className={inputClass}
            />
          </div>
        </div>
      )}

      {/* Instruktör / coach / PT — syns i katalogen på /instruktorer */}
      {isCreatorRole && (
        <div id="instruktor" className="scroll-mt-24 space-y-6 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6">
          <div>
            <h2 className="text-lg font-semibold">{t("instructorTitle")}</h2>
            <p className="mt-1 text-sm text-[var(--usha-muted)]">{t("instructorSubtitle")}</p>
          </div>

          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4">
            <input
              type="checkbox"
              name="offers_coaching"
              checked={offersCoaching}
              onChange={(e) => setOffersCoaching(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--usha-border)] accent-[var(--usha-gold)]"
            />
            <div>
              <p className="text-sm font-medium">{t("coachingToggleTitle")}</p>
              <p className="text-xs text-[var(--usha-muted)]">{t("coachingToggleHint")}</p>
            </div>
          </label>

          {offersCoaching && (
            <div className="space-y-4 rounded-xl border border-[var(--usha-border)] p-4">
              <div>
                <label className="mb-2 block text-sm font-medium">{t("coachingTitleLabel")}</label>
                <input
                  type="text"
                  name="coaching_title"
                  value={coachingTitle}
                  onChange={(e) => setCoachingTitle(e.target.value)}
                  maxLength={COACHING_TITLE_MAX}
                  placeholder={t("coachingTitlePlaceholder")}
                  className={inputClass}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {COACHING_TITLE_PRESETS.map((key) => {
                    const label = t(`coachingTitlePresets.${key}`);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setCoachingTitle(label)}
                        className={`rounded-full border px-3 py-1 text-xs transition ${
                          coachingTitle === label
                            ? "border-[var(--usha-gold)] bg-[var(--usha-gold)]/10 text-[var(--usha-gold)]"
                            : "border-[var(--usha-border)] text-[var(--usha-muted)] hover:text-[var(--usha-white)]"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">{t("coachingFormatsLabel")}</p>
                <div className="flex flex-wrap gap-4">
                  {COACHING_FORMATS.map((f) => (
                    <label key={f} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={coachingFormats.includes(f)}
                        onChange={(e) =>
                          setCoachingFormats((prev) => (e.target.checked ? [...prev, f] : prev.filter((x) => x !== f)))
                        }
                        className="h-4 w-4 accent-[var(--usha-gold)]"
                      />
                      {t(`coachingFormats.${f}`)}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">{t("coachingRateLabel")}</label>
                <input
                  type="number"
                  name="coaching_hourly_rate_sek"
                  value={coachingRate}
                  onChange={(e) => setCoachingRate(e.target.value)}
                  min={0}
                  className={inputClass}
                />
              </div>

              <TagInput
                label={t("coachingSpecialtiesLabel")}
                placeholder={t("coachingSpecialtiesPlaceholder")}
                removeLabel={t("removeAria")}
                values={coachingSpecialties}
                onChange={setCoachingSpecialties}
              />

              <TagInput
                label={t("coachingCredentialsLabel")}
                placeholder={t("coachingCredentialsPlaceholder")}
                removeLabel={t("removeAria")}
                values={coachingCredentials}
                onChange={(v) => setCoachingCredentials(v.slice(0, 10))}
              />
              <p className="-mt-2 text-xs text-[var(--usha-muted)]">{t("coachingCredentialsHint")}</p>

              <TagInput
                label={t("danceLanguagesLabel")}
                placeholder={t("danceLanguagesPlaceholder")}
                removeLabel={t("removeAria")}
                values={danceLanguages}
                onChange={setDanceLanguages}
              />

              <div>
                <label className="mb-2 block text-sm font-medium">{t("coachingBioLabel")}</label>
                <textarea
                  name="coaching_bio"
                  value={coachingBio}
                  onChange={(e) => setCoachingBio(e.target.value)}
                  rows={3}
                  placeholder={t("coachingBioPlaceholder")}
                  className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-3 text-sm outline-none transition focus:border-[var(--usha-gold)]/40"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Avbokningstid — gäller alla köp hos den här säljaren */}
      {!isCustomer && (
        <div className="space-y-3 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6">
          <div>
            <h2 className="text-lg font-semibold">{t("cancellationTitle")}</h2>
            <p className="mt-1 text-sm text-[var(--usha-muted)]">{t("cancellationSubtitle")}</p>
          </div>
          <select name="cancellation_hours" defaultValue={profile.cancellation_hours ?? ""} className={inputClass}>
            <option value="">{t("cancellationAnytime")}</option>
            {CANCELLATION_HOUR_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {t("cancellationHours", { hours: h })}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Public toggle */}
      {!isCustomer && <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4">
        <input
          type="checkbox"
          name="is_public"
          defaultChecked={profile.is_public}
          className="h-4 w-4 rounded border-[var(--usha-border)] accent-[var(--usha-gold)]"
        />
        <div>
          <p className="text-sm font-medium">{t("publicToggleTitle")}</p>
          <p className="text-xs text-[var(--usha-muted)]">
            {t("publicToggleHint")}
          </p>
        </div>
      </label>}

      {/* Submit */}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="min-h-[44px] rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-8 py-3 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? t("submitting") : t("submit")}
        </button>
      </div>
    </form>
  );
}

/** Lista med fritext-taggar: skriv, Enter eller plus lägger till, kryss tar bort. */
function TagInput({
  label,
  placeholder,
  removeLabel,
  values,
  onChange,
}: {
  label: string;
  placeholder: string;
  removeLabel: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  function add() {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  }
  return (
    <div>
      <label className="mb-2 block text-sm font-medium">{label}</label>
      <div className="flex flex-wrap gap-2">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-lg bg-[var(--usha-gold)]/10 px-3 py-1 text-sm">
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="text-[var(--usha-muted)] hover:text-[var(--usha-white)]"
              aria-label={removeLabel}
            >
              <X size={14} />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className={inputClass}
        />
        <button
          type="button"
          onClick={add}
          className="min-h-[44px] shrink-0 rounded-xl border border-[var(--usha-border)] px-4 text-sm hover:bg-[var(--usha-card)]"
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}
