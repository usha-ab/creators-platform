/**
 * Efterköp: betalning för en kväll som redan varit.
 *
 * Bakgrund. Biljettförsäljningen stänger när kvällen är slut (evening.ts), och det är
 * rätt — ingen ska kunna köpa sig in på något som inte finns kvar. Men folk
 * bestämmer sig efteråt, dörren är full när de kommer, eller de tänker betala
 * på vägen hem. Då fanns ingen väg alls: gästen stod med pengarna i handen och
 * systemet sa nej.
 *
 * Marie Androv är fallet som drev fram det här. Hon dansade på The Lab den 15
 * oktober, ville betala på morgonen, och kunde bara köpa en biljett till NÄSTA
 * torsdag. Intäkten hamnade på fel kväll och statistiken blev fel på båda.
 *
 * Fönstret är avsiktligt kort och öppnas bara av någon som stod i dörren. Det
 * här är inte en andra chans att sälja gamla biljetter — det är ett sätt att ta
 * betalt av den som faktiskt var där.
 */

import { checkinButtonMode, wasThereEndsAt, WAS_THERE_HOURS, type EveningLike } from "./evening";

/**
 * Hur länge efterköpet är möjligt, räknat från kvällens slut (sluttiden,
 * eller 23:59 om den saknas). Ett dygn, beslut Pablo 2026-11-25. Samma fönster
 * för dörrens efterköp och gästens "Var du där?".
 */
export const EFTERKOP_FONSTER_TIMMAR = WAS_THERE_HOURS;

export type EfterkopLage =
  /** Kvällen pågår eller är inte här än — vanlig försäljning gäller. */
  | { kind: "inte_aktuellt" }
  /** Efterköp är möjligt. */
  | { kind: "oppet"; stangerVid: Date }
  /** Kvällen är för gammal. */
  | { kind: "stangt"; stangdeVid: Date };

/**
 * Var befinner sig kvällen?
 *
 * Öppet från att kvällen passerat för vanliga köp (midnatt, eller sluttiden
 * om kvällen går över midnatt) till 24 timmar efter kvällens slut — exakt
 * knappens "Var du där?"-läge i evening.ts, aldrig med ett glapp emellan.
 * Datumlösa poster (tjänster) får aldrig efterköp.
 */
export function efterkopLage(
  eventDate: string | null | undefined,
  now: Date,
  times?: Omit<EveningLike, "event_date">
): EfterkopLage {
  const ev = { event_date: eventDate, ...times };
  const stanger = wasThereEndsAt(ev);
  const mode = checkinButtonMode(now, ev);
  if (!stanger || mode === "none" || mode === "before" || mode === "checkin") return { kind: "inte_aktuellt" };
  if (mode === "wasThere") return { kind: "oppet", stangerVid: stanger };
  return { kind: "stangt", stangdeVid: stanger };
}

/** Kortformen för en grind som bara ska släppa igenom eller neka. */
export function efterkopOppet(
  eventDate: string | null | undefined,
  now: Date,
  times?: Omit<EveningLike, "event_date">
): boolean {
  return efterkopLage(eventDate, now, times).kind === "oppet";
}
