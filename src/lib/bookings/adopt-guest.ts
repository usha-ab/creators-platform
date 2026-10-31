import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Knyt gamla gästköp till kontot som just skapats med samma mejladress.
 *
 * Hälften av alla bokningar är gästköp. De syns visserligen i appen för den
 * som senare skaffar konto — biljettsidan hämtar dem på mejladressen — men
 * raden behåller customer_id = null. Följden är att personen aldrig blir en
 * RÄKNAD deltagare: inte återvändare i statistiken, inte mottagare av notiser,
 * inte någon som kan välja att synas bland deltagarna. Hen ser sin biljett men
 * finns inte i systemet.
 *
 * Adoptionen rättar det i efterhand, utan att be någon göra om något.
 *
 * VARFÖR DET INTE ÄR ETT ÖVERTRAMP: kontot har samma mejladress som köpet
 * gjordes på, OCH har bevisat att det äger adressen (isEmailProven). Det
 * andra villkoret är inte självklart: projektet bekräftar adresser
 * automatiskt, så utan det kunde vem som helst registrera en annans adress och
 * ta över dennes biljetter. Anroparen avgör beviset; utan det händer inget. Ingen ny uppgift blir synlig för
 * någon annan, och show_attendance rörs inte — samtycket att SYNAS är en egen
 * fråga som måste ställas separat.
 *
 * Idempotent: bara rader med customer_id = null berörs, så upprepade anrop
 * (varje inloggning) gör ingenting efter första gången.
 */
export async function adoptGuestBookings(
  admin: SupabaseClient,
  userId: string,
  email: string | null | undefined,
  opts: { emailProven: boolean }
): Promise<number> {
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized || !userId || !opts.emailProven) return 0;

  try {
    const { data } = await admin
      .from("bookings")
      .update({ customer_id: userId })
      .is("customer_id", null)
      // Skiftlägesokänsligt: gamla gästrader är sparade som de skrevs.
      // ilike utan jokertecken är en ren jämförelse, inte en sökning.
      .ilike("guest_email", normalized)
      .select("id");
    return data?.length ?? 0;
  } catch {
    // Adoptionen får aldrig stoppa en inloggning. Misslyckas den ligger
    // raderna kvar som gäst och nästa inloggning försöker igen.
    return 0;
  }
}
