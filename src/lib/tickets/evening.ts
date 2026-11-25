/**
 * När börjar och slutar en kväll, och vad ska knappen säga?
 *
 * En regel, ett ställe. Köpgränsen (sale-state), efterköpet (late-purchase),
 * självincheckningen, "Var du där?" och räknaren i dörren frågar alla här.
 *
 * Beslut Pablo 2026-11-25:
 *  - Kvällens slut = sluttiden (event_end_time; över midnatt om den ligger
 *    före starttiden). Saknas sluttid räknas 23:59 på eventdagen.
 *  - "Checka in" från start − 30 min till midnatt — eller till sluttiden om
 *    kvällen pågår efter midnatt.
 *  - Därefter är kvällen PASSERAD för allt utom efterköpet: vanliga köp går
 *    till nästa kväll, väntelistan och sale-state fungerar som förut.
 *  - "Var du där?" (efterköp) från samma ögonblick och i 24 timmar efter
 *    kvällens slut. Sedan stängt.
 */

import { stockholmLocalToUtcISO } from "@/lib/time";

/** Så här långt före starttiden öppnar självincheckningen. */
export const SELF_CHECKIN_LEAD_MINUTES = 30;

/** Så länge efter kvällens slut går det att betala i efterhand. */
export const WAS_THERE_HOURS = 24;

export interface EveningLike {
  event_date?: string | null;
  event_time?: string | null;
  event_end_time?: string | null;
}

/** "YYYY-MM-DD" + n dagar, utan att gå via lokal tidszon. */
function addDays(date: string, n: number): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

function hhmm(time: string | null | undefined): string | null {
  if (!time) return null;
  const m = time.match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}

function at(date: string, time: string): Date | null {
  const iso = stockholmLocalToUtcISO(`${date.slice(0, 10)}T${time}`);
  return iso ? new Date(iso) : null;
}

/** Kvällens start i UTC: datum + starttid, eller midnatt om tid saknas. */
export function eveningStartsAt(ev: EveningLike): Date | null {
  if (!ev.event_date) return null;
  return at(ev.event_date, hhmm(ev.event_time) ?? "00:00");
}

/**
 * Kvällens slut i UTC: sluttiden, på dagen efter om den ligger över midnatt
 * (före starttiden, eller före 12 när starttid saknas). Saknas sluttid: 23:59.
 * Null för poster utan datum (tjänster).
 */
export function eventEndsAt(ev: EveningLike): Date | null {
  if (!ev.event_date) return null;
  const end = hhmm(ev.event_end_time);
  if (!end) return at(ev.event_date, "23:59");
  const start = hhmm(ev.event_time);
  const crossesMidnight = start ? end <= start : end < "12:00";
  return at(crossesMidnight ? addDays(ev.event_date, 1) : ev.event_date, end);
}

/**
 * När kvällen räknas som passerad för vanliga köp, och "Checka in" blir
 * "Var du där?": midnatt efter eventdatumet, eller sluttiden om kvällen
 * pågår efter midnatt.
 */
export function eveningPassesAt(ev: EveningLike): Date | null {
  if (!ev.event_date) return null;
  const midnight = at(addDays(ev.event_date, 1), "00:00");
  const end = eventEndsAt(ev);
  if (!midnight || !end) return null;
  return end > midnight ? end : midnight;
}

/** När "Var du där?" stänger: 24 timmar efter kvällens slut. */
export function wasThereEndsAt(ev: EveningLike): Date | null {
  const end = eventEndsAt(ev);
  return end ? new Date(end.getTime() + WAS_THERE_HOURS * 3_600_000) : null;
}

/**
 * Har kvällen passerat för vanliga köp? Datumlösa poster har aldrig varit.
 * Det här är sale-states "past" och väntelistans gräns.
 */
export function eveningIsOver(ev: EveningLike, now: Date): boolean {
  const passes = eveningPassesAt(ev);
  return !!passes && now >= passes;
}

export type CheckinButtonMode =
  /** Datumlös post — ingen kväll. */
  | "none"
  /** Före start − 30 min. */
  | "before"
  /** "Checka in" (självincheckning). */
  | "checkin"
  /** "Var du där?" — betala för den passerade kvällen i efterhand. */
  | "wasThere"
  /** Efterköpet har stängt. */
  | "closed";

/** Vad knappen för kvällen ska vara just nu. Ren funktion; avgörs på servern. */
export function checkinButtonMode(now: Date, ev: EveningLike): CheckinButtonMode {
  const start = eveningStartsAt(ev);
  const passes = eveningPassesAt(ev);
  const closes = wasThereEndsAt(ev);
  if (!start || !passes || !closes) return "none";
  if (now >= passes) return now < closes ? "wasThere" : "closed";
  if (now.getTime() >= start.getTime() - SELF_CHECKIN_LEAD_MINUTES * 60_000) return "checkin";
  return "before";
}

export type SelfCheckinWindow =
  | { state: "before"; opensAt: Date; closesAt: Date }
  | { state: "open"; opensAt: Date; closesAt: Date }
  | { state: "closed"; opensAt: Date; closesAt: Date }
  /** Ingen kväll att checka in på (datumlös post). */
  | { state: "none" };

/** Självincheckningens fönster: samma som knappens "Checka in"-läge. */
export function selfCheckinWindow(ev: EveningLike, now: Date): SelfCheckinWindow {
  const start = eveningStartsAt(ev);
  const closesAt = eveningPassesAt(ev);
  if (!start || !closesAt) return { state: "none" };
  const opensAt = new Date(start.getTime() - SELF_CHECKIN_LEAD_MINUTES * 60_000);
  const mode = checkinButtonMode(now, ev);
  if (mode === "before") return { state: "before", opensAt, closesAt };
  if (mode === "checkin") return { state: "open", opensAt, closesAt };
  return { state: "closed", opensAt, closesAt };
}

/**
 * Vanliga köp: den första kvällen i en serie som inte har passerat. Aldrig
 * en passerad kväll, inte heller när den ligger inom efterköpsfönstret.
 * `occurrences` ska vara sorterade på datum.
 */
export function pickRegularOccurrence<T extends EveningLike>(occurrences: readonly T[], now: Date): T | null {
  return occurrences.find((o) => !!o.event_date && !eveningIsOver(o, now)) ?? null;
}

/**
 * "Var du där?": den senast passerade kvällen vars efterköp fortfarande är
 * öppet. Skild från pickRegularOccurrence — två kvällar tätt (dagliga
 * evenemang) ger en kväll för köp och en annan för efterköp.
 */
export function pickWasThereOccurrence<T extends EveningLike>(occurrences: readonly T[], now: Date): T | null {
  const open = occurrences.filter((o) => checkinButtonMode(now, o) === "wasThere");
  return open.length ? open[open.length - 1] : null;
}
