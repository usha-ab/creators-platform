import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Har kontoinnehavaren visat att hen äger e-postadressen?
 *
 * Supabase-projektet bekräftar adresser automatiskt (mailer_autoconfirm, för
 * att Supabases egna utskick bara tillåter två mejl i timmen). email_confirmed_at
 * säger därför ingenting: vem som helst kan registrera sig med någon annans
 * adress. Allt som lämnar ut något på adressen — gästbiljetter framför allt —
 * måste fråga här i stället.
 *
 * Bevisad betyder: adressen fick en kod eller länk som användes
 * (BankID-registrering, återställning av lösenord, länk via /confirm), eller
 * Google intygar att adressen är verifierad. Beviset gäller adressen, inte
 * kontot: byter någon adress gäller det inte längre.
 */
export function isEmailProven(user: Pick<User, "email" | "app_metadata" | "identities"> | null | undefined): boolean {
  const email = user?.email?.trim().toLowerCase();
  if (!email) return false;
  if (String(user?.app_metadata?.email_proven ?? "").toLowerCase() === email) return true;
  return (user?.identities ?? []).some(
    (i) =>
      i.provider === "google" &&
      i.identity_data?.email_verified === true &&
      String(i.identity_data?.email ?? "").toLowerCase() === email
  );
}

/** Markera adressen som bevisad. app_metadata kan bara skrivas av service-rollen. */
export async function markEmailProven(admin: SupabaseClient, userId: string, email: string): Promise<void> {
  const { error } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { email_proven: email.trim().toLowerCase() },
  });
  if (error) console.error("markEmailProven failed:", error.message);
}
