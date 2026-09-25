-- Dra åt EXECUTE på SECURITY DEFINER-funktioner som inte ska nås utifrån.
--
-- Supabase-linten flaggade att anon kan anropa dem via /rest/v1/rpc/<namn>.
-- Grundorsaken är att PUBLIC har EXECUTE som standard på nya funktioner
-- (acl "=X/postgres"), och anon och authenticated ärver PUBLIC. Att bara
-- revoka från anon är därför verkningslöst — PUBLIC måste bort först. Samma
-- fälla som kolumn-REVOKE mot en tabellbred grant.
--
-- Varje funktion nedan är kontrollerad mot både appkoden och pg_policies.
-- Två lämnas MEDVETET orörda:
--
--   has_stripe_connect  — anropas på /creators/[id] och /listing/[id], som är
--                         publika sidor. En utloggad besökare är anon, så
--                         revoke skulle ge fel på varje profilvisning.
--   is_bankid_cleared   — används i fyra RLS-policies (listings, gigs,
--                         gig_applications, event_instructors) med cmd ALL och
--                         roll public. Postgres evaluerar policyns qual även
--                         för anon SELECT; utan EXECUTE fallerar publik läsning
--                         av listings, alltså hela sajten.

-- Webhookens idempotensnycklar. Anropas aldrig från den här appen (tillhör
-- shoppen) och ska bara nås av service_role. En anonym anropare kunde annars
-- förhandsclaima ett event-id så att den riktiga webhooken hoppar över det
-- — kunden betalar, biljetten skapas aldrig — eller radera en claim och
-- öppna för dubbelbehandling.
revoke execute on function public.claim_stripe_event(text, text) from public, anon, authenticated;
revoke execute on function public.release_stripe_event(text) from public, anon, authenticated;

-- Triggerfunktion. Triggern körs av systemet och kräver ingen EXECUTE hos den
-- som utlöser den, så ingen behöver kunna anropa den som RPC.
revoke execute on function public.protect_stripe_account_rebind() from public, anon, authenticated;

-- Anropas bara med adminklienten (src/lib/storage/quota.ts). Utan detta kunde
-- vem som helst fråga hur mycket lagring en godtycklig användare förbrukar.
revoke execute on function public.user_storage_bytes(uuid) from public, anon, authenticated;

-- Adminkontroller: authenticated behöver dem (rollmenyn), anon aldrig.
revoke execute on function public.current_user_admin_capabilities() from public, anon;
revoke execute on function public.is_current_user_admin() from public, anon;
grant execute on function public.current_user_admin_capabilities() to authenticated;
grant execute on function public.is_current_user_admin() to authenticated;

-- Lintens sista varning: utan fast search_path kan en angripare med rätt att
-- skapa objekt i ett tidigare schema kapa namnuppslag inne i funktionen.
-- Den här körs som trigger på auth.users vid varje registrering.
alter function public.handle_new_user() set search_path = public, pg_temp;
