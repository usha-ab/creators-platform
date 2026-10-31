import type { SupabaseClient } from "@supabase/supabase-js";

export type BankIdLoginTarget =
  | { ok: true; userId: string; email: string }
  | { ok: false; reason: "no_account" | "email_unconfirmed" };

/**
 * Vilket konto hör det här BankID:t till? Personnumret finns bara som hash
 * (deterministisk HMAC), så uppslaget görs på hashen. Ett raderat konto har
 * fått hashen nollad och hittas därför inte.
 *
 * Inloggningen går via en engångslänk till kontots e-post, så adressen måste
 * vara bekräftad: annars skulle BankID-inloggningen tyst bekräfta en adress
 * som ingen visat att de äger.
 */
export async function findBankIdLoginTarget(
  admin: SupabaseClient,
  hashedNin: string
): Promise<BankIdLoginTarget> {
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("bankid_personal_number", hashedNin)
    .is("deleted_at", null)
    .maybeSingle();
  if (!profile) return { ok: false, reason: "no_account" };

  const { data, error } = await admin.auth.admin.getUserById(profile.id);
  const user = data?.user;
  if (error || !user?.email) return { ok: false, reason: "no_account" };
  if (!user.email_confirmed_at) return { ok: false, reason: "email_unconfirmed" };
  return { ok: true, userId: user.id, email: user.email };
}
