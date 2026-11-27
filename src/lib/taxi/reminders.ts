/**
 * Påminnelser till volontärerna. Två sorter, båda efter The Lab 26 nov:
 *
 * 1. Incheckning. Sammy bokade 17–19 men checkade aldrig in, och påminnelsen
 *    kom först när passet redan börjat. Nu går den när incheckningen öppnar,
 *    en timme före passet. Jobbet körs varje kvart; ett pass räknas som
 *    "dags" från fem minuter innan incheckningen öppnar (klockan på servern
 *    kan gå ett par sekunder före) till dess att passet tar slut, så länge det
 *    inte började för mer än en timme sedan. Stämpeln checkin_reminded_at
 *    hindrar dubbletter.
 *
 * 2. Välj pass. Nadia godkändes 17:19 men valde aldrig pass. Den som är
 *    godkänd i en roll men inte har bokat något pass på en kväll samma dag,
 *    där det finns lediga pass i den rollen, får en notis kl. 10. Högst en
 *    per kväll och volontär: notifikationstabellen är loggen över vad som
 *    redan gått ut. Inte till den som godkändes de senaste tre timmarna (hen
 *    har just fått godkännandenotisen) och aldrig på natten.
 *
 * Rena funktioner. Tider in som ISO.
 */

import { CHECKIN_EARLY_MINUTES, TAXI_MAX_PER_EVENING } from "./rules";
import { approvalScopeKey } from "./approvals";

const MIN = 60_000;
const ms = (iso: string) => Date.parse(iso);

/** Så här långt innan incheckningen öppnar räknas påminnelsen som i tid. */
export const CHECKIN_REMINDER_SLACK_MINUTES = 5;
/** Ett pass som började för längre sedan än så får ingen påminnelse. */
export const CHECKIN_REMINDER_LATE_MINUTES = 60;
/** Den som godkändes så här nyligen har redan fått en notis om att välja pass. */
export const CHOOSE_REMINDER_AFTER_APPROVAL_MINUTES = 180;
/** Notistypen för "välj pass" — också nyckeln för att hitta redan skickade. */
export const CHOOSE_REMINDER_TYPE = "volunteer_choose_shift" as const;

/** Inga påminnelser mellan 22 och 08 svensk tid. */
export const QUIET_FROM_HOUR = 22;
export const QUIET_TO_HOUR = 8;

export function stockholmHour(now: Date): number {
  const h = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", hour12: false }).format(now);
  return Number(h) % 24;
}

export function isQuietHour(now: Date): boolean {
  const h = stockholmHour(now);
  return h >= QUIET_FROM_HOUR || h < QUIET_TO_HOUR;
}

/** Spannet av starttider jobbet frågar databasen efter. */
export function checkinReminderRange(now: Date): { startsFrom: string; startsTo: string } {
  return {
    startsFrom: new Date(now.getTime() - CHECKIN_REMINDER_LATE_MINUTES * MIN).toISOString(),
    startsTo: new Date(now.getTime() + (CHECKIN_EARLY_MINUTES + CHECKIN_REMINDER_SLACK_MINUTES) * MIN).toISOString(),
  };
}

export interface CheckinCandidate {
  status: string;
  checked_in_at: string | null;
  checkin_reminded_at: string | null;
  starts_at: string;
  ends_at: string;
}

/** Ska den här bokningen få incheckningspåminnelsen nu? */
export function isCheckinReminderDue(s: CheckinCandidate, now: Date): boolean {
  if (s.status !== "booked" || s.checked_in_at || s.checkin_reminded_at) return false;
  const { startsFrom, startsTo } = checkinReminderRange(now);
  const start = ms(s.starts_at);
  return start >= ms(startsFrom) && start <= ms(startsTo) && ms(s.ends_at) > now.getTime();
}

/** Passets starttid som "HH:MM" i Stockholm, till notistexten. */
export function stockholmClock(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit", hour12: false }).format(
    new Date(iso),
  );
}

export interface ChooseEvening {
  id: string;
  title: string;
  event_date: string;
  series_id: string | null;
  user_id: string;
  shifts: { id: string; role: string; starts_at: string; capacity: number; booked: number }[];
}

export interface ChooseApproval {
  volunteer_id: string;
  scope_key: string;
  role: string;
  status: string;
  decided_at: string | null;
}

export interface ChooseInput {
  /** Kvällar med pass; bara dagens (i Stockholm) tas med. */
  evenings: readonly ChooseEvening[];
  approvals: readonly ChooseApproval[];
  /** Bokade (ej avbokade) pass: vem och vilket pass. */
  signups: readonly { shift_id: string; dancer_id: string }[];
  /** Redan skickade "välj pass": `${userId}|${listingId}`. */
  alreadySent: ReadonlySet<string>;
  today: string;
  now: Date;
}

export interface ChooseReminder {
  userId: string;
  listingId: string;
  title: string;
  scopeKey: string;
}

export const sentKey = (userId: string, listingId: string) => `${userId}|${listingId}`;

/** Kvällens id ur en notislänk som /app/taxi/<id>#valj-pass. */
export function listingIdFromLink(link: string | null): string | null {
  const m = link?.match(/^\/app\/taxi\/([^/#?]+)/);
  return m ? m[1] : null;
}

/**
 * Vem som ska få "Du är godkänd – välj pass" nu. Avstängda filtreras bort av
 * den som anropar (det kräver varningsunderlaget per person).
 */
export function chooseShiftReminders(i: ChooseInput): ChooseReminder[] {
  if (isQuietHour(i.now)) return [];
  const out: ChooseReminder[] = [];
  const shiftEvening = new Map<string, ChooseEvening>();
  for (const e of i.evenings) for (const s of e.shifts) shiftEvening.set(s.id, e);
  // Vilka som har bokat något den kvällen, och vilka taxidansare som är anmälda.
  const bookedOn = new Map<string, Set<string>>();
  const taxiOn = new Map<string, Set<string>>();
  for (const su of i.signups) {
    const e = shiftEvening.get(su.shift_id);
    if (!e) continue;
    if (!bookedOn.has(e.id)) bookedOn.set(e.id, new Set());
    bookedOn.get(e.id)!.add(su.dancer_id);
    if (e.shifts.find((s) => s.id === su.shift_id)?.role === "taxi_dancer") {
      if (!taxiOn.has(e.id)) taxiOn.set(e.id, new Set());
      taxiOn.get(e.id)!.add(su.dancer_id);
    }
  }

  for (const e of i.evenings) {
    if (e.event_date !== i.today) continue;
    const scope = approvalScopeKey(e);
    const open = e.shifts.filter((s) => ms(s.starts_at) > i.now.getTime() && s.booked < s.capacity);
    if (open.length === 0) continue;
    const taxiFull = (taxiOn.get(e.id)?.size ?? 0) >= TAXI_MAX_PER_EVENING;
    // Godkända roller per person i kvällens avgränsning.
    const roles = new Map<string, { roles: Set<string>; latest: number }>();
    for (const a of i.approvals) {
      if (a.scope_key !== scope || a.status !== "approved") continue;
      const r = roles.get(a.volunteer_id) ?? { roles: new Set<string>(), latest: -Infinity };
      r.roles.add(a.role);
      if (a.decided_at) r.latest = Math.max(r.latest, ms(a.decided_at));
      roles.set(a.volunteer_id, r);
    }
    for (const [userId, r] of roles) {
      if (bookedOn.get(e.id)?.has(userId)) continue;
      if (i.alreadySent.has(sentKey(userId, e.id))) continue;
      if (i.now.getTime() - r.latest < CHOOSE_REMINDER_AFTER_APPROVAL_MINUTES * MIN) continue;
      const fits = open.some((s) => r.roles.has(s.role) && !(s.role === "taxi_dancer" && taxiFull));
      if (!fits) continue;
      out.push({ userId, listingId: e.id, title: e.title, scopeKey: scope });
    }
  }
  return out;
}
