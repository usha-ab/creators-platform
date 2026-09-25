-- Grundarpartner.
--
-- Tidiga kreatörer i regioner där Usha inte finns ännu får verktygen till
-- självkostnad: ingen månadsavgift, ingen provision, inget tak på antal
-- utbud. Usha tar bara det Stripe tar, så relationen kan aldrig gå med
-- förlust — den har helt enkelt ingen marginal att förlora.
--
-- Motprestationen är utbud, inte pengar: de öppna kvällarna ligger på
-- plattformen. Vi tjänar på relationen genom undervisning på plats, inte
-- genom avgifter.
--
-- Statusen är tidsatt. "Gratis för alltid" går inte att backa från, medan
-- ett slutdatum går att förlänga hur många gånger som helst.

alter table public.profiles
  add column if not exists founding_partner_since timestamptz,
  add column if not exists founding_partner_until timestamptz;

comment on column public.profiles.founding_partner_since is
  'När grundarpartnerstatusen började gälla. NULL = inte grundarpartner.';
comment on column public.profiles.founding_partner_until is
  'När statusen upphör. NULL = tills vidare. Sätt hellre ett datum och förläng.';

-- Bara aktiva rader är intressanta, och de är få.
create index if not exists profiles_founding_partner_idx
  on public.profiles (founding_partner_since)
  where founding_partner_since is not null;

-- Kolumnerna är en privilegiebeviljning: utan lås kan vem som helst ge sig
-- själv avgiftsfrihet med en vanlig profiluppdatering. Samma mönster som
-- tier, role och is_admin — användarkontext får aldrig skriva dem, bara
-- service_role.
--
-- Funktionen skrivs om i sin helhet eftersom Postgres saknar sätt att lägga
-- till en rad i en befintlig kropp. Listan nedan MÅSTE hållas i synk med
-- 20260911_affiliate_program.sql — tappas en kolumn här öppnas den igen.
create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $func$
begin
  if (select auth.role()) = 'service_role' then
    return new;
  end if;

  new.tier := old.tier;
  new.role := old.role;
  new.is_admin := old.is_admin;
  new.creator_subcategory := old.creator_subcategory;
  new.stripe_account_id := old.stripe_account_id;
  new.bankid_verified_at := old.bankid_verified_at;
  new.bankid_personal_number := old.bankid_personal_number;
  new.bankid_name := old.bankid_name;
  new.bankid_grandfathered_at := old.bankid_grandfathered_at;
  new.stripe_card_payments_enabled := old.stripe_card_payments_enabled;
  new.stripe_charges_enabled := old.stripe_charges_enabled;
  new.stripe_details_submitted := old.stripe_details_submitted;
  new.is_usha_owned_seller := old.is_usha_owned_seller;
  new.referral_code := old.referral_code;
  new.referred_by := old.referred_by;
  new.referred_at := old.referred_at;
  new.founding_partner_since := old.founding_partner_since;
  new.founding_partner_until := old.founding_partner_until;

  return new;
end;
$func$;
