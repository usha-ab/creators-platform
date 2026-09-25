import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, CalendarDays, MapPin, Clock, ShieldCheck, CalendarPlus } from "lucide-react";
import { FollowButton } from "@/components/follow-button";
import type { Metadata } from "next";
import { notIndexable } from "@/lib/seo/metadata";

export const revalidate = 60;

interface Props {
  params: Promise<{ id: string }>;
}

function isUUID(str: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const supabase = await createClient();
  const column = isUUID(params.id) ? "id" : "slug";
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq(column, params.id)
    .eq("is_public", true)
    .single();
  return { title: `${profile?.full_name || "Kreatör"}s kalender – Usha Platform`, ...notIndexable() };
}

export default async function CreatorCalendarPage(props: Props) {
  const params = await props.params;
  const supabase = await createClient();
  const column = isUUID(params.id) ? "id" : "slug";

  const [{ data: profile }, { data: { user } }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, avatar_url, slug, bankid_verified_at")
      .eq(column, params.id)
      .eq("is_public", true)
      .single(),
    supabase.auth.getUser(),
  ]);

  if (!profile) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const [{ data: events }, { count: followerCount }, { data: isFollowingData }] = await Promise.all([
    supabase
      .from("listings")
      .select("id, title, event_date, event_time, event_location")
      .eq("user_id", profile.id)
      .eq("is_active", true)
      .eq("is_public", true)
      .eq("listing_type", "event")
      .gte("event_date", today)
      .order("event_date", { ascending: true }),
    supabase.from("follows").select("id", { count: "exact", head: true }).eq("followed_id", profile.id),
    user
      ? supabase.from("follows").select("id").eq("follower_id", user.id).eq("followed_id", profile.id).single()
      : Promise.resolve({ data: null }),
  ]);

  const profileHref = `/creators/${profile.slug || profile.id}`;
  const icsHref = `/api/creators/${profile.slug || profile.id}/calendar`;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href={profileHref} className="mb-6 inline-flex items-center gap-1.5 text-sm text-[var(--usha-muted)] transition-colors hover:text-[var(--usha-white)]">
        <ArrowLeft size={14} />
        Tillbaka till profilen
      </Link>

      <div className="mb-8 flex items-center gap-4">
        {profile.avatar_url ? (
          <Image src={profile.avatar_url} alt={profile.full_name || "Kreatör"} width={64} height={64} className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--usha-card)] text-xl font-bold text-[var(--usha-gold)]">
            {(profile.full_name || "U").charAt(0)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-bold">{profile.full_name || "Kreatör"}</h1>
            {profile.bankid_verified_at && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-green-400">
                <ShieldCheck size={12} /> BankID
              </span>
            )}
          </div>
          <p className="text-sm text-[var(--usha-muted)]">Kommande event</p>
        </div>
        <FollowButton
          creatorId={profile.id}
          initialFollowing={!!isFollowingData}
          followerCount={followerCount ?? 0}
          isLoggedIn={!!user}
        />
      </div>

      <a
        href={icsHref}
        className="mb-8 inline-flex items-center gap-2 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-2.5 text-sm font-medium text-[var(--usha-white)] transition hover:border-[var(--usha-gold)]/50"
      >
        <CalendarPlus size={16} className="text-[var(--usha-gold)]" />
        Prenumerera i din kalender
      </a>

      {!events?.length ? (
        <div className="rounded-2xl border border-dashed border-[var(--usha-border)] bg-[var(--usha-card)] p-10 text-center">
          <CalendarDays size={36} className="mx-auto mb-4 text-[var(--usha-muted)]" />
          <p className="text-sm text-[var(--usha-muted)]">Inga kommande event just nu. Följ för att få en notis när nästa läggs upp.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {events.map((e) => {
            const date = new Date(e.event_date + "T00:00");
            return (
              <li key={e.id}>
                <Link
                  href={`/listing/${e.id}`}
                  className="flex items-center gap-4 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4 transition hover:border-[var(--usha-gold)]/50"
                >
                  <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-[var(--usha-gold)]/10 text-[var(--usha-gold)]">
                    <span className="text-lg font-bold leading-none">{date.toLocaleDateString("sv-SE", { day: "numeric" })}</span>
                    <span className="text-[11px] uppercase">{date.toLocaleDateString("sv-SE", { month: "short" })}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-[var(--usha-white)]">{e.title}</p>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--usha-muted)]">
                      {e.event_time && (
                        <span className="inline-flex items-center gap-1"><Clock size={12} /> {e.event_time}</span>
                      )}
                      {e.event_location && (
                        <span className="inline-flex items-center gap-1"><MapPin size={12} /> {e.event_location}</span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
