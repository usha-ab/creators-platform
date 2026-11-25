import { createElement } from "react";
import { getResend, getFromEmail } from "./resend";
import { renderEmailToHtml } from "./render";
import SwishPending, { getSwishPendingSubject } from "@/components/emails/SwishPending";
import { getEmailIntl } from "./i18n";
import { resolveRecipientLocale } from "@/lib/i18n/recipient";

interface SendSwishPendingParams {
  to: string;
  customerName: string;
  serviceName: string;
  scheduledAt: Date;
  amountSek: number;
  swishNumber: string;
  swishMessage: string;
  swishUrl: string;
  bookingId: string;
  /** Swish Handel: betala på biljettsidan i stället för till numret. */
  commerce?: boolean;
  customerId?: string | null;
  /** Sidans språk när gästen registrerade sig: en gäst utan konto har inget annat. */
  preferredLocale?: string | null;
}

/**
 * "Du har valt Swish, så här får du biljetten." Går i samma sekund som
 * gästen registrerar sig på eventsidan, så att hen har något i handen innan
 * betalningen är bekräftad. Biljetten med QR-kod kommer i ett eget mejl.
 */
export async function sendSwishPendingEmail(p: SendSwishPendingParams): Promise<void> {
  try {
    const resend = getResend();
    const { t, locale } = await getEmailIntl(await resolveRecipientLocale({ userId: p.customerId, email: p.to, preferred: p.preferredLocale }));
    const html = await renderEmailToHtml(
      createElement(SwishPending, {
        customerName: p.customerName,
        serviceName: p.serviceName,
        scheduledAt: p.scheduledAt,
        amountSek: p.amountSek,
        swishNumber: p.swishNumber,
        swishMessage: p.swishMessage,
        swishUrl: p.swishUrl,
        bookingId: p.bookingId,
        commerce: p.commerce ?? false,
        t,
        locale,
      })
    );
    const { error } = await resend.emails.send({
      from: getFromEmail(),
      to: p.to,
      subject: getSwishPendingSubject(t, p.serviceName, p.amountSek),
      html,
    });
    if (error) console.error("Failed to send Swish pending email:", error);
  } catch (e) {
    console.error("Email send error (swish pending):", e);
  }
}
