import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Calendar, MapPin, AlertCircle } from "lucide-react";
import { JoinEventButton } from "../join-event-button";
import { isCreatorRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

const INSTRUCTOR_TIERS = ["guld", "premium"];

export default async function OpenEventsPage() {
  const t = await getTranslations("openEvents");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const today = new Date().toISOString().slice(0, 10);

  const [{ data: profile }, { data: events }, { data: joinedRows }] = await Promise.all([
    // stripe_account_id är kolumn-låst för authenticated — egen rad via service-role.
    createAdminClient()
      .from("profiles")
      .select("role, tier, offers_coaching, coaching_hourly_rate_sek, stripe_account_id")
      .eq("id", user.id)
      .single(),
    supabase
      .from("listings")
      .select("id, title, slug, event_date, event_time, event_location, image_url, user_id")
      .eq("is_active", true)
      .eq("open_to_instructors", true)
      .gte("event_date", today)
      .order("event_date", { ascending: true }),
    supabase.from("event_instructors").select("listing_id").eq("instructor_id", user.id),
  ]);

  const joined = new Set((joinedRows ?? []).map((r) => r.listing_id));

  // Eligibility — what's blocking the user from offering services (if anything).
  const missing: { label: string; href: string }[] = [];
  if (!profile || !isCreatorRole(profile.role)) {
    missing.push({ label: t("missingCreator"), href: "/dashboard/profile" });
  }
  if (!profile || !INSTRUCTOR_TIERS.includes(profile.tier)) {
    missing.push({ label: t("missingSubscription"), href: "/dashboard/billing" });
  }
  if (!profile?.offers_coaching || !profile?.coaching_hourly_rate_sek) {
    missing.push({ label: t("missingCoaching"), href: "/dashboard/profile" });
  }
  if (!profile?.stripe_account_id) {
    missing.push({ label: t("missingStripe"), href: "/dashboard/payouts" });
  }
  const eligible = missing.length === 0;

  return (
    <div className="px-4 py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/app/events"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--usha-border)] text-[var(--usha-muted)] hover:text-[var(--usha-white)]"
        >
          <ArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="text-xl font-bold">{t("title")}</h1>
          <p className="text-sm text-[var(--usha-muted)]">
            {t("subtitle")}
          </p>
        </div>
      </div>

      {!eligible && (
        <div className="rounded-xl border border-[var(--usha-gold)]/30 bg-[var(--usha-gold)]/5 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--usha-gold)]">
            <AlertCircle size={16} />
            {t("eligibilityHeading")}
          </div>
          <ul className="space-y-1.5 text-sm text-[var(--usha-muted)]">
            {missing.map((m) => (
              <li key={m.label}>
                <Link href={m.href} className="underline hover:text-[var(--usha-white)]">
                  {m.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!events?.length ? (
        <p className="rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6 text-center text-sm text-[var(--usha-muted)]">
          {t("emptyState")}
        </p>
      ) : (
        <div className="space-y-3">
          {events.map((e) => {
            const isOwn = e.user_id === user.id;
            return (
              <div
                key={e.id}
                className="relative flex flex-col gap-3 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4 transition hover:border-[var(--usha-gold)]/30 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  {/* Hela kortet är träffytan, inte bara titeln. Se
                      kommentaren i events-content.tsx. */}
                  <Link
                    href={`/listing/${e.slug || e.id}`}
                    className="font-semibold after:absolute after:inset-0 after:z-0 after:content-[''] hover:underline"
                  >
                    {e.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--usha-muted)]">
                    {e.event_date && (
                      <span className="flex items-center gap-1">
                        <Calendar size={12} className="text-[var(--usha-gold)]" />
                        {new Date(e.event_date + "T00:00").toLocaleDateString("sv-SE", { day: "numeric", month: "short", year: "numeric" })}
                        {e.event_time && ` · ${e.event_time.slice(0, 5)}`}
                      </span>
                    )}
                    {e.event_location && (
                      <span className="flex items-center gap-1">
                        <MapPin size={12} className="text-[var(--usha-gold)]" />
                        {e.event_location}
                      </span>
                    )}
                  </div>
                </div>
                <div className="relative z-10 shrink-0">
                  {isOwn ? (
                    <span className="text-xs text-[var(--usha-muted)]">{t("ownEvent")}</span>
                  ) : eligible ? (
                    <JoinEventButton listingId={e.id} initialJoined={joined.has(e.id)} />
                  ) : (
                    <span className="text-xs text-[var(--usha-muted)]">{t("meetRequirements")}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
