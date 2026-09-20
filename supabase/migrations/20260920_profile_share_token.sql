-- Delningslänk för dold profil.
--
-- En profil som inte är publik möter 404 för alla utom ägaren och admin. Det
-- är rätt förval, men det saknas ett mellanläge: att visa sig för utvalda
-- utan att synas på marknadsplatsen.
--
-- Token är hemligheten. Den som har länken ser profilen, ingen annan hittar
-- den. Uppslaget sker med service-role på servern, så ingen RLS-policy
-- behöver öppnas — en policy som läser en token ur en frågesträng hade varit
-- både svårare att få rätt och lättare att läcka.

alter table public.profiles
  add column if not exists share_token uuid,
  add column if not exists share_token_created_at timestamptz;

comment on column public.profiles.share_token is
  'Hemlig token för att visa en opublik profil via länk. NULL = ingen delning aktiv. Rotera genom att sätta ett nytt värde.';
comment on column public.profiles.share_token_created_at is
  'När token utfärdades. Finns för att kunna se hur gammal en delning är.';

-- Uppslaget sker på token. Unikt, så två profiler aldrig kan dela samma.
create unique index if not exists profiles_share_token_idx
  on public.profiles (share_token)
  where share_token is not null;

-- Token är en åtkomstnyckel: kan en användare sätta sin egen kan den också
-- sättas till ett gissat värde, eller till någon annans. Bara service_role
-- får skriva den. Samma mönster som tier, role och grundarpartner.
--
-- Funktionen skrivs om i sin helhet — Postgres kan inte lägga till en rad i
-- en befintlig kropp. Listan MÅSTE hållas i synk med
-- 20260919_founding_partner.sql.
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
  new.share_token := old.share_token;
  new.share_token_created_at := old.share_token_created_at;

  return new;
end;
$func$;
