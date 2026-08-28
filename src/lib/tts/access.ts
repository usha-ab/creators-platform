// Vem som får öppna uppläsaren.
//
// Lyssna är inte längre en funktion för alla på plattformen: den är ett privat
// verktyg medan den bryts ut till en egen app. Grinden sitter på servern —
// sidan och API-rutterna — inte bara i menyn, för en dold sida är inte en
// stängd sida.
//
// Två sätt att få tillgång: uttrycklig id-lista i LISTEN_ALLOWED_USER_IDS,
// eller full admin. Listan finns för konton som inte är admin (telefonen kan
// vara inloggad som något annat än kontoägaren).

import { isAdminById } from "@/lib/admin/check";

/** Läser id-listan ur miljövariabeln. Skräp och dubbletter faller bort. */
export function parseAllowedIds(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return Array.from(
    new Set(
      raw
        .split(/[,\s]+/)
        .map((id) => id.trim().toLowerCase())
        .filter((id) => uuid.test(id))
    )
  );
}

/** Står användaren på listan? Ren funktion, så regeln går att testa. */
export function isAllowedById(userId: string | null | undefined, allowed: string[]): boolean {
  if (!userId) return false;
  return allowed.includes(userId.toLowerCase());
}

/**
 * Får den här användaren använda uppläsaren?
 *
 * Anropas från sidan och från varje API-rutt. Listan läses vid varje anrop och
 * inte en gång vid modulladdning: en ändrad miljövariabel ska räcka, utan att
 * en serverinstans måste startas om för att släppa in någon.
 */
export async function canUseListen(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  if (isAllowedById(userId, parseAllowedIds(process.env.LISTEN_ALLOWED_USER_IDS))) return true;
  return isAdminById(userId);
}
