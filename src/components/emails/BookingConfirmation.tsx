import type { Locale } from "@/i18n/config";
import type { Translate } from "@/lib/i18n/server";
import { formatEmailDate, formatSek } from "@/lib/email/i18n";

interface BookingConfirmationProps {
  customerName: string;
  serviceName: string;
  scheduledAt: Date;
  /** Optional end time — shown as a range "14:00–17:00" when present. */
  scheduledEndAt?: Date;
  creatorName: string;
  location?: string;
  bookingId?: string;
  /** Legal seller for the receipt block (org.nr / name + VAT note). */
  seller?: { name: string; orgNumber?: string; vatNote?: string };
  /**
   * Vad köparen betalade, i ÖREN. 0 = gratis biljett, och det skrivs ut.
   * undefined = beloppet är okänt i den här vägen, och då står raden inte alls.
   *
   * Utan belopp är mejlet ingen kvittohandling. En arbetsgivare som ska betala
   * ut friskvårdsersättning behöver se summan, och vid en reklamation eller en
   * bokföringsfråga är ett kvitto utan belopp värdelöst.
   */
  amountOre?: number | null;
  /**
   * Klippkort: sista giltighetsdag. Förfallet och ångerrätten ska stå på
   * kvittot, inte bara i villkoren (ARN 2023-17878; 2 kap. 2 § p. 10).
   */
  passValidUntil?: Date | null;
  /** Translator for the `emails` namespace, in the recipient's language. */
  t: Translate;
  locale: Locale;
}

// scheduledAt is stored in UTC; formatEmailDate renders in Europe/Stockholm so
// a 14:00 Swedish event doesn't display as 12:00 (the server/runtime is UTC).
const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "long",
  year: "numeric",
};

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
};

export function getBookingConfirmationSubject(t: Translate, serviceName: string): string {
  return t("bookingConfirmedSubject", { service: serviceName });
}

export default function BookingConfirmation({
  customerName,
  serviceName,
  scheduledAt,
  scheduledEndAt,
  creatorName,
  location,
  bookingId,
  seller,
  amountOre,
  passValidUntil,
  t,
  locale,
}: BookingConfirmationProps) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://usha.se";
  // Link to the public, login-free ticket page so guests (no account) can open
  // their QR. Fall back to the in-app tickets page when we don't have an id.
  const ticketUrl = bookingId ? `${appUrl}/biljett/${bookingId}` : `${appUrl}/app/tickets`;

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
                      <td style={{
                        backgroundColor: "#111113",
                        borderRadius: 16,
                        border: "1px solid rgba(200,164,69,0.15)",
                        padding: "32px 28px",
                      }}>
                        <p style={{ fontSize: 18, fontWeight: 600, color: "#fafaf9", margin: "0 0 8px" }}>
                          {t("greetingExcited", { name: customerName })}
                        </p>
                        <p style={{ fontSize: 14, color: "#6b6b6b", margin: "0 0 24px", lineHeight: 1.6 }}>
                          {t("bookingConfirmedIntro")}
                        </p>

                        <table width="100%" cellPadding={0} cellSpacing={0} style={{ marginBottom: 24 }}>
                          <tbody>
                            <tr>
                              <td style={{ padding: "12px 16px", borderRadius: 12, backgroundColor: "#0a0a0b" }}>
                                <p style={{ fontSize: 15, fontWeight: 600, color: "#c8a445", margin: "0 0 8px" }}>
                                  {serviceName}
                                </p>
                                <p style={{ fontSize: 13, color: "#fafaf9", margin: "0 0 4px" }}>
                                  {t("labelDate", { value: formatEmailDate(scheduledAt, locale, DATE_FORMAT) })}
                                </p>
                                <p style={{ fontSize: 13, color: "#fafaf9", margin: "0 0 4px" }}>
                                  {t("labelTime", {
                                    value:
                                      formatEmailDate(scheduledAt, locale, TIME_FORMAT) +
                                      (scheduledEndAt
                                        ? `–${formatEmailDate(scheduledEndAt, locale, TIME_FORMAT)}`
                                        : ""),
                                  })}
                                </p>
                                <p style={{ fontSize: 13, color: "#fafaf9", margin: "0 0 4px" }}>
                                  {t("labelHost", { value: creatorName })}
                                </p>
                                {location && (
                                  <p style={{ fontSize: 13, color: "#fafaf9", margin: 0 }}>
                                    {t("labelPlace", { value: location })}
                                  </p>
                                )}
                              </td>
                            </tr>
                          </tbody>
                        </table>

                        {bookingId && (
                          <table width="100%" cellPadding={0} cellSpacing={0} style={{ marginBottom: 24 }}>
                            <tbody>
                              <tr>
                                <td style={{ textAlign: "center" }}>
                                  <div style={{ display: "inline-block", backgroundColor: "#ffffff", borderRadius: 12, padding: 12 }}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={`${appUrl}/api/tickets/qr?id=${bookingId}`}
                                      width={200}
                                      height={200}
                                      alt={t("bookingQrAlt")}
                                      style={{ display: "block" }}
                                    />
                                  </div>
                                  <p style={{ fontSize: 12, color: "#6b6b6b", margin: "10px 0 0" }}>
                                    {t("bookingQrHint")}
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        )}

                        {passValidUntil && (
                          <table width="100%" cellPadding={0} cellSpacing={0} style={{ marginBottom: 24 }}>
                            <tbody>
                              <tr>
                                <td style={{ padding: "12px 16px", borderRadius: 12, backgroundColor: "#0a0a0b" }}>
                                  <p style={{ fontSize: 13, fontWeight: 600, color: "#fafaf9", margin: "0 0 6px" }}>
                                    {t("passReceiptValidUntil", { date: formatEmailDate(passValidUntil, locale, DATE_FORMAT) })}
                                  </p>
                                  <p style={{ fontSize: 12, color: "#a1a1a1", margin: 0, lineHeight: 1.6 }}>
                                    {t("passReceiptWithdrawal")}
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        )}

                        {seller && (
                          <table width="100%" cellPadding={0} cellSpacing={0} style={{ marginBottom: 24 }}>
                            <tbody>
                              <tr>
                                <td style={{ padding: "12px 16px", borderRadius: 12, backgroundColor: "#0a0a0b" }}>
                                  <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "#6b6b6b", margin: "0 0 6px" }}>
                                    {t("receiptHeading")}
                                  </p>
                                  <p style={{ fontSize: 13, color: "#fafaf9", margin: "0 0 4px" }}>
                                    {t("receiptSeller", { name: seller.name })}
                                  </p>
                                  {seller.orgNumber && (
                                    <p style={{ fontSize: 13, color: "#fafaf9", margin: "0 0 4px" }}>
                                      {t("receiptOrgNumber", { number: seller.orgNumber })}
                                    </p>
                                  )}
                                  {amountOre != null && (
                                    <p style={{ fontSize: 13, color: "#fafaf9", margin: "0 0 4px", fontWeight: 600 }}>
                                      {amountOre > 0
                                        ? t("receiptAmount", { amount: formatSek(amountOre / 100) })
                                        : t("receiptFree")}
                                    </p>
                                  )}
                                  {seller.vatNote && (
                                    <p style={{ fontSize: 12, color: "#6b6b6b", margin: 0 }}>
                                      {seller.vatNote}
                                    </p>
                                  )}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        )}

                        <table width="100%" cellPadding={0} cellSpacing={0}>
                          <tbody>
                            <tr>
                              <td style={{ textAlign: "center" }}>
                                <a
                                  href={ticketUrl}
                                  style={{
                                    display: "inline-block",
                                    padding: "14px 36px",
                                    borderRadius: 10,
                                    fontSize: 14,
                                    fontWeight: 600,
                                    color: "#0a0a0b",
                                    backgroundColor: "#c8a445",
                                    textDecoration: "none",
                                  }}
                                >
                                  {t("bookingViewTicket")}
                                </a>
                              </td>
                            </tr>
                          </tbody>
                        </table>

                        {/* Inbjudan att följa. Knappen som faktiskt skapar
                            följningen sitter på biljettsidan, bakom gästens egen
                            kapabilitetslänk — mejlet frågar, det bockar inte i
                            något åt någon. Tystnad är aldrig ett ja. */}
                        <table width="100%" cellPadding={0} cellSpacing={0} style={{ marginTop: 28 }}>
                          <tbody>
                            <tr>
                              <td style={{ textAlign: "center" }}>
                                <p style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 600, color: "#e8e6e3" }}>
                                  {t("bookingFollowHeading")}
                                </p>
                                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "#9b9690" }}>
                                  {t("bookingFollowBody", { creator: creatorName })}
                                </p>
                              </td>
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
