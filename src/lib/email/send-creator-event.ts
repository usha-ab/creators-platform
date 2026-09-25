import { createElement } from "react";
import { getResend, getFromEmail } from "./resend";
import { renderEmailToHtml } from "./render";
import CreatorEventAnnouncement, { getCreatorEventSubject } from "@/components/emails/CreatorEventAnnouncement";
import { getEmailIntl } from "./i18n";
import { resolveRecipientLocale } from "@/lib/i18n/recipient";

interface SendCreatorEventParams {
  to: string;
  followerName: string;
  creatorName: string;
  eventTitle: string;
  eventDate?: Date;
  location?: string;
  eventUrl: string;
  /** Follower's account, so the mail matches the language they read the app in. */
  followerId?: string | null;
  /** Följare utan konto: avslutalänk i mejlet. */
  unsubscribeUrl?: string;
  /** Språk sparat vid följningen (följare utan konto). */
  preferredLocale?: string | null;
}

export async function sendCreatorEventEmail({
  to,
  followerName,
  creatorName,
  eventTitle,
  eventDate,
  location,
  eventUrl,
  followerId,
  unsubscribeUrl,
  preferredLocale,
}: SendCreatorEventParams): Promise<void> {
  try {
    const resend = getResend();
    const { t, locale } = await getEmailIntl(await resolveRecipientLocale({ userId: followerId, email: to, preferred: preferredLocale }));
    const html = await renderEmailToHtml(
      createElement(CreatorEventAnnouncement, { followerName, creatorName, eventTitle, eventDate, location, eventUrl, unsubscribeUrl, t, locale })
    );

    const { error } = await resend.emails.send({
      from: getFromEmail(),
      to,
      subject: getCreatorEventSubject(t, creatorName, eventTitle),
      html,
    });

    if (error) {
      console.error("Failed to send creator event email:", error);
    } else {
      console.log(`Creator event email sent to ${to}`);
    }
  } catch (e) {
    console.error("Email send error (creator event):", e);
  }
}
