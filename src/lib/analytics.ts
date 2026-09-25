import { ANALYTICS_EVENTS, type PurchasePayload } from "./analytics/events";

/**
 * Ett värde som kan följa med en händelse. `items` i ett köp är en lista av
 * objekt, så typen måste rymma mer än primitiver — annars hade varje köp
 * behövt skickas som två anrop, och GA4 hade räknat intäkten dubbelt.
 */
type GtagValue = string | number | boolean | undefined | Record<string, unknown>[];
type GtagEventParams = Record<string, GtagValue>;

declare global {
  interface Window {
    gtag?: (command: "event" | "config" | "js", action: string, params?: GtagEventParams | Date) => void;
    dataLayer?: unknown[];
  }
}

export function trackEvent(name: string, params?: GtagEventParams): void {
  if (typeof window === "undefined" || !window.gtag) return;
  window.gtag("event", name, params);
}

/**
 * Ett genomfört köp, i GA4:s form.
 *
 * `purchase` är ett reserverat händelsenamn: med rätt nyttolast fyller det
 * intäktsrapporterna av sig självt, i stället för att bli ännu en egen
 * händelse som ingen hittar. Kanalen och partnerkoden följer med, så rapporten
 * kan svara på vad som sålde biljetten och inte bara att den såldes.
 *
 * transaction_id är bokningens id. Skickas samma köp två gånger — en omladdning
 * av kvittosidan, en tillbakaknapp — räknar GA4 det som ett köp, inte två.
 */
export function trackPurchase(payload: PurchasePayload): void {
  trackEvent(ANALYTICS_EVENTS.purchase, {
    transaction_id: payload.transaction_id,
    value: payload.value,
    currency: payload.currency,
    items: payload.items as unknown as Record<string, unknown>[],
    ...(payload.utm_source ? { utm_source: payload.utm_source } : {}),
    ...(payload.utm_medium ? { utm_medium: payload.utm_medium } : {}),
    ...(payload.utm_campaign ? { utm_campaign: payload.utm_campaign } : {}),
    ...(payload.affiliate ? { affiliate: payload.affiliate } : {}),
  });
}
