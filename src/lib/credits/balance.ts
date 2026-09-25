import type { SupabaseClient } from "@supabase/supabase-js";

/** Saldo i credit_ledger (öre). Intjänad kredit, till skillnad från välkomstavdraget. */
export async function getCreditLedgerBalance(admin: SupabaseClient, profileId: string): Promise<number> {
  const { data } = await admin.from("credit_ledger").select("delta_ore").eq("profile_id", profileId);
  return (data ?? []).reduce((sum, r) => sum + (r.delta_ore ?? 0), 0);
}

/** Hur mycket av ledgersaldot som kan användas på en order. Ingen minimigräns – krediten är intjänad. */
export function applicableLedgerCredit(balanceOre: number, remainingSubtotalOre: number): number {
  if (!Number.isFinite(balanceOre) || balanceOre <= 0) return 0;
  if (!Number.isFinite(remainingSubtotalOre) || remainingSubtotalOre <= 0) return 0;
  return Math.min(Math.floor(balanceOre), Math.floor(remainingSubtotalOre));
}
