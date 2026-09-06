import { createAdminClient } from "@/lib/supabase/admin";

type NotifKey =
  | "notif_booking_new"
  | "notif_booking_confirmed"
  | "notif_booking_canceled"
  | "notif_payout"
  | "notif_creator_events"
  | "notif_marketing";

/**
 * Nycklar som kräver ett aktivt ja innan vi skickar.
 *
 * Övriga notiser handlar om något användaren själv satt igång — en bokning,
 * en utbetalning — och tystnad betyder där rimligen "ja tack". Marknadsföring
 * är motsatsen: den utgår från oss, och ett tomt val är inget samtycke.
 *
 * Detta är också vad appen redan påstår. Inställningssidan renderar
 * marknadsföring som AV för den som aldrig sparat något (se
 * app/settings/notifications och GET /api/settings, som båda defaultar till
 * false), medan den här funktionen tidigare svarade true på samma tomma rad.
 * Den som läste sina inställningar såg alltså "av" och fick mejlet ändå.
 */
const REQUIRES_OPT_IN: ReadonlySet<NotifKey> = new Set(["notif_marketing"]);

/**
 * Får vi skicka den här sortens mejl till användaren?
 *
 * Saknad rad = användaren har aldrig rört inställningarna. För transaktionella
 * notiser tolkas det som ja, för marknadsföring som nej.
 */
export async function shouldSendEmail(
  userId: string,
  notifKey: NotifKey
): Promise<boolean> {
  const optInRequired = REQUIRES_OPT_IN.has(notifKey);
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  // Ett databasfel är inte ett samtycke. Hellre ett uteblivet reklamutskick än
  // ett som gick ut för att en fråga råkade fallera.
  if (error) return !optInRequired;
  if (!data) return !optInRequired;

  const value = (data as Record<string, unknown>)[notifKey];
  if (optInRequired) return value === true;
  return value !== false;
}
