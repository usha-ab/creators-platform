import { createElement } from "react";
import { getResend, getFromEmail } from "./resend";
import { renderEmailToHtml } from "./render";
import FollowConfirm, { getFollowConfirmSubject } from "@/components/emails/FollowConfirm";
import { getEmailIntl } from "./i18n";
import { resolveRecipientLocale } from "@/lib/i18n/recipient";

/** Bekräftelsemejlet för "följ via e-post" från eventsidan (dubbel opt-in). */
export async function sendFollowConfirmEmail({
  to,
  creatorName,
  confirmUrl,
  locale,
}: {
  to: string;
  creatorName: string;
  confirmUrl: string;
  locale?: string | null;
}): Promise<void> {
  const resend = getResend();
  const { t, locale: l } = await getEmailIntl(await resolveRecipientLocale({ email: to, preferred: locale }));
  const html = await renderEmailToHtml(createElement(FollowConfirm, { creatorName, confirmUrl, t, locale: l }));
  const { error } = await resend.emails.send({
    from: getFromEmail(),
    to,
    subject: getFollowConfirmSubject(t, creatorName),
    html,
  });
  if (error) {
    console.error("Failed to send follow confirm email:", error);
    throw new Error(`Email send failed: ${error.message}`);
  }
}
