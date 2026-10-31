import type { SupabaseClient } from "@supabase/supabase-js";
import { birthDateOrNull } from "@/lib/bankid/birth-date";
import { computeAge } from "@/lib/age";
import type { BankIdVerifiedData } from "@/types/bankid";

export type ApplyBankIdResult =
  | { ok: true }
  | { ok: false; reason: "age_restricted" | "duplicate" | "update_failed" };

/**
 * Skriver en BankID-verifiering (från den signerade bankid_verified-cookien)
 * på ett konto. Den ENDA vägen dit: registreringen, inloggningen och
 * OAuth-återkomsten anropar alla den här, så att de inte glider isär igen.
 * Tidigare skrev OAuth-vägen över kontots roll, hoppade över 18-årsgränsen
 * och sparade inget födelsedatum.
 *
 * Rollen rörs aldrig: BankID bevisar identitet, inte roll. Underkategorin
 * skrivs bara när anroparen uttryckligen ger den (ett konto som nyss skapats
 * via OAuth, där triggern inte fick den ur metadata).
 */
export async function applyBankIdVerification(
  admin: SupabaseClient,
  userId: string,
  data: BankIdVerifiedData,
  opts: { subcategory?: BankIdVerifiedData["subcategory"] } = {}
): Promise<ApplyBankIdResult> {
  // 18-årsgränsen för taxidansare kontrolleras igen här, ifall underkategorin
  // sattes efter BankID-återkomsten. Den primära kontrollen sker i callbacken.
  const { data: profile } = await admin
    .from("profiles")
    .select("creator_subcategory")
    .eq("id", userId)
    .maybeSingle();

  const subcategory = opts.subcategory ?? profile?.creator_subcategory;
  if (subcategory === "taxi_dancer" && computeAge(data.dateOfBirth) < 18) {
    if (profile?.creator_subcategory === "taxi_dancer") {
      await admin.from("profiles").update({ creator_subcategory: "general" }).eq("id", userId);
    }
    return { ok: false, reason: "age_restricted" };
  }

  const { data: dup } = await admin
    .from("profiles")
    .select("id")
    .eq("bankid_personal_number", data.hashedNin)
    .neq("id", userId)
    .maybeSingle();
  if (dup) return { ok: false, reason: "duplicate" };

  const update: Record<string, string | null> = {
    bankid_verified_at: data.verifiedAt,
    bankid_personal_number: data.hashedNin,
    bankid_name: data.name,
    // Födelsedatumet behövs för åldersgränser; personnumret sparas bara som hash.
    bankid_birth_date: birthDateOrNull(data.dateOfBirth),
  };
  if (opts.subcategory) update.creator_subcategory = opts.subcategory;

  const { error } = await admin.from("profiles").update(update).eq("id", userId);
  if (error) {
    console.error("applyBankIdVerification update failed:", error.message);
    return { ok: false, reason: "update_failed" };
  }
  return { ok: true };
}
