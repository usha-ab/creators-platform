import type { SupabaseClient } from "@supabase/supabase-js";
import { getTranslations, getLocale } from "next-intl/server";
import { getResend, getFromEmail } from "@/lib/email/resend";
import { escapeHtml, chunk } from "@/lib/email/broadcast";
import { getSaleState, isPastEvent } from "@/lib/listings/sale-state";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://usha.se";

// Resend batch send caps at 100 messages per call; mirror the broadcast pacing.
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 600;
// Safety cap per listing per run; the remainder is picked up on the next run
// (rows stay released_notified_at = null until they're actually emailed).
const RELEASE_BATCH_LIMIT = 500;

type ReleaseEntry = { id: string; name: string | null; email: string; unsubscribe_token: string };

function buildReleaseHtml(
  t: Awaited<ReturnType<typeof getTranslations>>,
  listing: { title: string; slug: string | null; id: string },
  entry: ReleaseEntry
): string {
  // Interpolate the raw title; the single escapeHtml() on the rendered string
  // escapes it exactly once (pre-escaping would double-encode "&").
  const eventUrl = `${APP_URL}/event/${listing.slug ?? listing.id}`;
  const unsubUrl = `${APP_URL}/waitlist/unsubscribe/${entry.unsubscribe_token}`;
  return `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111;">
  <h2 style="color:#c8a445;">${escapeHtml(t("releaseHeading"))}</h2>
  <p style="font-size:15px;line-height:1.6;">${escapeHtml(t("releaseBody", { title: listing.title }))}</p>
  <p style="margin:24px 0;">
    <a href="${escapeHtml(eventUrl)}" style="background:#c8a445;color:#111;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold;display:inline-block;">${escapeHtml(t("releaseCta"))}</a>
  </p>
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0 12px;">
  <p style="color:#999;font-size:12px;line-height:1.5;">
    ${escapeHtml(t("confirmFooter"))}<br>
    <a href="${escapeHtml(unsubUrl)}" style="color:#999;">${escapeHtml(t("confirmUnsub"))}</a>
  </p>
</div>`;
}

/**
 * Tickets for an event were released / went on sale. Email everyone on its
 * waitlist who hasn't yet been told — fulfilling the promise made in the
 * waitlist confirmation email. Marks each row release-notified BEFORE sending
 * so a retry/concurrent run can't double-email. No-op unless the event is
 * active and actually buyable right now (we don't announce a sale that isn't
 * real — same principle as the seat-freed notifier). Never throws into the
 * caller; returns how many were emailed.
 */
export async function notifyWaitlistReleased(
  admin: SupabaseClient,
  listingId: string
): Promise<{ sent: number }> {
  let sent = 0;
  try {
    const { data: listing } = await admin
      .from("listings")
      .select(
        "id, title, slug, price, early_bird_start, early_bird_end, early_bird_price, public_sale_at, capacity, tickets_sold, is_active, event_date, event_time, event_end_time, content_language"
      )
      .eq("id", listingId)
      .maybeSingle();
    if (!listing) return { sent: 0 };

    // Guardrails: only announce for a published event that is buyable now and
    // has not already happened.
    if (listing.is_active !== true) return { sent: 0 };
    const now = new Date();
    if (!getSaleState(listing, now).buyable) return { sent: 0 };
    // Samma kvällsslut som köpet (evening.ts). Den gamla jämförelsen mot
    // UTC-datumet stängde redan 01–02 svensk tid, mitt under kvällen.
    if (isPastEvent(listing.event_date, now, listing)) return { sent: 0 };

    const { data: entries } = await admin
      .from("event_waitlist")
      .select("id, name, email, unsubscribe_token")
      .eq("listing_id", listingId)
      .is("unsubscribed_at", null)
      .is("released_notified_at", null)
      .order("created_at", { ascending: true })
      .limit(RELEASE_BATCH_LIMIT);
    if (!entries?.length) return { sent: 0 };

    const lang =
      listing.content_language === "en" || listing.content_language === "sv"
        ? listing.content_language
        : await getLocale();
    const t = await getTranslations({ locale: lang, namespace: "eventEmails" });
    const from = getFromEmail();
    const subject = t("releaseSubject", { title: listing.title });

    for (const group of chunk(entries as ReleaseEntry[], BATCH_SIZE)) {
      // Mark first (idempotency): a retry or concurrent run can't re-email these.
      await admin
        .from("event_waitlist")
        .update({ released_notified_at: new Date().toISOString() })
        .in(
          "id",
          group.map((e) => e.id)
        );

      const payload = group.map((e) => ({
        from,
        to: e.email,
        subject,
        html: buildReleaseHtml(t, listing, e),
      }));

      const { error } = await getResend().batch.send(payload);
      if (error) {
        console.error("waitlist release batch error:", error);
      } else {
        sent += group.length;
      }

      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  } catch (err) {
    console.error("notifyWaitlistReleased failed:", err);
  }
  return { sent };
}
