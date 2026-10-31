import { createElement } from "react";
import { getResend, getFromEmail } from "./resend";
import { renderEmailToHtml } from "./render";
import SignupCode, { getSignupCodeSubject } from "@/components/emails/SignupCode";
import { getEmailIntl } from "./i18n";
import { resolveRecipientLocale } from "@/lib/i18n/recipient";

/** Koden som bekräftar e-postadressen när ett konto skapas med BankID. */
export async function sendSignupCodeEmail({
  to,
  code,
  locale,
}: {
  to: string;
  code: string;
  locale?: string | null;
}): Promise<void> {
  const resend = getResend();
  const { t, locale: l } = await getEmailIntl(await resolveRecipientLocale({ email: to, preferred: locale }));
  const html = await renderEmailToHtml(createElement(SignupCode, { code, t, locale: l }));
  const { error } = await resend.emails.send({
    from: getFromEmail(),
    to,
    subject: getSignupCodeSubject(t, code),
    html,
  });
  if (error) {
    console.error("Failed to send signup code email:", error);
    throw new Error(`Email send failed: ${error.message}`);
  }
}
