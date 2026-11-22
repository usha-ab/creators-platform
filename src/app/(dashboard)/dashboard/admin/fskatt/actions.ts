"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertAdmin } from "@/lib/admin/guard";
import { validateFTaxRegistration } from "@/lib/payments/f-tax-registration";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const PATH = "/dashboard/admin/fskatt";

function back(q: string, params: Record<string, string>): never {
  const sp = new URLSearchParams({ q, ...params });
  redirect(`${PATH}?${sp.toString()}`);
}

async function adminUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Registrera en kontrollerad F-skatt (manuell kontroll mot Skatteverket).
 * Bara hel admin: registreringen öppnar för utbetalningar och delegeras inte.
 * Skrivs med service-role; skyddstriggern stoppar alla andra.
 */
export async function registerFTax(formData: FormData) {
  await assertAdmin("full");
  const checkedBy = await adminUserId();
  const admin = createAdminClient();

  const userId = String(formData.get("userId") ?? "").trim();
  const q = String(formData.get("q") ?? "");
  if (!userId) back(q, { error: "not_found" });

  const { data: target } = await admin
    .from("profiles")
    .select("id, org_number, company_verified_at")
    .eq("id", userId)
    .maybeSingle();
  if (!target) back(q, { error: "not_found" });

  const v = validateFTaxRegistration({
    companyForm: String(formData.get("companyForm") ?? ""),
    orgNumber: String(formData.get("orgNumber") ?? ""),
    checkedOn: String(formData.get("checkedOn") ?? ""),
    source: String(formData.get("source") ?? ""),
    existingOrgNumber: (target!.org_number as string | null) ?? null,
    companyVerified: !!target!.company_verified_at,
  });
  if (!v.ok) back(q, { error: v.error });

  const companyName = String(formData.get("companyName") ?? "").trim();
  const update: Record<string, unknown> = {
    company_form: v.companyForm,
    org_number: v.orgNumber,
    f_tax_verified_at: v.checkedAt,
    f_tax_source: v.source,
    f_tax_checked_by: checkedBy,
  };
  // Namnet från VIES skrivs inte över; finns inget får admin fylla i det.
  if (companyName && !target!.company_verified_at) update.company_name = companyName;

  const { error } = await admin.from("profiles").update(update).eq("id", userId);
  if (error) back(q, { error: "save_failed" });

  await admin.from("payee_f_tax_checks").insert({
    profile_id: userId,
    action: "registered",
    checked_at: v.checkedAt,
    source: v.source,
    company_form: v.companyForm,
    org_number: v.orgNumber,
    checked_by: checkedBy,
  });

  revalidatePath(PATH);
  back(q, { updated: "1" });
}

/** Ta bort registrerad F-skatt, t.ex. när Skatteverket visar att den återkallats. */
export async function removeFTax(formData: FormData) {
  await assertAdmin("full");
  const checkedBy = await adminUserId();
  const admin = createAdminClient();

  const userId = String(formData.get("userId") ?? "").trim();
  const q = String(formData.get("q") ?? "");
  if (!userId) back(q, { error: "not_found" });

  const { error } = await admin
    .from("profiles")
    .update({ f_tax_verified_at: null, f_tax_source: null, f_tax_checked_by: checkedBy })
    .eq("id", userId);
  if (error) back(q, { error: "save_failed" });

  await admin.from("payee_f_tax_checks").insert({
    profile_id: userId,
    action: "removed",
    checked_by: checkedBy,
  });

  revalidatePath(PATH);
  back(q, { removed: "1" });
}
