"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageListing } from "@/lib/listings/manage-access";
import { revalidatePath } from "next/cache";
import { isAllowedTicketPrice, minPriceError } from "@/lib/stripe/min-price";

// Returns a service-role client ONLY if the current user owns the listing OR is
// an accepted co-organizer (can_manage). Access codes are admin, not money-out
// (they discount the buyer's own checkout), so a co-organizer may manage them.
async function ownerAdmin(listingId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = createAdminClient();
  const { data: listing } = await admin
    .from("listings")
    .select("user_id")
    .eq("id", listingId)
    .maybeSingle();
  if (!listing) return null;
  if (listing.user_id === user.id) return admin;
  return (await canManageListing(admin, user.id, listingId)) ? admin : null;
}

export async function createAccessCode(listingId: string, formData: FormData) {
  const admin = await ownerAdmin(listingId);
  if (!admin) return { error: "Behörighet saknas." };

  const code = String(formData.get("code") || "").trim().toUpperCase();
  if (!code) return { error: "Ange en kod." };
  const label = String(formData.get("label") || "").trim() || null;
  const maxRaw = formData.get("max_uses");
  const maxUses = maxRaw && Number(maxRaw) > 0 ? Math.floor(Number(maxRaw)) : null;
  // discount_price = final ticket price in kr. Empty / 0 = free ticket.
  const discRaw = formData.get("discount_price");
  const discountPrice = discRaw && Number(discRaw) > 0 ? Math.floor(Number(discRaw)) : null;
  // Rabattpriset följer samma regel som biljettpriset: gratis eller minst 50 kr.
  // Ett rabattpris på 20 kr ger samma förlust per biljett som ett ordinarie
  // pris på 20 kr. Befintliga koder rörs inte (de kan inte redigeras här).
  if (!isAllowedTicketPrice(discountPrice)) return minPriceError();

  const { error } = await admin
    .from("event_access_codes")
    .insert({ listing_id: listingId, code, label, max_uses: maxUses, discount_price: discountPrice });
  if (error) {
    return { error: error.code === "23505" ? "Koden finns redan." : "Kunde inte skapa koden." };
  }
  revalidatePath(`/app/events/${listingId}/codes`);
  return { success: true };
}

export async function toggleAccessCode(listingId: string, codeId: string, active: boolean) {
  const admin = await ownerAdmin(listingId);
  if (!admin) return;
  // ownerAdmin auktoriserar listingId, men utan listing_id-filtret här gällde
  // uppdateringen vilken kod som helst i tabellen. Den som äger ett eget event
  // kunde då återaktivera eller stänga av en annan arrangörs koder — alltså
  // gratisbiljetter på deras event, eller ren sabotage.
  await admin
    .from("event_access_codes")
    .update({ is_active: active })
    .eq("id", codeId)
    .eq("listing_id", listingId);
  revalidatePath(`/app/events/${listingId}/codes`);
}
