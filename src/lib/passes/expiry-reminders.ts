import type { SupabaseClient } from "@supabase/supabase-js";
import { createElement } from "react";
import { passRemaining } from "./series-pass";
import { getResend, getFromEmail } from "@/lib/email/resend";
import { renderEmailToHtml } from "@/lib/email/render";
import { getEmailIntl } from "@/lib/email/i18n";
import { resolveRecipientLocale } from "@/lib/i18n/recipient";
import { shouldSendEmail } from "@/lib/email/check-preferences";
import PassExpiryReminder, { getPassExpirySubject } from "@/components/emails/PassExpiryReminder";

/**
 * Påminnelse till innehavaren 30 och 7 dagar före klippkortets sista
 * giltighetsdag, om klipp återstår (Pablos idé, juristens Kodspår 3).
 * Körs en gång om dagen från booking-reminders-cronen.
 */
const DAY_MS = 24 * 3600_000;

export interface ReminderCandidate {
  created_at: string | null;
  pass_expires_at: string | null;
  sessions_total: number | null;
  sessions_redeemed: number | null;
  pass_expiry_reminded_30_at: string | null;
  pass_expiry_reminded_7_at: string | null;
}

/**
 * Vilken påminnelse som ska gå i dag, om någon.
 *
 * 30-dagarspåminnelsen hoppas över för ett kort som köpts de senaste 14
 * dagarna: ett kort med ett klipp gäller en månad, och den som just köpt det
 * ska inte få "ditt kort går ut" dagen efter köpet. 7-dagarspåminnelsen går
 * alltid när klipp finns kvar.
 */
export function reminderDue(b: ReminderCandidate, now: Date = new Date()): "30" | "7" | null {
  if (!b.pass_expires_at || passRemaining(b) <= 0) return null;
  const left = new Date(b.pass_expires_at).getTime() - now.getTime();
  if (left <= 0) return null;
  if (left <= 7 * DAY_MS) return b.pass_expiry_reminded_7_at ? null : "7";
  if (left <= 30 * DAY_MS) {
    if (b.pass_expiry_reminded_30_at) return null;
    const bought = b.created_at ? new Date(b.created_at).getTime() : 0;
    return now.getTime() - bought >= 14 * DAY_MS ? "30" : null;
  }
  return null;
}

export async function sendPassExpiryReminders(admin: SupabaseClient, now: Date = new Date()): Promise<number> {
  const { data: cards, error } = await admin
    .from("bookings")
    .select(
      "id, listing_id, customer_id, guest_email, guest_name, created_at, pass_expires_at, sessions_total, sessions_redeemed, pass_expiry_reminded_30_at, pass_expiry_reminded_7_at"
    )
    .eq("status", "confirmed")
    .not("sessions_total", "is", null)
    .gt("pass_expires_at", now.toISOString())
    .lte("pass_expires_at", new Date(now.getTime() + 30 * DAY_MS).toISOString());
  if (error) {
    console.error("Klippkort att påminna kunde inte läsas:", error);
    return 0;
  }

  let sent = 0;
  for (const c of cards ?? []) {
    const due = reminderDue(c, now);
    if (!due) continue;

    let to: string | null = c.guest_email;
    let name: string = c.guest_name || "";
    if (c.customer_id) {
      if (!(await shouldSendEmail(c.customer_id, "notif_booking_confirmed"))) continue;
      const { data: prof } = await admin.from("profiles").select("email, full_name").eq("id", c.customer_id).maybeSingle();
      to = prof?.email || to;
      name = prof?.full_name || name;
    }
    if (!to) continue;

    const { data: listing } = await admin.from("listings").select("title").eq("id", c.listing_id).maybeSingle();
    try {
      const { t, locale } = await getEmailIntl(await resolveRecipientLocale({ userId: c.customer_id, email: to }));
      const expiresAt = new Date(c.pass_expires_at!);
      const passTitle = listing?.title || "Usha";
      const html = await renderEmailToHtml(
        createElement(PassExpiryReminder, {
          holderName: name || to.split("@")[0],
          passTitle,
          remaining: passRemaining(c),
          expiresAt,
          bookingId: c.id,
          t,
          locale,
        })
      );
      const { error: sendErr } = await getResend().emails.send({
        from: getFromEmail(),
        to,
        subject: getPassExpirySubject(t, passTitle, expiresAt, locale),
        html,
      });
      if (sendErr) {
        console.error(`Påminnelsen om klippkortet ${c.id} gick inte iväg:`, sendErr);
        continue;
      }
      // 7-dagarspåminnelsen markerar också 30, så att den aldrig kommer efteråt.
      const stamp = new Date().toISOString();
      await admin
        .from("bookings")
        .update(
          due === "7"
            ? { pass_expiry_reminded_7_at: stamp, pass_expiry_reminded_30_at: c.pass_expiry_reminded_30_at ?? stamp }
            : { pass_expiry_reminded_30_at: stamp }
        )
        .eq("id", c.id);
      sent++;
    } catch (err) {
      console.error(`Påminnelsen om klippkortet ${c.id} misslyckades:`, err);
    }
  }
  return sent;
}
