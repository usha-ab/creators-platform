import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { PAYEE_ELIGIBILITY_COLUMNS, type PayeeEligibility } from "./beta-gate";

/**
 * Läser det mottagarspärren behöver för ett profil-id, alltid med service-role.
 *
 * F-skattekolumnerna är inte läsbara för anon/authenticated (kolumnlåsningen på
 * profiles), och PostgREST fäller hela frågan om en enda kolumn saknar grant.
 * Därför ett eget uppslag i stället för att lägga kolumnerna i varje sidas select.
 *
 * Misslyckas uppslaget returneras id utan uppgifter: Ushas eget konto går då
 * fortfarande igenom, alla andra spärras. Ett fel får aldrig öppna spärren.
 */
export async function loadPayeeEligibility(
  id: string,
  client?: SupabaseClient,
): Promise<PayeeEligibility> {
  const db = client ?? createAdminClient();
  const { data, error } = await db
    .from("profiles")
    .select(PAYEE_ELIGIBILITY_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("loadPayeeEligibility failed:", error.message);
    return { id };
  }
  const row = data as unknown as PayeeEligibility;
  return {
    id,
    company_form: row.company_form ?? null,
    org_number: row.org_number ?? null,
    f_tax_verified_at: row.f_tax_verified_at ?? null,
  };
}
