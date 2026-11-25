/**
 * Räknaren i dörren: sålda, incheckade och inte komna för en kväll.
 *
 * Två källor:
 *  - Biljettbokningar på kvällen. En order för flera räknas per plats. Har
 *    ordern deltagarrader räknas de som checkats in en och en; annars (Swish
 *    för ett sällskap, enkelbiljett) är hela ordern inne när checked_in_at satts.
 *  - Klipp på klippkort. Ett klipp är både en såld och en incheckad plats:
 *    kortinnehavare som inte kommit går inte att räkna som "väntade".
 * Bara betalda bokningar (confirmed/completed) räknas.
 */

export interface CountBooking {
  id: string;
  status: string;
  guest_count: number | null;
  checked_in_at: string | null;
}

export interface CountAttendee {
  booking_id: string;
  checked_in_at: string | null;
}

export interface EntryCounts {
  sold: number;
  checkedIn: number;
  notArrived: number;
  /** Varav klipp på klippkort (ingår i sold och checkedIn). */
  clips: number;
}

export function entryCounts(
  bookings: readonly CountBooking[],
  attendees: readonly CountAttendee[],
  clips: number
): EntryCounts {
  const byBooking = new Map<string, { total: number; inside: number }>();
  for (const a of attendees) {
    const e = byBooking.get(a.booking_id) ?? { total: 0, inside: 0 };
    e.total++;
    if (a.checked_in_at) e.inside++;
    byBooking.set(a.booking_id, e);
  }

  let sold = 0;
  let checkedIn = 0;
  for (const b of bookings) {
    if (b.status !== "confirmed" && b.status !== "completed") continue;
    const seats = Math.max(1, b.guest_count ?? 1);
    sold += seats;
    const rows = byBooking.get(b.id);
    if (rows && rows.total > 0) checkedIn += Math.min(seats, rows.inside);
    else if (b.checked_in_at) checkedIn += seats;
  }

  const c = Math.max(0, clips);
  return { sold: sold + c, checkedIn: checkedIn + c, notArrived: Math.max(0, sold - checkedIn), clips: c };
}
