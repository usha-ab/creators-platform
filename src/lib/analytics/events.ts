/**
 * Namnen på de händelser vi mäter.
 *
 * Samlade här av ett skäl: ett stavfel i ett händelsenamn syns inte som ett
 * fel någonstans, det blir bara en rapport som saknar hälften av köpen. GA4
 * har dessutom reserverade namn (purchase, sign_up, search …) som ger
 * inbyggda rapporter — de används där de passar, i stället för egna varianter.
 */
export const ANALYTICS_EVENTS = {
  /** Reserverat i GA4: ger intäktsrapporterna. Skickas när ett köp är klart. */
  purchase: "purchase",
  /** Reserverat: när någon påbörjar kassan. */
  beginCheckout: "begin_checkout",
  /** Reserverat: nytt konto. */
  signUp: "sign_up",
  /** Egna: följa en kreatör, med eller utan konto. */
  follow: "follow",
  followEmail: "follow_email",
  /** Egen: klippkort köpt (också ett purchase, men vi vill kunna skilja ut dem). */
  passPurchase: "pass_purchase",
  /** Egen: klick på en partnerlänk som landade. */
  affiliateLanding: "affiliate_landing",
} as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

/** Varan i ett köp, i GA4:s form. */
export interface AnalyticsItem {
  item_id: string;
  item_name: string;
  item_category?: string;
  price?: number;
  quantity?: number;
}

export interface PurchasePayload {
  transaction_id: string;
  value: number;
  currency: "SEK";
  items: AnalyticsItem[];
  /** Kanalen köpet kom ifrån, när vi vet den. */
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  /** Partnerkoden som ledde hit, när det finns en. */
  affiliate?: string;
}
