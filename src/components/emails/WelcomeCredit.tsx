import type { Locale } from '@/i18n/config';
import type { Translate } from '@/lib/i18n/server';
import { formatEmailDate, formatSek } from '@/lib/email/i18n';

interface WelcomeCreditProps {
  recipientName: string;
  /** Avdragets storlek i kronor. */
  amount: number;
  /** Lägsta ordersumma i kronor för att avdraget ska gälla. */
  minSpend: number;
  expiresAt: Date;
  /** Translator for the `emails` namespace, in the recipient's language. */
  t: Translate;
  locale: Locale;
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
};

export function getWelcomeCreditSubject(t: Translate, amount: number): string {
  return t('creditSubject', { amount: formatSek(amount) });
}

export default function WelcomeCredit({
  recipientName,
  amount,
  minSpend,
  expiresAt,
  t,
  locale,
}: WelcomeCreditProps) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://usha.se';

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: '#0a0a0b', fontFamily: "'Outfit', Arial, sans-serif" }}>
        <table width="100%" cellPadding={0} cellSpacing={0} style={{ backgroundColor: '#0a0a0b', padding: '40px 16px' }}>
          <tbody>
            <tr>
              <td align="center">
                <table width="100%" cellPadding={0} cellSpacing={0} style={{ maxWidth: 560 }}>
                  <tbody>
                    <tr>
                      <td style={{ paddingBottom: 32, textAlign: 'center' }}>
                        <span style={{ fontSize: 28, fontWeight: 700, color: '#c8a445', letterSpacing: '-0.02em' }}>
                          Usha Platform
                        </span>
                      </td>
                    </tr>

                    <tr>
                      <td style={{
                        backgroundColor: '#111113',
                        borderRadius: 16,
                        border: '1px solid rgba(200,164,69,0.2)',
                        padding: '32px 28px',
                        backgroundImage: 'linear-gradient(135deg, rgba(200,164,69,0.06) 0%, transparent 50%)',
                      }}>
                        <p style={{ fontSize: 18, fontWeight: 600, color: '#fafaf9', margin: '0 0 8px' }}>
                          {t('creditGreeting', { name: recipientName })}
                        </p>
                        <p style={{ fontSize: 14, color: '#6b6b6b', margin: '0 0 28px', lineHeight: 1.6 }}>
                          {t('creditIntro')}
                        </p>

                        {/* Beloppet. Det är hela anledningen att mejlet finns, så
                            det får stå för sig självt och inte i en mening. */}
                        <table width="100%" cellPadding={0} cellSpacing={0} style={{ marginBottom: 28 }}>
                          <tbody>
                            <tr>
                              <td style={{
                                padding: '20px 16px',
                                borderRadius: 12,
                                backgroundColor: '#0a0a0b',
                                textAlign: 'center',
                                border: '1px solid rgba(200,164,69,0.15)',
                              }}>
                                <p style={{ fontSize: 32, fontWeight: 700, color: '#c8a445', margin: '0 0 4px' }}>
                                  {t('creditAmount', { amount: formatSek(amount) })}
                                </p>
                                <p style={{ fontSize: 12, color: '#6b6b6b', margin: 0 }}>
                                  {t('creditAmountLabel')}
                                </p>
                              </td>
                            </tr>
                          </tbody>
                        </table>

                        {/* Villkoren står i klartext. Ett avdrag som visar sig ha
                            en gräns först i kassan skapar mer irritation än det
                            är värt. */}
                        <p style={{ fontSize: 13, fontWeight: 600, color: '#fafaf9', margin: '0 0 12px' }}>
                          {t('creditHowHeading')}
                        </p>
                        <table width="100%" cellPadding={0} cellSpacing={0} style={{ marginBottom: 28 }}>
                          <tbody>
                            {[
                              t('creditHowAutomatic', { min: formatSek(minSpend) }),
                              t('creditHowOneOff'),
                              t('creditHowValid', { date: formatEmailDate(expiresAt, locale, DATE_FORMAT) }),
                            ].map((line, i) => (
                              <tr key={i}>
                                <td style={{
                                  padding: '10px 12px',
                                  borderRadius: 10,
                                  backgroundColor: i % 2 === 0 ? 'rgba(200,164,69,0.04)' : 'transparent',
                                  fontSize: 13,
                                  color: '#fafaf9',
                                  lineHeight: 1.5,
                                }}>
                                  {line}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        <table width="100%" cellPadding={0} cellSpacing={0}>
                          <tbody>
                            <tr>
                              <td style={{ textAlign: 'center' }}>
                                <a
                                  href={`${appUrl}/marketplace`}
                                  style={{
                                    display: 'inline-block',
                                    padding: '14px 36px',
                                    borderRadius: 10,
                                    fontSize: 14,
                                    fontWeight: 600,
                                    color: '#0a0a0b',
                                    backgroundColor: '#c8a445',
                                    textDecoration: 'none',
                                  }}
                                >
                                  {t('creditCta')}
                                </a>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* Avregistreringen pekar på notisinställningarna: mottagaren
                        har ett konto, så det finns en riktig knapp att stänga av
                        med — ingen separat token behövs. */}
                    <tr>
                      <td style={{ padding: '24px 0', textAlign: 'center' }}>
                        <p style={{ fontSize: 12, color: '#6b6b6b', margin: '0 0 4px' }}>
                          {t('questionsContact')}{' '}
                          <a href="mailto:support@usha.se" style={{ color: '#c8a445', textDecoration: 'none' }}>
                            support@usha.se
                          </a>
                        </p>
                        <p style={{ fontSize: 11, color: '#3f3f3f', margin: '0 0 4px' }}>
                          <a href={`${appUrl}/app/settings/notifications`} style={{ color: '#6b6b6b' }}>
                            {t('broadcastUnsubscribe')}
                          </a>
                        </p>
                        <p style={{ fontSize: 11, color: '#3f3f3f', margin: 0 }}>
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
