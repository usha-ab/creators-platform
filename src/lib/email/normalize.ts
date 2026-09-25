/**
 * Mejladressen som identitet.
 *
 * Gästbiljetter knyts ihop med konton via mejladressen — statistikens
 * "återkommande", biljettlistan i appen och lokalens samtycke bygger alla på
 * att adressen ser likadan ut varje gång. Gästkassan sparade den däremot
 * precis som den skrevs, och en telefon som storbokstaverar första tecknet
 * räcker för att `guest_email = user.email` ska sluta matcha.
 *
 * Följden är tyst: gästen ser inte sin gamla biljett i appen, dubbelspärren
 * för gratisbiljetter släpper igenom en till, och personen räknas som ny.
 * Inget felmeddelande, bara en post som inte hittar hem.
 *
 * Samma normalisering som consentIdentity redan gör. Den bor här nu så att
 * alla som skriver eller söker på en adress gör det likadant.
 */
export function normalizeEmail(value: string): string;
export function normalizeEmail(value: string | null | undefined): string | null;
export function normalizeEmail(value: string | null | undefined): string | null {
  const e = value?.trim().toLowerCase();
  return e ? e : null;
}
