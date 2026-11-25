import type { Locale } from "@/i18n/config";
import type { Translate } from "@/lib/i18n/server";
import { formatEmailDate, formatSek } from "@/lib/email/i18n";

interface SwishPendingProps {
  customerName: string;
  serviceName: string;
  scheduledAt: Date;
  /** Beloppet att swisha, i kronor. */
  amountSek: number;
  /** Swish-numret, formaterat "123 711 11 80". */
  swishNumber: string;
  /** Meddelandet som ligger i Swish-länken, så kvittot går att känna igen. */
  swishMessage: string;
  /** Länken som öppnar Swish-appen med allt förifyllt. */
  swishUrl: string;
  bookingId: string;
  /** Swish Handel: betalningen görs på biljettsidan och bekräftas av Swish, inte i entrén. */
  commerce?: boolean;
  t: Translate;
  locale: Locale;
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" };
const TIME_FORMAT: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

export function getSwishPendingSubject(t: Translate, serviceName: string, amountSek: number): string {
  return t("swishPendingSubject", { service: serviceName, amount: formatSek(amountSek) });
}

/**
 * Skickas i samma sekund som gästen trycker "Fortsätt till Swish" på
 * eventsidan. Det är svaret på frågan "gick köpet igenom?": nej, inte än,
 * och så här blir det klart. Biljetten med QR-kod kommer i ett eget mejl när
 * entrén bekräftat betalningen.
 */
export default function SwishPending({
  customerName,
  serviceName,
  scheduledAt,
  amountSek,
  swishNumber,
  swishMessage,
  swishUrl,
  bookingId,
  commerce = false,
  t,
  locale,
}: SwishPendingProps) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://usha.se";
  const ticketUrl = `${appUrl}/biljett/${bookingId}`;
  const button = (href: string, label: string, primary: boolean) => (
    <a
      href={href}
      style={{
        display: "inline-block",
        padding: "14px 36px",
        borderRadius: 10,
        fontSize: 14,
        fontWeight: 600,
        color: primary ? "#ffffff" : "#0a0a0b",
        backgroundColor: primary ? "#000000" : "#c8a445",
        border: primary ? "1px solid rgba(255,255,255,0.25)" : "none",
        textDecoration: "none",
      }}
    >
      {label}
    </a>
  );

  return (
    <html>
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
                      <td style={{ backgroundColor: "#111113", borderRadius: 16, border: "1px solid rgba(200,164,69,0.15)", padding: "32px 28px" }}>
                        <p style={{ fontSize: 18, fontWeight: 600, color: "#fafaf9", margin: "0 0 8px" }}>
                          {t("greetingExcited", { name: customerName })}
                        </p>
                        <p style={{ fontSize: 14, color: "#9b9690", margin: "0 0 24px", lineHeight: 1.6 }}>
                          {t("swishPendingIntro", { service: serviceName })}
                        </p>

                        <table width="100%" cellPadding={0} cellSpacing={0} style={{ marginBottom: 24 }}>
                          <tbody>
                            <tr>
                              <td style={{ padding: "12px 16px", borderRadius: 12, backgroundColor: "#0a0a0b" }}>
                                <p style={{ fontSize: 15, fontWeight: 600, color: "#c8a445", margin: "0 0 8px" }}>{serviceName}</p>
                                <p style={{ fontSize: 13, color: "#fafaf9", margin: "0 0 4px" }}>
                                  {t("labelDate", { value: formatEmailDate(scheduledAt, locale, DATE_FORMAT) })}
                                </p>
                                <p style={{ fontSize: 13, color: "#fafaf9", margin: 0 }}>
                                  {t("labelTime", { value: formatEmailDate(scheduledAt, locale, TIME_FORMAT) })}
                                </p>
                              </td>
                            </tr>
                          </tbody>
                        </table>

                        <p style={{ fontSize: 14, fontWeight: 600, color: "#fafaf9", margin: "0 0 6px" }}>
                          {t("swishPendingStep1Heading")}
                        </p>
                        <p style={{ fontSize: 14, color: "#fafaf9", margin: "0 0 16px", lineHeight: 1.6 }}>
                          {commerce
                            ? t("swishPendingStep1Commerce", { amount: formatSek(amountSek) })
                            : t("swishPendingStep1", { amount: formatSek(amountSek), number: swishNumber, message: swishMessage })}
                        </p>
                        <table width="100%" cellPadding={0} cellSpacing={0} style={{ marginBottom: 24 }}>
                          <tbody>
                            <tr>
                              <td style={{ textAlign: "center" }}>{commerce ? button(ticketUrl, t("swishPendingOpenCommerce"), true) : button(swishUrl, t("swishPendingOpen"), true)}</td>
                            </tr>
                          </tbody>
                        </table>

                        <p style={{ fontSize: 14, fontWeight: 600, color: "#fafaf9", margin: "0 0 6px" }}>
                          {commerce ? t("swishPendingStep2HeadingCommerce") : t("swishPendingStep2Heading")}
                        </p>
                        <p style={{ fontSize: 14, color: "#9b9690", margin: "0 0 16px", lineHeight: 1.6 }}>
                          {commerce ? t("swishPendingStep2Commerce") : t("swishPendingStep2")}
                        </p>
                        <p style={{ fontSize: 14, color: "#9b9690", margin: "0 0 24px", lineHeight: 1.6 }}>
                          {t("swishPendingAtDoor")}
                        </p>

                        <table width="100%" cellPadding={0} cellSpacing={0}>
                          <tbody>
                            <tr>
                              <td style={{ textAlign: "center" }}>{button(ticketUrl, t("swishPendingView"), false)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: "24px 0", textAlign: "center" }}>
                        <p style={{ fontSize: 11, color: "#3f3f3f", margin: 0 }}>
                          © {new Date().getFullYear()} Usha Platform
                        </p>
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
