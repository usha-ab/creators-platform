import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/create";
import { checkinReminderRange, isCheckinReminderDue, stockholmClock } from "@/lib/taxi/reminders";

/**
 * Cron (varje kvart): påminn volontären om att checka in när incheckningen
 * öppnar, en timme före passet.
 *
 * Volontären checkar in sig själv på /app/taxi/[kväll] från en timme före
 * passet till dess slut. Ett pass utan incheckning blir en varning när det tar
 * slut, så en volontär som stod där hela kvällen men aldrig tryckte på knappen
 * fick en varning (Sammy, 12 nov). Notisen går som push och leder rakt till
 * knappen.
 *
 * Förr kom påminnelsen när passet redan börjat (The Lab 26 nov: Sammy
 * checkade aldrig in). Fönstret och skälen står i lib/taxi/reminders.ts;
 * checkin_reminded_at hindrar dubbletter.
 */
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();
  const { startsFrom: from, startsTo: to } = checkinReminderRange(now);

  const { data, error } = await admin
    .from("taxi_signups")
    .select("id, dancer_id, status, checked_in_at, checkin_reminded_at, shift:taxi_shifts!inner(listing_id, starts_at, ends_at, listing:listings(title))")
    .eq("status", "booked")
    .is("checked_in_at", null)
    .is("checkin_reminded_at", null)
    .gte("shift.starts_at", from)
    .lte("shift.starts_at", to)
    .gt("shift.ends_at", now.toISOString());
  if (error) {
    console.error("taxi-checkin-reminders query failed:", error);
    return NextResponse.json({ error: "query" }, { status: 500 });
  }

  type Row = {
    id: string;
    dancer_id: string;
    status: string;
    checked_in_at: string | null;
    checkin_reminded_at: string | null;
    shift: { listing_id: string; starts_at: string; ends_at: string; listing: { title: string } | null } | null;
  };

  let sent = 0;
  for (const r of (data ?? []) as unknown as Row[]) {
    if (!r.shift || !isCheckinReminderDue({ ...r, starts_at: r.shift.starts_at, ends_at: r.shift.ends_at }, now)) continue;
    // Markera först: hellre en missad påminnelse än två.
    const { data: marked } = await admin
      .from("taxi_signups")
      .update({ checkin_reminded_at: now.toISOString() })
      .eq("id", r.id)
      .is("checkin_reminded_at", null)
      .select("id");
    if (!marked?.length) continue;
    await createNotification({
      userId: r.dancer_id,
      type: "volunteer_checkin",
      titleKey: "volunteerCheckinTitle",
      bodyKey: "volunteerCheckinOpenMsg",
      params: { title: r.shift.listing?.title ?? "", time: stockholmClock(r.shift.starts_at) },
      link: `/app/taxi/${r.shift.listing_id}`,
    }).catch((e) => console.error("volunteer check-in notification failed:", e));
    sent++;
  }

  return NextResponse.json({ sent });
}
