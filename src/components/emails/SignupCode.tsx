import type { Locale } from "@/i18n/config";
import type { Translate } from "@/lib/i18n/server";

interface SignupCodeProps {
  code: string;
  t: Translate;
  locale: Locale;
}

/** Koden står i ämnesraden också, så den syns direkt i notisen på telefonen. */
export function getSignupCodeSubject(t: Translate, code: string): string {
  return t("signupCodeSubject", { code });
}

/**
 * Sexsiffrig kod för att skapa konto med BankID. Ingen länk: koden skrivs in
 * på sidan man redan har öppen, och en länkskanner kan inte förbruka den.
 */
export default function SignupCode({ code, t }: SignupCodeProps) {
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
                          {t("signupCodeIntro")}
                        </p>
                        <p style={{ margin: "0 0 24px", textAlign: "center", fontSize: 36, fontWeight: 700, letterSpacing: "0.3em", color: "#c8a445", fontFamily: "'JetBrains Mono', 'Courier New', monospace" }}>
                          {code}
                        </p>
                        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: "#77777d" }}>{t("signupCodeFooter")}</p>
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
