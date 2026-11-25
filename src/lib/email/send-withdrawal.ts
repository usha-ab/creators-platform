import { createElement } from "react";
import { getResend, getFromEmail } from "./resend";
import { renderEmailToHtml } from "./render";
import { getEmailIntl, formatSek } from "./i18n";
import { resolveRecipientLocale } from "@/lib/i18n/recipient";
import {
  WithdrawalReceipt,
  WithdrawalSellerNotice,
  getWithdrawalReceiptSubject,
  getWithdrawalSellerSubject,
  type WithdrawalMailProps,
} from "@/components/emails/Withdrawal";

type Base = Omit<WithdrawalMailProps, "t" | "locale">;

/** Supporten tar emot ärenden om återbetalning som görs för hand. */
export const SUPPORT_EMAIL = "support@usha.se";

/**
 * Mottagningsbeviset till köparen. Returnerar true när Resend tog emot mejlet,
 * så att det kan antecknas på ångerraden.
 */
export async function sendWithdrawalReceipt(
  p: Base & { to: string; recipientId?: string | null; preferredLocale?: string | null }
): Promise<boolean> {
  try {
    const { t, locale } = await getEmailIntl(
      await resolveRecipientLocale({ userId: p.recipientId, email: p.to, preferred: p.preferredLocale })
    );
    const html = await renderEmailToHtml(createElement(WithdrawalReceipt, { ...p, t, locale }));
    const { error } = await getResend().emails.send({
      from: getFromEmail(),
      to: p.to,
      replyTo: SUPPORT_EMAIL,
      subject: getWithdrawalReceiptSubject(t, p.serviceName),
      html,
    });
    if (error) {
      console.error("Mottagningsbeviset för ångrat köp gick inte iväg:", error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Mottagningsbeviset för ångrat köp gick inte iväg:", e);
    return false;
  }
}

/** Säljaren får veta att köpet är ångrat och hur pengarna går tillbaka. */
export async function sendWithdrawalSellerNotice(
  p: Base & { to: string; recipientId?: string | null; buyerName: string }
): Promise<boolean> {
  try {
    const { t, locale } = await getEmailIntl(await resolveRecipientLocale({ userId: p.recipientId, email: p.to }));
    const html = await renderEmailToHtml(createElement(WithdrawalSellerNotice, { ...p, t, locale }));
    const { error } = await getResend().emails.send({
      from: getFromEmail(),
      to: p.to,
      subject: getWithdrawalSellerSubject(t, p.serviceName),
      html,
    });
    if (error) {
      console.error("Säljarens mejl om ångrat köp gick inte iväg:", error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Säljarens mejl om ångrat köp gick inte iväg:", e);
    return false;
  }
}

/**
 * Ärendet till supporten när pengarna inte kunde gå tillbaka automatiskt:
 * Swish och Epassi betalas tillbaka för hand, och en misslyckad
 * Stripe-återbetalning ska inte bli liggande. Internt, därför bara svenska.
 */
export async function sendWithdrawalSupportCase(p: {
  bookingId: string;
  bookingCode: string;
  serviceName: string;
  buyerName: string;
  buyerEmail: string;
  refundOre: number;
  paymentMethodLabel: string;
  refundDueAt: Date;
  reason: "manual" | "stripeFailed";
  error?: string | null;
}): Promise<boolean> {
  const due = p.refundDueAt.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
  const lines = [
    p.reason === "manual"
      ? `Ett köp betalt med ${p.paymentMethodLabel} har ångrats. Betala tillbaka för hand.`
      : `Ett köp har ångrats men Stripe-återbetalningen misslyckades. Betala tillbaka för hand eller försök igen.`,
    `Belopp: ${formatSek(p.refundOre / 100)} kr`,
    `Senast: ${due} (14 § distansavtalslagen)`,
    `Köp: ${p.serviceName} (${p.bookingCode})`,
    `Boknings-id: ${p.bookingId}`,
    `Köpare: ${p.buyerName} <${p.buyerEmail}>`,
    p.error ? `Fel: ${p.error}` : "",
  ].filter(Boolean);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  try {
    const { error } = await getResend().emails.send({
      from: getFromEmail(),
      to: SUPPORT_EMAIL,
      subject: `Ångrat köp – återbetala senast ${due}: ${p.serviceName}`,
      html: `<p>${lines.map(esc).join("<br>")}</p>`,
      text: lines.join("\n"),
    });
    if (error) {
      console.error("Supportärendet för ångrat köp gick inte iväg:", error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Supportärendet för ångrat köp gick inte iväg:", e);
    return false;
  }
}
