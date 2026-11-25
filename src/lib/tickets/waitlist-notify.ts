import type { SupabaseClient } from "@supabase/supabase-js";
import { getResend, getFromEmail } from "@/lib/email/resend";
import { escapeHtml } from "@/lib/email/broadcast";
import { getSaleState } from "@/lib/listings/sale-state";
import { getServerTranslator } from "@/lib/i18n/server";
import { resolveRecipientLocale } from "@/lib/i18n/recipient";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://usha.se";

async function sendSeatOpenedEmail(opts: {
  to: string;
  name: string | null;
  title: string;
  slug: string | null;
  token: string;
  /** The event's forced language, when it has one. */
  contentLanguage: string | null;
}) {
  // Waitlist entries are guests with no account, so the event's own language
  // decides — the same rule the waitlist confirmation follows. Failing that,
  // the address may still belong to a member whose language we know.
  const locale = await resolveRecipientLocale({
    preferred: opts.contentLanguage,
    email: opts.to,
  });
  const t = await getServerTranslator("eventEmails", locale);

  const eventUrl = `${APP_URL}/event/${opts.slug ?? ""}`;
  const unsubUrl = `${APP_URL}/waitlist/unsubscribe/${opts.token}`;
  // Interpolate raw values; the single escapeHtml() on each rendered string
  // escapes them exactly once (pre-escaping would double-encode "&").
  const hi = opts.name
    ? t("seatOpenedGreeting", { name: opts.name })
    : t("seatOpenedGreetingAnon");
  const html = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111;">
  <h2 style="color:#c8a445;">${escapeHtml(t("seatOpenedHeading"))}</h2>
  <p style="font-size:15px;line-height:1.6;">${escapeHtml(hi)}</p>
  <p style="font-size:15px;line-height:1.6;">${escapeHtml(t("seatOpenedBody", { title: opts.title }))}</p>
  <p style="margin:24px 0;">
    <a href="${escapeHtml(eventUrl)}" style="background:#c8a445;color:#111;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold;display:inline-block;">${escapeHtml(t("seatOpenedCta"))}</a>
  </p>
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0 12px;">
  <p style="color:#999;font-size:12px;line-height:1.5;">
    ${escapeHtml(t("seatOpenedFooter"))}<br>
    <a href="${escapeHtml(unsubUrl)}" style="color:#999;">${escapeHtml(t("confirmUnsub"))}</a>
  </p>
</div>`;

  await getResend().emails.send({
    from: getFromEmail(),
    to: opts.to,
    subject: t("seatOpenedSubject", { title: opts.title }),
    html,
  });
}

/**
 * A refund/cancellation freed `seats` seat(s) on an event. If the event is now
 * buyable again (sale window open + room), email the oldest not-yet-notified
 * people on its waitlist — one per freed seat — and mark them notified so the
 * next cancellation walks further down the FIFO list. No-op if the event is
 * still sold out or not yet on sale (we don't promise a spot that isn't real).
 * Best-effort: never throws into the caller.
 */
export async function notifyWaitlistSeatFreed(
  admin: SupabaseClient,
  listingId: string,
  seats: number
): Promise<void> {
  try {
    const { data: listing } = await admin
      .from("listings")
      .select(
        "id, title, slug, price, early_bird_start, early_bird_end, early_bird_price, public_sale_at, capacity, tickets_sold, event_date, event_time, event_end_time, content_language"
      )
      .eq("id", listingId)
      .maybeSingle();
    if (!listing) return;

    // Only reach out if a real, buyable spot now exists.
    const sale = getSaleState(listing, new Date());
    if (!sale.buyable) return;

    const { data: entries } = await admin
      .from("event_waitlist")
      .select("id, name, email, unsubscribe_token")
      .eq("listing_id", listingId)
      .is("unsubscribed_at", null)
      .is("notified_at", null)
      .order("created_at", { ascending: true })
      .limit(Math.max(1, seats));

    for (const e of entries ?? []) {
      // Mark first so a retry/concurrent run can't double-email the same person.
      await admin.from("event_waitlist").update({ notified_at: new Date().toISOString() }).eq("id", e.id);
      await sendSeatOpenedEmail({
        to: e.email,
        name: e.name,
        title: listing.title,
        slug: listing.slug,
        token: e.unsubscribe_token,
        contentLanguage: listing.content_language,
      }).catch((err) => console.error("waitlist seat-opened email failed:", err));
    }
  } catch (err) {
    console.error("notifyWaitlistSeatFreed failed:", err);
  }
}
