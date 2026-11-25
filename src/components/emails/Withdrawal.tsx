import type { ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import type { Translate } from "@/lib/i18n/server";
import { formatEmailDate, formatSek } from "@/lib/email/i18n";

/**
 * Mejlen när ett köp ångras (2 kap. 10 a § distansavtalslagen).
 *
 * WithdrawalReceipt är mottagningsbeviset till köparen. Lagen kräver att det
 * skickas utan dröjsmål och på ett varaktigt medium, och att det säger vad som
 * togs emot och när. WithdrawalSellerNotice säger samma sak till säljaren.
 */

const WHEN_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};
const DAY_FORMAT: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };

export interface WithdrawalMailProps {
  recipientName: string;
  serviceName: string;
  bookingCode: string;
  receivedAt: Date;
  /** Det som betalas tillbaka, i ÖREN. */
  refundOre: number;
  /**
   * stripe = redan återbetalt till kortet; manual = Usha betalar tillbaka för
   * hand; none = alla klipp använda efter begäran om att börja direkt.
   */
  refundMethod: "stripe" | "manual" | "none";
  /** Swish, Epassi … när refundMethod är manual. */
  paymentMethodLabel?: string | null;
  refundDueAt: Date;
  t: Translate;
  locale: Locale;
}

export function getWithdrawalReceiptSubject(t: Translate, serviceName: string): string {
  return t("withdrawalReceiptSubject", { service: serviceName });
}

export function getWithdrawalSellerSubject(t: Translate, serviceName: string): string {
  return t("withdrawalSellerSubject", { service: serviceName });
}

/** Ramen för Ushas mörka mejl. Delas med påminnelsen om klippkortets förfall. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <html>
      {/* eslint-disable-next-line @next/next/no-head-element -- mejl, inte en sida */}
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: "#0a0a0b", fontFamily: "'Outfit', Arial, sans-serif" }}>
        <table width="100%" cellPadding={0} cellSpacing={0} style={{ backgroundColor: "#0a0a0b", padding: "40px 16px" }}>
          <tbody>
            <tr>
              <td align="center">
                <table width="100%" cellPadding={0} cellSpacing={0} style={{ maxWidth: 560 }}>
                  <tbody>
                    <tr>
                      <td style={{ paddingBottom: 32, textAlign: "center" }}>
                        <span style={{ fontSize: 28, fontWeight: 700, color: "#c8a445", letterSpacing: "-0.02em" }}>
                          Usha Platform
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td
                        style={{
                          backgroundColor: "#111113",
                          borderRadius: 16,
                          border: "1px solid rgba(200,164,69,0.15)",
                          padding: "32px 28px",
                        }}
                      >
                        {children}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: "24px 0", textAlign: "center" }}>
                        <p style={{ fontSize: 11, color: "#3f3f3f", margin: 0 }}>© {new Date().getFullYear()} Usha Platform</p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

const P = { fontSize: 14, color: "#a1a1a1", margin: "0 0 16px", lineHeight: 1.6 } as const;
const LINE = { fontSize: 13, color: "#fafaf9", margin: "0 0 6px" } as const;

function Facts({ p }: { p: WithdrawalMailProps }) {
  const { t, locale } = p;
  return (
    <table width="100%" cellPadding={0} cellSpacing={0} style={{ marginBottom: 20 }}>
      <tbody>
        <tr>
          <td style={{ padding: "12px 16px", borderRadius: 12, backgroundColor: "#0a0a0b" }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: "#c8a445", margin: "0 0 8px" }}>{p.serviceName}</p>
            <p style={LINE}>{t("withdrawalLabelCode", { value: p.bookingCode })}</p>
            <p style={LINE}>{t("withdrawalLabelReceived", { value: formatEmailDate(p.receivedAt, locale, WHEN_FORMAT) })}</p>
            <p style={{ ...LINE, margin: 0 }}>{t("withdrawalLabelAmount", { value: formatSek(p.refundOre / 100) })}</p>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function WithdrawalReceipt(p: WithdrawalMailProps) {
  const { t, locale } = p;
  return (
    <Shell>
      <p style={{ fontSize: 18, fontWeight: 600, color: "#fafaf9", margin: "0 0 8px" }}>
        {t("greeting", { name: p.recipientName })}
      </p>
      <p style={P}>
        {t("withdrawalReceiptIntro", { when: formatEmailDate(p.receivedAt, locale, WHEN_FORMAT) })}
      </p>
      <Facts p={p} />
      <p style={P}>
        {p.refundMethod === "none"
          ? t("withdrawalRefundNone")
          : p.refundMethod === "stripe"
          ? t("withdrawalRefundStripe")
          : t("withdrawalRefundManual", {
              method: p.paymentMethodLabel || "Swish",
              date: formatEmailDate(p.refundDueAt, locale, DAY_FORMAT),
            })}
      </p>
      <p style={{ ...P, margin: 0 }}>{t("withdrawalReceiptOutro")}</p>
    </Shell>
  );
}

export function WithdrawalSellerNotice(p: WithdrawalMailProps & { buyerName: string }) {
  const { t, locale } = p;
  return (
    <Shell>
      <p style={{ fontSize: 18, fontWeight: 600, color: "#fafaf9", margin: "0 0 8px" }}>
        {t("greeting", { name: p.recipientName })}
      </p>
      <p style={P}>{t("withdrawalSellerIntro", { buyer: p.buyerName })}</p>
      <Facts p={p} />
      <p style={P}>
        {p.refundMethod === "none"
          ? t("withdrawalRefundNone")
          : p.refundMethod === "stripe"
          ? t("withdrawalSellerRefundStripe")
          : t("withdrawalSellerRefundManual", {
              method: p.paymentMethodLabel || "Swish",
              date: formatEmailDate(p.refundDueAt, locale, DAY_FORMAT),
            })}
      </p>
      <p style={{ ...P, margin: 0 }}>{t("withdrawalSellerOutro")}</p>
    </Shell>
  );
}
