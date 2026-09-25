import type { Locale } from "@/i18n/config";
import type { Translate } from "@/lib/i18n/server";

interface FollowConfirmProps {
  creatorName: string;
  confirmUrl: string;
  t: Translate;
  locale: Locale;
}

export function getFollowConfirmSubject(t: Translate, creatorName: string): string {
  return t("followConfirmSubject", { creator: creatorName });
}

/** Dubbel opt-in: bekräfta att adressen vill ha mejl om nya tillfällen. */
export default function FollowConfirm({ creatorName, confirmUrl, t }: FollowConfirmProps) {
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
                        <span style={{ fontSize: 28, fontWeight: 700, color: "#c8a445", letterSpacing: "-0.02em" }}>Usha Platform</span>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ backgroundColor: "#111113", borderRadius: 16, border: "1px solid rgba(200,164,69,0.15)", padding: "32px 28px" }}>
                        <p style={{ margin: "0 0 12px", fontSize: 20, fontWeight: 600, color: "#f5f5f5" }}>{t("greetingNoName")}</p>
                        <p style={{ margin: "0 0 24px", fontSize: 15, lineHeight: 1.6, color: "#b8b8bd" }}>
                          {t("followConfirmIntro", { creator: creatorName })}
                        </p>
                        <table cellPadding={0} cellSpacing={0} style={{ margin: "0 auto" }}>
                          <tbody>
                            <tr>
                              <td>
                                <a
                                  href={confirmUrl}
                                  style={{ display: "inline-block", padding: "14px 36px", borderRadius: 10, fontSize: 14, fontWeight: 600, color: "#0a0a0b", backgroundColor: "#c8a445", textDecoration: "none" }}
                                >
                                  {t("followConfirmCta")}
                                </a>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                        <p style={{ margin: "24px 0 0", fontSize: 12, lineHeight: 1.6, color: "#77777d" }}>{t("followConfirmFooter")}</p>
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
