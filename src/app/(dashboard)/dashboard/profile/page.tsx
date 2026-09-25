import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import ProfileForm from "./profile-form";
import { MediaGallery } from "./media-gallery";
import { InstagramConnect } from "./instagram-connect";
import { FacebookMediaConnect } from "./facebook-media-connect";
import { TikTokConnect } from "./tiktok-connect";
import { ProfileQR } from "./profile-qr";
import { BankIdStatus } from "./bankid-status";
import { CompanyStatus } from "./company-status";
import { BankIdResultToast } from "./bankid-result-toast";
import { isVenueRole } from "@/lib/roles";
import { BETA_MODE } from "@/lib/beta";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getConnectionState } from "@/lib/social/connection-state";

/** Finns tokenet OCH gäller det fortfarande? */
function isLive(token: string | null | undefined, expiresAt: string | null | undefined): boolean {
  const { status } = getConnectionState({
    hasToken: !!token,
    expiresAt: expiresAt ?? null,
  });
  return status === "connected" || status === "expiring_soon";
}

export default async function ProfilePage() {
  const t = await getTranslations("dashProfile.page");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: profile }, { data: socialConn }, { data: media }] = await Promise.all([
    // org_number är kolumn-låst för authenticated — egen rad via service-role.
    createAdminClient()
      .from("profiles")
      .select("id, full_name, slug, avatar_url, bio, website, category, location, hourly_rate, is_public, share_token, categories, locations, rates, websites, social_instagram, social_x, social_facebook, contact_email, contact_phone, terms_url, role, tier, whitelabel_enabled, whitelabel_brand_name, whitelabel_logo_url, whitelabel_primary_color, whitelabel_accent_color, whitelabel_accent_color_2, whitelabel_accent_color_3, creator_subcategory, dance_styles, dance_languages, dance_experience_years, offers_coaching, coaching_hourly_rate_sek, coaching_specialties, coaching_bio, bankid_verified_at, bankid_name, org_number, company_name, company_verified_at, is_company")
      .eq("id", user.id)
      .single(),
    supabase
      .from("social_connections")
      .select("instagram_user_id, instagram_username, instagram_access_token, instagram_token_expires_at, facebook_page_id, facebook_page_name, facebook_page_access_token, facebook_token_expires_at, tiktok_user_id, tiktok_username, tiktok_access_token, tiktok_token_expires_at, tiktok_refresh_token, tiktok_refresh_token_expires_at")
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("creator_media")
      .select("id, media_type, url, thumbnail_url, caption, sort_order, is_hero, section")
      .eq("user_id", user.id)
      .order("sort_order", { ascending: true }),
  ]);

  if (!profile) {
    redirect("/dashboard");
  }

  const isVenue = isVenueRole(profile.role);
  const isCreator = profile.role === "creator" || isVenue;
  // Company verification is available to venues and to creators who sell as a company.
  const showCompany = isVenue || profile.role === "creator" && !!(profile as { is_company?: boolean }).is_company;

  return (
    <>
      <Suspense fallback={null}>
        <BankIdResultToast />
      </Suspense>
      <div className="mb-8">
        <Link
          href="/dashboard"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--usha-muted)] transition-colors hover:text-[var(--usha-white)]"
        >
          <ArrowLeft size={14} />
          {t("back")}
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{t("title")}</h1>
            <p className="mt-1 text-[var(--usha-muted)]">
              {isCreator
                ? t("subtitleCreator")
                : t("subtitleCustomer")}
            </p>
          </div>
          {profile.slug && profile.is_public && (
            <Link
              href={`/creators/${profile.slug}`}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent,var(--usha-gold))] px-4 py-2.5 text-sm font-medium text-black transition hover:opacity-90"
            >
              <ExternalLink size={14} />
              {t("viewProfile")}
            </Link>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6 sm:p-8">
        <ProfileForm profile={profile} isPaidTier={BETA_MODE || profile.tier === 'guld' || profile.tier === 'premium'} isPremium={BETA_MODE || profile.tier === 'premium'} isCustomer={!isCreator} />
      </div>

      {showCompany && (
        <div className="mt-8">
          <CompanyStatus
            companyVerifiedAt={(profile as { company_verified_at?: string | null }).company_verified_at ?? null}
            companyName={(profile as { company_name?: string | null }).company_name ?? null}
            orgNumber={(profile as { org_number?: string | null }).org_number ?? null}
          />
        </div>
      )}

      <div className="mt-8">
        <BankIdStatus
          verifiedAt={(profile as { bankid_verified_at?: string | null }).bankid_verified_at ?? null}
          bankidName={(profile as { bankid_name?: string | null }).bankid_name ?? null}
          isCreatorRole={isCreator && !isVenue}
          profileRole={(profile as { role?: string | null }).role ?? null}
        />
      </div>

      {isCreator && (
        <>
          <div className="mt-8">
            <ProfileQR
              profileSlug={(profile as { slug?: string | null }).slug ?? null}
              profileId={profile.id}
              fullName={profile.full_name}
              isPublic={!!profile.is_public}
              shareToken={(profile as { share_token?: string | null }).share_token ?? null}
            />
          </div>
          {/* Ett utgånget token såg tidigare exakt ut som ett färskt här, så
              sidan visade grön badge för kopplingar som varit döda i veckor.
              isLive är falskt även när tokenet finns men slutat gälla, vilket
              gör att komponenten visar "anslut" i stället för att ljuga.
              Status och omkoppling bor numera i /app/settings/connections. */}
          <div className="mt-8 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6 sm:p-8">
            <InstagramConnect
              isConnected={isLive(socialConn?.instagram_access_token, socialConn?.instagram_token_expires_at)}
              instagramUsername={socialConn?.instagram_username}
            />
          </div>
          <div className="mt-8 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6 sm:p-8">
            <FacebookMediaConnect
              isConnected={isLive(socialConn?.facebook_page_access_token, socialConn?.facebook_token_expires_at)}
              pageName={socialConn?.facebook_page_name}
            />
          </div>
          <div className="mt-8 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6 sm:p-8">
            <TikTokConnect
              isConnected={isLive(
                socialConn?.tiktok_access_token,
                // Access-tokenet förnyas automatiskt; refresh-tokenet avgör.
                socialConn?.tiktok_refresh_token
                  ? socialConn?.tiktok_refresh_token_expires_at
                  : socialConn?.tiktok_token_expires_at
              )}
              tiktokUsername={socialConn?.tiktok_username}
            />
          </div>
          <div className="mt-4 text-center">
            <Link
              href="/app/settings/connections"
              className="inline-flex items-center gap-1 text-sm text-[var(--usha-gold)] hover:underline"
            >
              {t("manageConnections")}
              <ExternalLink size={14} />
            </Link>
          </div>
          <div className="mt-8 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6 sm:p-8">
            <MediaGallery userId={user.id} initialMedia={media || []} />
          </div>
        </>
      )}
    </>
  );
}
