import { createElement } from "react";
import { getResend, getFromEmail } from "./resend";
import { renderEmailToHtml } from "./render";
import { buildBookingIcs } from "./ics";
import BookingConfirmation, { getBookingConfirmationSubject } from "@/components/emails/BookingConfirmation";
import BookingCancellation, { getBookingCancellationSubject } from "@/components/emails/BookingCancellation";
import { getEmailIntl } from "./i18n";
import { resolveRecipientLocale } from "@/lib/i18n/recipient";

interface SendBookingConfirmationParams {
  to: string;
  customerName: string;
  serviceName: string;
  scheduledAt: Date;
  scheduledEndAt?: Date;
  creatorName: string;
  location?: string;
  bookingId?: string;
  durationMinutes?: number;
  /** Legal seller for the receipt (org.nr / name + VAT note). */
  seller?: { name: string; orgNumber?: string; vatNote?: string };
  /** Vad köparen betalade, i ÖREN. 0 = gratis. Utelämnas när vägen inte vet. */
  amountOre?: number | null;
  /** Klippkort: sista giltighetsdag, skrivs på kvittot med förfallet. */
  passValidUntil?: Date | null;
  /**
   * Buyer's account when they have one. Guests are booked by email alone and
   * fall back to whatever the address resolves to, then English.
   */
  customerId?: string | null;
}

export async function sendBookingConfirmationEmail({
  to,
  customerName,
  serviceName,
  scheduledAt,
  scheduledEndAt,
  creatorName,
  location,
  bookingId,
  durationMinutes,
  seller,
  amountOre,
  passValidUntil,
  customerId,
}: SendBookingConfirmationParams): Promise<void> {
  try {
    const resend = getResend();
    const { t, locale } = await getEmailIntl(await resolveRecipientLocale({ userId: customerId, email: to }));
    const html = await renderEmailToHtml(
      createElement(BookingConfirmation, { customerName, serviceName, scheduledAt, scheduledEndAt, creatorName, location, bookingId, seller, amountOre, passValidUntil, t, locale })
    );

    const ics = buildBookingIcs({
      uid: `${bookingId ?? scheduledAt.getTime()}@usha.se`,
      title: serviceName,
      startsAt: scheduledAt,
      durationMinutes,
      location,
      description: t("reminderIcsDescription", { creator: creatorName }),
    });

    const { error } = await resend.emails.send({
      from: getFromEmail(),
      to,
      subject: getBookingConfirmationSubject(t, serviceName),
      html,
      attachments: [{ filename: "usha-bokning.ics", content: Buffer.from(ics) }],
    });

    if (error) {
      console.error("Failed to send booking confirmation email:", error);
    } else {
      console.log(`Booking confirmation email sent to ${to}`);
    }
  } catch (e) {
    console.error("Email send error (booking confirmation):", e);
  }
}

interface SendBookingCancellationParams {
  to: string;
  recipientName: string;
  serviceName: string;
  scheduledAt: Date;
  /** Recipient's account when they have one; guests resolve by address. */
  recipientId?: string | null;
}

export async function sendBookingCancellationEmail({
  to,
  recipientName,
  serviceName,
  scheduledAt,
  recipientId,
}: SendBookingCancellationParams): Promise<void> {
  try {
    const resend = getResend();
    const { t, locale } = await getEmailIntl(await resolveRecipientLocale({ userId: recipientId, email: to }));
    const html = await renderEmailToHtml(
      createElement(BookingCancellation, { recipientName, serviceName, scheduledAt, t, locale })
    );

    const { error } = await resend.emails.send({
      from: getFromEmail(),
      to,
      subject: getBookingCancellationSubject(t, serviceName),
      html,
    });

    if (error) {
      console.error("Failed to send booking cancellation email:", error);
    } else {
      console.log(`Booking cancellation email sent to ${to}`);
    }
  } catch (e) {
    console.error("Email send error (booking cancellation):", e);
  }
}
