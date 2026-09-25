/**
 * Engångsutskick: berätta för kontoinnehavare att de har ett välkomstavdrag.
 *
 * Avdraget delas ut av en trigger och syns annars först i kassan, så utan det
 * här mejlet är det en förmån bara den upptäcker som ändå tänkte handla.
 *
 * Kör (--tsconfig krävs: mallen är JSX och kompileras utanför Next):
 *   npx vercel env pull /tmp/env.prod --environment=production
 *   ENV_FILE=/tmp/env.prod npx tsx --tsconfig scripts/tsconfig.script.json \
 *     scripts/send-welcome-credit.ts            # dry run, skickar inget
 *   ... scripts/send-welcome-credit.ts --send   # skickar på riktigt
 *   ... --only nagon@example.com                # en enda adress
 *
 * Urvalet: oanvänt avdrag, AKTIVT ja till marknadsföring (notif_marketing =
 * true — en tom inställningsrad räknas som nej, precis som appen visar den),
 * och inte redan mejlat (notified_at). Kolumnen gör körningen ofarlig att
 * upprepa: ett avbrutet utskick kan köras om utan att någon får mejlet två
 * gånger.
 */
import { config } from 'dotenv';
// RESEND_API_KEY och service-role-nyckeln finns bara i Vercel, inte i
// .env.local. ENV_FILE pekar körningen på en nedladdad produktionsfil
// (`vercel env pull`) utan att den behöver ligga kvar i repot.
config({ path: process.env.ENV_FILE || '.env.local' });

import { createAdminClient } from '@/lib/supabase/admin';
import { sendWelcomeCreditEmail } from '@/lib/email/send-welcome-credit';
import { SIGNUP_CREDIT_MIN_SPEND_ORE } from '@/lib/credits/signup';

const SEND = process.argv.includes('--send');
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null;

/** Ett förnamn är vänligare än hela namnet, och adressen är sista utvägen. */
function firstName(fullName: string | null, email: string): string {
  const trimmed = (fullName ?? '').trim();
  if (trimmed) return trimmed.split(/\s+/)[0];
  return email.split('@')[0];
}

async function main() {
  const db = createAdminClient();

  const { data: credits, error } = await db
    .from('account_credits')
    .select('user_id, amount_ore, expires_at, used_at, notified_at')
    .is('used_at', null)
    .is('notified_at', null);
  if (error) throw error;

  const ids = (credits ?? []).map((c) => c.user_id);
  const { data: profiles } = await db
    .from('profiles')
    .select('id, email, full_name, deleted_at')
    .in('id', ids);
  const { data: settings } = await db
    .from('user_settings')
    .select('user_id, notif_marketing')
    .in('user_id', ids);

  // Aktivt ja krävs. Tidigare filtrerades bara de bort som uttryckligen tackat
  // nej, vilket gjorde tystnad till ett samtycke — och appen visar samtidigt
  // marknadsföring som avstängd för den som aldrig sparat något.
  const optedIn = new Set(
    (settings ?? []).filter((s) => s.notif_marketing === true).map((s) => s.user_id)
  );
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  const recipients = (credits ?? [])
    .map((c) => ({ credit: c, profile: byId.get(c.user_id) }))
    .filter(({ credit, profile }) => {
      if (!profile?.email || profile.deleted_at) return false;
      if (!optedIn.has(credit.user_id)) return false;
      if (ONLY && profile.email !== ONLY) return false;
      return true;
    });

  console.log(`${recipients.length} mottagare${SEND ? '' : ' (DRY RUN — inget skickas)'}`);
  if (!SEND) {
    for (const { profile } of recipients) console.log(`  ${profile!.email}`);
    console.log('\nKör med --send för att skicka.');
    return;
  }

  let sent = 0;
  let failed = 0;
  for (const { credit, profile } of recipients) {
    try {
      await sendWelcomeCreditEmail({
        to: profile!.email,
        recipientName: firstName(profile!.full_name, profile!.email),
        amount: credit.amount_ore / 100,
        minSpend: SIGNUP_CREDIT_MIN_SPEND_ORE / 100,
        expiresAt: credit.expires_at ? new Date(credit.expires_at) : new Date(),
        userId: credit.user_id,
      });
      // Märks direkt efter varje lyckat mejl, inte i en klumpsumma på slutet:
      // kraschar skriptet halvvägs ska omkörningen hoppa över de som fått.
      await db
        .from('account_credits')
        .update({ notified_at: new Date().toISOString() })
        .eq('user_id', credit.user_id);
      sent++;
      console.log(`  ✓ ${profile!.email}`);
      // Resend tar 2/s på gratisplanen; en paus är billigare än en rate-limit.
      await new Promise((r) => setTimeout(r, 600));
    } catch (e) {
      failed++;
      console.error(`  ✗ ${profile!.email}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`\nSkickade ${sent}, misslyckades ${failed}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
