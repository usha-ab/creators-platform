/**
 * Lägsta betalda biljettpris: 50 kr. Gratis (0 kr) är fortfarande tillåtet.
 *
 * Varför: provisionen är 3,5 % + 3,50 kr per biljett (PLATFORM_COMMISSION i
 * commission.ts) och Stripe tar 1,5 % + 1,80 kr. Under ungefär 3,63 kr blir
 * kreatörens del negativ, och på 10–20 kr äter avgifterna en orimlig andel.
 * Pablo 2026-11-25: "Biljetter får nog inte kosta under 50 kr."
 *
 * Gränsen gäller allt som säljs som biljett eller pass: evenemangets pris,
 * biljettyper, förköpspris, klippkort och rabattpriset på access-koder.
 *
 * Befintliga priser under gränsen rörs inte. Ett pris som redan står på raden
 * får stå kvar när evenemanget redigeras, men ett NYTT pris måste följa regeln
 * (se isAllowedPriceChange). 2026-11-25 fanns inga sådana priser i produktion.
 */
export const MIN_PAID_TICKET_PRICE_SEK = 50;

/** Felkoden servern returnerar, så formuläret kan visa texten på rätt språk. */
export const MIN_PRICE_ERROR_CODE = "min_price" as const;

/** Serverns svenska feltext (formulären visar sin egen översättning). */
export const MIN_PRICE_ERROR = `Lägsta pris är ${MIN_PAID_TICKET_PRICE_SEK} kr, eller 0 kr för gratis.`;

/** Felet som serveråtgärderna returnerar när ett pris ligger under gränsen. */
export function minPriceError() {
  return { error: MIN_PRICE_ERROR, code: MIN_PRICE_ERROR_CODE } as const;
}

/**
 * Är priset (i kronor) tillåtet? `null`/`undefined` = inget pris angivet, vilket
 * behandlas som gratis. 0 är gratis. Annars minst 50 kr.
 */
export function isAllowedTicketPrice(kr: number | null | undefined): boolean {
  if (kr == null) return true;
  if (!Number.isFinite(kr) || kr < 0) return false;
  return kr === 0 || kr >= MIN_PAID_TICKET_PRICE_SEK;
}

/**
 * Som isAllowedTicketPrice, men ett oförändrat pris godtas alltid: ett
 * evenemang som skapades före regeln ska gå att redigera (titel, tid) utan att
 * arrangören tvingas byta pris. Ändras priset gäller regeln fullt ut.
 */
export function isAllowedPriceChange(
  next: number | null | undefined,
  previous: number | null | undefined
): boolean {
  if (isAllowedTicketPrice(next)) return true;
  return previous != null && next != null && Number(next) === Number(previous);
}

export interface EventPriceSet {
  price: number | null | undefined;
  earlyBirdPrice?: number | null;
  ticketTypes?: { id?: string | null; price: number }[];
}

/**
 * Hela evenemangets prisuppsättning mot regeln. `previous` är raden som den
 * ser ut i databasen när ett befintligt evenemang redigeras; biljettyper
 * matchas på id, så en ny typ alltid prövas och en befintlig typ med
 * oförändrat pris får stå kvar.
 */
export function eventPricesAllowed(next: EventPriceSet, previous?: EventPriceSet | null): boolean {
  const prevTypes = new Map<string, number>();
  for (const t of previous?.ticketTypes ?? []) if (t.id) prevTypes.set(t.id, t.price);

  const types = next.ticketTypes ?? [];
  // Med biljettyper speglar evenemangets pris den billigaste typen, så det är
  // typerna som prövas. Utan typer är det evenemangets eget pris.
  if (types.length === 0 && !isAllowedPriceChange(next.price, previous?.price)) return false;
  if (!isAllowedPriceChange(next.earlyBirdPrice, previous?.earlyBirdPrice)) return false;
  for (const t of types) {
    const prev = t.id ? prevTypes.get(t.id) : undefined;
    if (!isAllowedPriceChange(t.price, prev)) return false;
  }
  return true;
}
