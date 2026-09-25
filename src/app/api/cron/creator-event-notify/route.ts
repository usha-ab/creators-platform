import { NextRequest, NextResponse } from "next/server";
import { activeEmailFollowers } from "@/lib/follows/email-follow";
import { verifyCronAuth } from "@/lib/cron/auth";
import { createClient } from "@supabase/supabase-js";
import { sendCreatorEventEmail } from "@/lib/email/send-creator-event";
import { shouldSendEmail } from "@/lib/email/check-preferences";
import { buildNotifyAudience } from "@/lib/venues/audience";

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Cron job: when a creator posts a new event, email their followers.
 * Scans active event listings created in the last 3 days (recency guard so the
 * first run doesn't blast historical events), not yet announced. Idempotent via
 * listings.followers_notified_at. Triggered hourly by GitHub Actions (Vercel
 * Hobby caps crons at once/day).
 */
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://usha.se";
  const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  const { data: listings } = await admin
    .from("listings")
    .select("id, user_id, title, event_date, event_location, venue_profile_id, venue_confirmed_at")
    .eq("listing_type", "event")
    .eq("is_active", true)
    .is("followers_notified_at", null)
    .gte("created_at", cutoff);

  if (!listings?.length) return NextResponse.json({ listings: 0, notified: 0 });

  let notified = 0;
  let emailNotified = 0;

  for (const listing of listings) {
    // Claim the listing up front (mark BEFORE emailing) so a function timeout or
    // an overlapping cron run can't re-scan it and email the whole follower list
    // twice. Only the run that flips followers_notified_at from NULL proceeds.
    const { data: claimed } = await admin
      .from("listings")
      .update({ followers_notified_at: new Date().toISOString() })
      .eq("id", listing.id)
      .is("followers_notified_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const { data: creator } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", listing.user_id)
      .single();

    const accountEmails = new Set<string>();
    const { data: followers } = await admin
      .from("follows")
      .select("follower_id")
      .eq("followed_id", listing.user_id);

    const audience = buildNotifyAudience({
      creatorFollowers: (followers ?? []).map((f) => f.follower_id),
      creatorId: listing.user_id,
    });

    for (const followerId of audience) {
      if (!(await shouldSendEmail(followerId, "notif_creator_events"))) continue;
      const { data: fp } = await admin
        .from("profiles")
        .select("email, full_name")
        .eq("id", followerId)
        .single();
      if (!fp?.email) continue;
      accountEmails.add(fp.email.toLowerCase());

      try {
        await sendCreatorEventEmail({
          to: fp.email,
          followerName: fp.full_name || "där",
          creatorName: creator?.full_name || "En kreatör",
          eventTitle: listing.title || "Nytt event",
          eventDate: listing.event_date ? new Date(listing.event_date) : undefined,
          location: listing.event_location || undefined,
          eventUrl: `${appUrl}/listing/${listing.id}`,
          followerId,
        });
        notified++;
      } catch (err) {
        console.error(`Creator event notify failed for follower ${followerId}:`, err);
      }
    }

    // Följare utan konto (biljettköpare som sagt ja, eller bekräftat via mejl).
    emailNotified += await notifyEmailFollowers({
      admin,
      followedId: listing.user_id,
      skipEmails: accountEmails,
      creatorName: creator?.full_name || "En kreatör",
      listing,
      appUrl,
    });

    // (Already marked notified up front — the claim above prevents re-scan.)
  }

  // ---- Andra omgången: lokalens följare ------------------------------------
  //
  // Egen omgång med egen stämpel, eftersom lokalens godkännande nästan alltid
  // kommer EFTER att arrangörens följare redan fått besked. Slogs de ihop blev
  // evenemanget stämplat vid första körningen och lokalens följare fick aldrig
  // veta något — vilket var hela poängen med kopplingen.
  const { data: venueListings } = await admin
    .from("listings")
    .select("id, user_id, title, event_date, event_location, venue_profile_id")
    .eq("listing_type", "event")
    .eq("is_active", true)
    .not("venue_profile_id", "is", null)
    .not("venue_confirmed_at", "is", null)
    .is("venue_followers_notified_at", null);

  let venueNotified = 0;
  let venueEmailNotified = 0;

  for (const listing of venueListings ?? []) {
    // Claima före utskick, som ovan: en timeout eller överlappande körning ska
    // inte kunna mejla samma följarlista två gånger.
    const { data: claimed } = await admin
      .from("listings")
      .update({ venue_followers_notified_at: new Date().toISOString() })
      .eq("id", listing.id)
      .is("venue_followers_notified_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const [{ data: venue }, { data: creator }, { data: vf }] = await Promise.all([
      admin.from("profiles").select("full_name, company_name").eq("id", listing.venue_profile_id).maybeSingle(),
      admin.from("profiles").select("full_name").eq("id", listing.user_id).maybeSingle(),
      admin.from("follows").select("follower_id").eq("followed_id", listing.venue_profile_id),
    ]);

    // Arrangörens egna följare fick redan besked i första omgången. Den som
    // följer båda ska inte få två mejl om samma kväll.
    const { data: cf } = await admin
      .from("follows")
      .select("follower_id")
      .eq("followed_id", listing.user_id);
    const redanNotifierade = new Set((cf ?? []).map((f) => f.follower_id));

    const audience = buildNotifyAudience({
      creatorFollowers: [],
      venueFollowers: (vf ?? []).map((f) => f.follower_id).filter((id) => !redanNotifierade.has(id)),
      creatorId: listing.user_id,
      venueId: listing.venue_profile_id,
    });

    const accountEmails = new Set<string>();
    const venueName = (venue?.company_name || venue?.full_name || "").trim();

    for (const followerId of audience) {
      if (!(await shouldSendEmail(followerId, "notif_creator_events"))) continue;
      const { data: fp } = await admin
        .from("profiles")
        .select("email, full_name")
        .eq("id", followerId)
        .single();
      if (!fp?.email) continue;
      accountEmails.add(fp.email.toLowerCase());

      try {
        await sendCreatorEventEmail({
          to: fp.email,
          followerName: fp.full_name || "där",
          // Mejlet kommer för att man följer LOKALEN, så det är lokalens namn
          // mottagaren känner igen. Arrangören står i texten via titeln.
          creatorName: venueName || creator?.full_name || "En lokal",
          eventTitle: listing.title || "Nytt event",
          eventDate: listing.event_date ? new Date(listing.event_date) : undefined,
          location: listing.event_location || undefined,
          eventUrl: `${appUrl}/listing/${listing.id}`,
          followerId,
        });
        venueNotified++;
      } catch (err) {
        console.error(`Venue event notify failed for follower ${followerId}:`, err);
      }
    }

    // Lokalens e-postföljare, minus de som redan fick kvällen via arrangören.
    for (const ef of await activeEmailFollowers(admin, listing.user_id)) accountEmails.add(ef.email);
    venueEmailNotified += await notifyEmailFollowers({
      admin,
      followedId: listing.venue_profile_id,
      skipEmails: accountEmails,
      creatorName: venueName || creator?.full_name || "En lokal",
      listing,
      appUrl,
    });
  }

  return NextResponse.json({
    listings: listings.length,
    notified,
    venueListings: venueListings?.length ?? 0,
    venueNotified,
    emailNotified,
    venueEmailNotified,
  });
}

/**
 * Mejlar de som följer utan konto. Hoppar över adresser som redan fått
 * kvällen som kontoföljare, så ingen får samma mejl två gånger. Varje mejl
 * bär sin egen avslutalänk.
 */
async function notifyEmailFollowers(opts: {
  admin: ReturnType<typeof getSupabaseAdmin>;
  followedId: string;
  skipEmails: Set<string>;
  creatorName: string;
  listing: { id: string; title: string | null; event_date: string | null; event_location: string | null };
  appUrl: string;
}): Promise<number> {
  const { admin, followedId, skipEmails, creatorName, listing, appUrl } = opts;
  let sent = 0;
  for (const ef of await activeEmailFollowers(admin, followedId)) {
    if (skipEmails.has(ef.email)) continue;
    try {
      await sendCreatorEventEmail({
        to: ef.email,
        followerName: "",
        creatorName,
        eventTitle: listing.title || "Nytt event",
        eventDate: listing.event_date ? new Date(listing.event_date) : undefined,
        location: listing.event_location || undefined,
        eventUrl: `${appUrl}/listing/${listing.id}`,
        followerId: null,
        unsubscribeUrl: `${appUrl}/folj/avsluta/${ef.unsubscribe_token}`,
        preferredLocale: ef.locale,
      });
      sent++;
    } catch (err) {
      console.error(`Email follower notify failed for ${ef.email}:`, err);
    }
  }
  return sent;
}
