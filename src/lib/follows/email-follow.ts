import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Följare utan konto.
 *
 * Aktivt ja är hela poängen: en rad skapas bara när någon själv tryckt på en
 * knapp eller skrivit in sin adress, och från eventsidan skickas inget förrän
 * bekräftelselänken klickats. Tystnad är aldrig ett ja (se
 * feedback_marketing_consent).
 */
export interface EmailFollowRow {
  id: string;
  email: string;
  followed_id: string;
  locale: string | null;
  source: "ticket" | "event_page";
  confirm_token: string;
  confirmed_at: string | null;
  unsubscribe_token: string;
  unsubscribed_at: string | null;
}

export type EmailFollowState = "none" | "pending" | "active" | "unsubscribed";

const COLUMNS = "id, email, followed_id, locale, source, confirm_token, confirmed_at, unsubscribe_token, unsubscribed_at";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export function emailFollowState(row: Pick<EmailFollowRow, "confirmed_at" | "unsubscribed_at"> | null | undefined): EmailFollowState {
  if (!row) return "none";
  if (row.unsubscribed_at) return "unsubscribed";
  if (row.confirmed_at) return "active";
  return "pending";
}

export async function findEmailFollow(
  admin: SupabaseClient,
  email: string,
  followedId: string
): Promise<EmailFollowRow | null> {
  const { data } = await admin
    .from("email_follows")
    .select(COLUMNS)
    .eq("email", normalizeEmail(email))
    .eq("followed_id", followedId)
    .maybeSingle();
  return (data as EmailFollowRow | null) ?? null;
}

/**
 * Lägger till eller återaktiverar en följning. `confirmed` = källan räcker som
 * bekräftelse (biljettsidan). Returnerar raden och om den redan var aktiv, så
 * att anroparen slipper skicka ett bekräftelsemejl i onödan.
 */
export async function subscribeEmailFollow(
  admin: SupabaseClient,
  input: { email: string; followedId: string; locale?: string | null; source: "ticket" | "event_page"; confirmed: boolean }
): Promise<{ row: EmailFollowRow; wasActive: boolean }> {
  const email = normalizeEmail(input.email);
  const existing = await findEmailFollow(admin, email, input.followedId);
  const now = new Date().toISOString();

  if (!existing) {
    const { data, error } = await admin
      .from("email_follows")
      .insert({
        email,
        followed_id: input.followedId,
        locale: input.locale ?? null,
        source: input.source,
        confirmed_at: input.confirmed ? now : null,
      })
      .select(COLUMNS)
      .single();
    if (error || !data) throw new Error(error?.message ?? "insert failed");
    return { row: data as EmailFollowRow, wasActive: false };
  }

  const wasActive = emailFollowState(existing) === "active";
  const { data, error } = await admin
    .from("email_follows")
    .update({
      unsubscribed_at: null,
      locale: input.locale ?? existing.locale,
      source: input.source,
      confirmed_at: existing.confirmed_at ?? (input.confirmed ? now : null),
    })
    .eq("id", existing.id)
    .select(COLUMNS)
    .single();
  if (error || !data) throw new Error(error?.message ?? "update failed");
  return { row: data as EmailFollowRow, wasActive };
}

export async function unsubscribeEmailFollow(
  admin: SupabaseClient,
  email: string,
  followedId: string
): Promise<void> {
  await admin
    .from("email_follows")
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq("email", normalizeEmail(email))
    .eq("followed_id", followedId)
    .is("unsubscribed_at", null);
}

/** Bekräftelselänken från mejlet. Idempotent: en redan bekräftad länk är fortfarande "klart". */
export async function confirmEmailFollowByToken(admin: SupabaseClient, token: string): Promise<EmailFollowRow | null> {
  const { data } = await admin.from("email_follows").select(COLUMNS).eq("confirm_token", token).maybeSingle();
  if (!data) return null;
  const row = data as EmailFollowRow;
  if (!row.confirmed_at || row.unsubscribed_at) {
    const { data: updated } = await admin
      .from("email_follows")
      .update({ confirmed_at: row.confirmed_at ?? new Date().toISOString(), unsubscribed_at: null })
      .eq("id", row.id)
      .select(COLUMNS)
      .single();
    return (updated as EmailFollowRow | null) ?? row;
  }
  return row;
}

/** Avslutalänken från mejlet. Idempotent. */
export async function unsubscribeEmailFollowByToken(admin: SupabaseClient, token: string): Promise<EmailFollowRow | null> {
  const { data } = await admin.from("email_follows").select(COLUMNS).eq("unsubscribe_token", token).maybeSingle();
  if (!data) return null;
  const row = data as EmailFollowRow;
  if (!row.unsubscribed_at) {
    await admin.from("email_follows").update({ unsubscribed_at: new Date().toISOString() }).eq("id", row.id);
  }
  return row;
}

/** De som ska ha mejl: bekräftade och inte avslutade. */
export async function activeEmailFollowers(admin: SupabaseClient, followedId: string): Promise<EmailFollowRow[]> {
  const { data } = await admin
    .from("email_follows")
    .select(COLUMNS)
    .eq("followed_id", followedId)
    .not("confirmed_at", "is", null)
    .is("unsubscribed_at", null);
  return (data as EmailFollowRow[] | null) ?? [];
}
