import type { Locale } from "@/i18n/config";
import type { Translate } from "@/lib/i18n/server";
import { formatEmailDate } from "@/lib/email/i18n";
import { Shell } from "./Withdrawal";

/**
 * Påminnelsen 30 och 7 dagar före klippkortets sista giltighetsdag, när klipp
 * finns kvar. Förfallet ska vara tydligt för innehavaren och inte bara stå i
 * villkoren (ARN 2023-17878).
 */
export interface PassExpiryReminderProps {
  holderName: string;
  passTitle: string;
  remaining: number;
  expiresAt: Date;
  bookingId: string;
  t: Translate;
  locale: Locale;
}

const DAY: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };

export function getPassExpirySubject(t: Translate, passTitle: string, expiresAt: Date, locale: Locale): string {
  return t("passExpirySubject", { title: passTitle, date: formatEmailDate(expiresAt, locale, DAY) });
}

export default function PassExpiryReminder(p: PassExpiryReminderProps) {
  const { t, locale } = p;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://usha.se";
  const P = { fontSize: 14, color: "#a1a1a1", margin: "0 0 16px", lineHeight: 1.6 } as const;
  return (
    <Shell>
      <p style={{ fontSize: 18, fontWeight: 600, color: "#fafaf9", margin: "0 0 8px" }}>
        {t("greeting", { name: p.holderName })}
      </p>
      <p style={P}>
        {t("passExpiryIntro", {
          remaining: p.remaining,
          title: p.passTitle,
          date: formatEmailDate(p.expiresAt, locale, DAY),
        })}
      </p>
      <p style={P}>{t("passExpiryLapse")}</p>
      <table width="100%" cellPadding={0} cellSpacing={0}>
        <tbody>
          <tr>
            <td style={{ textAlign: "center" }}>
              <a
                href={`${appUrl}/biljett/${p.bookingId}`}
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
                {t("passExpiryCta")}
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    </Shell>
  );
}
