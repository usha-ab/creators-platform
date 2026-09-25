import { createElement } from 'react';
import { getResend, getFromEmail } from './resend';
import { renderEmailToHtml } from './render';
import WelcomeCredit, { getWelcomeCreditSubject } from '@/components/emails/WelcomeCredit';
import { getEmailIntl } from './i18n';
import { resolveRecipientLocale } from '@/lib/i18n/recipient';

interface SendWelcomeCreditParams {
  to: string;
  recipientName: string;
  /** Avdragets storlek i kronor. */
  amount: number;
  /** Lägsta ordersumma i kronor. */
  minSpend: number;
  expiresAt: Date;
  /** Mottagarens konto, så mejlet får samma språk som appen. */
  userId?: string | null;
}

/**
 * Berättar för en kontoinnehavare att avdraget finns.
 *
 * Avdraget delas ut av en databastrigger och syns annars först i kassan, på
 * köp över gränsen. Utan det här mejlet är det alltså en förmån som bara den
 * upptäcker som ändå tänkte handla.
 */
export async function sendWelcomeCreditEmail({
  to,
  recipientName,
  amount,
  minSpend,
  expiresAt,
  userId,
}: SendWelcomeCreditParams): Promise<void> {
  const resend = getResend();
  const { t, locale } = await getEmailIntl(await resolveRecipientLocale({ userId, email: to }));

  const html = await renderEmailToHtml(
    createElement(WelcomeCredit, { recipientName, amount, minSpend, expiresAt, t, locale })
  );

  const { error } = await resend.emails.send({
    from: getFromEmail(),
    to,
    subject: getWelcomeCreditSubject(t, amount),
    html,
  });

  if (error) {
    console.error('Failed to send welcome credit email:', error);
    throw new Error(`Email send failed: ${error.message}`);
  }
}
