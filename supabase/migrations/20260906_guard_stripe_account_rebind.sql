-- Guard against silently re-binding a profile to a different Stripe account.
--
-- Why: on 2026-08-19 a creator profile was repointed from acct_1THYIe… to a
-- newly created connected account. The old account was left orphaned — no
-- profile referenced it any more — while still carrying a -215,34 SEK balance
-- from a refund issued after payout. Nothing in the app can do this: both
-- onboarding routes write stripe_account_id only when it is NULL, and
-- protect_profile_privileged_columns() already restores it for authenticated
-- users. The rebind therefore came through service_role (an admin client or a
-- direct SQL edit), which that trigger deliberately lets through.
--
-- A connected account can hold money and owe money, so losing its owner is a
-- financial event, not a bookkeeping detail. This guard blocks the rebind for
-- EVERY role, service_role included, and requires a deliberate opt-in in the
-- same transaction to proceed.
--
-- Deliberate rebind:
--   begin;
--   set local app.allow_stripe_account_rebind = 'on';
--   update public.profiles set stripe_account_id = 'acct_…' where id = '…';
--   commit;

CREATE OR REPLACE FUNCTION public.protect_stripe_account_rebind()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
BEGIN
  -- First connection: nothing to lose.
  IF OLD.stripe_account_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Unchanged (this also covers user-context updates, which the privileged-column
  -- trigger has already reset to OLD before this trigger runs).
  IF NEW.stripe_account_id IS NOT DISTINCT FROM OLD.stripe_account_id THEN
    RETURN NEW;
  END IF;

  IF coalesce(current_setting('app.allow_stripe_account_rebind', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Profil % är redan kopplad till Stripe-kontot % och kan inte bytas till % utan uttryckligt medgivande.',
    OLD.id, OLD.stripe_account_id, coalesce(NEW.stripe_account_id, 'NULL')
    USING
      ERRCODE = 'raise_exception',
      HINT = 'Ett anslutet konto kan bära saldo och skulder. Kör "set local app.allow_stripe_account_rebind = ''on'';" i samma transaktion om bytet är avsiktligt.';
END;
$func$;

-- Runs after protect_profile_privileged_columns_trigger (triggers fire in
-- alphabetical order, and 'profile' sorts before 'stripe'), so a user-context
-- update has already had stripe_account_id restored and passes silently here
-- instead of erroring.
DROP TRIGGER IF EXISTS protect_stripe_account_rebind_trigger ON public.profiles;
CREATE TRIGGER protect_stripe_account_rebind_trigger
BEFORE UPDATE OF stripe_account_id ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_stripe_account_rebind();

COMMENT ON FUNCTION public.protect_stripe_account_rebind() IS
  'Blocks changing or clearing profiles.stripe_account_id once set, for every role including service_role. Orphaning a connected account can strand a real balance. Opt in per transaction with app.allow_stripe_account_rebind.';
