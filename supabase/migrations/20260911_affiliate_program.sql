-- Partnerprogram ("Usha Partner"): belöningar för den som värvar.
--
-- Bakgrund: referral fanns (profiles.referral_code / referred_by) men gav
-- värvaren ingenting, attribuerade bara via /signup?ref= utan cookie, och lät
-- användaren själv skriva referred_by (self-grant). Den värvades 50 kr-promo
-- gick dessutom inte att lösa in i biljettkassan. Här: en ledger för belöningar,
-- attribuering på köp (även gäster), klickräkning, lås på kolumnerna, och ett
-- triggerhugg för "första publicerade utbud".

-- 1. Belöningsledger. profile_id = mottagaren (affiliaten, eller den värvade
--    när hen får sin välkomstmånad). Skrivs bara av service_role.
create table if not exists public.affiliate_rewards (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid not null references public.profiles(id) on delete cascade,
  referred_profile_id uuid references public.profiles(id) on delete set null,
  booking_id          uuid references public.bookings(id) on delete set null,
  kind                text not null check (kind in ('credit', 'premium_days', 'commission_share')),
  amount_ore          integer not null default 0 check (amount_ore >= 0),
  premium_days        integer not null default 0 check (premium_days >= 0),
  status              text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'void')),
  ref                 text not null unique,
  note                text,
  created_at          timestamptz not null default now(),
  paid_at             timestamptz,
  payout_ref          text
);
comment on table public.affiliate_rewards is
  'Partnerprogrammets belöningar. En rad per händelse, idempotent via ref. status: pending → approved → paid, eller void (t.ex. återbetalning).';
create index if not exists affiliate_rewards_profile_idx on public.affiliate_rewards (profile_id, status);
create index if not exists affiliate_rewards_booking_idx on public.affiliate_rewards (booking_id) where booking_id is not null;

alter table public.affiliate_rewards enable row level security;
drop policy if exists "Egna belöningar" on public.affiliate_rewards;
create policy "Egna belöningar" on public.affiliate_rewards
  for select using (auth.uid() = profile_id);
revoke insert, update, delete on public.affiliate_rewards from anon, authenticated;

-- 2. Attribuering på köpet. Gäller även gästköp (ingen profil, bara cookie).
alter table public.bookings
  add column if not exists referred_by uuid references public.profiles(id) on delete set null;
create index if not exists bookings_referred_by_idx on public.bookings (referred_by) where referred_by is not null;
comment on column public.bookings.referred_by is 'Partnern vars länk ledde till köpet (12-månadersfönster från registrering, eller cookie för gäster).';

-- När kontot värvades – fönstret för partnerns andel räknas härifrån.
alter table public.profiles
  add column if not exists referred_at timestamptz;
update public.profiles set referred_at = coalesce(referred_at, created_at) where referred_by is not null and referred_at is null;

-- 3. Klick per kod och dag. Ingen personinformation.
create table if not exists public.referral_clicks (
  code  text not null,
  day   date not null,
  count integer not null default 0,
  primary key (code, day)
);
alter table public.referral_clicks enable row level security;
revoke all on public.referral_clicks from anon, authenticated;

create or replace function public.count_referral_click(p_code text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  -- Bara koder som finns räknas – annars kan vem som helst fylla tabellen
  -- med påhittade koder från adressfältet.
  insert into public.referral_clicks (code, day, count)
  select upper(p_code), (now() at time zone 'Europe/Stockholm')::date, 1
  where exists (select 1 from public.profiles where referral_code = upper(p_code))
  on conflict (code, day) do update set count = public.referral_clicks.count + 1;
$$;
revoke execute on function public.count_referral_click(text) from public, anon, authenticated;

-- 4. Lås referral_code och referred_by för användarkontext. Bara service_role
--    (attribueringen i /callback och /api/referral) får sätta dem.
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

  return new;
end;
$func$;

-- 5. Första publicerade utbudet från en värvad profil: en månad premium till
--    båda (kreatör/venue), eller 50 kr kredit till en partner som inte säljer
--    själv. Ligger i databasen så alla vägar in (event, tjänst, serie) räknas.
create or replace function public.affiliate_on_first_listing()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $func$
declare
  v_ref uuid;
  v_ref_role text;
  v_prior integer;
begin
  if new.is_active is distinct from true then
    return new;
  end if;
  select referred_by into v_ref from public.profiles where id = new.user_id;
  if v_ref is null then
    return new;
  end if;
  select count(*) into v_prior from public.listings
    where user_id = new.user_id and is_active and id <> new.id;
  if v_prior > 0 then
    return new;
  end if;
  select role into v_ref_role from public.profiles where id = v_ref;

  insert into public.affiliate_rewards (profile_id, referred_profile_id, kind, amount_ore, premium_days, ref, note)
  values (
    v_ref, new.user_id,
    case when v_ref_role in ('creator', 'venue') then 'premium_days' else 'credit' end,
    case when v_ref_role in ('creator', 'venue') then 0 else 5000 end,
    case when v_ref_role in ('creator', 'venue') then 30 else 0 end,
    'first_listing:' || new.user_id || ':partner',
    'Värvad profil publicerade sitt första utbud'
  )
  on conflict (ref) do nothing;

  insert into public.affiliate_rewards (profile_id, referred_profile_id, kind, amount_ore, premium_days, ref, note)
  values (new.user_id, null, 'premium_days', 0, 30, 'first_listing:' || new.user_id || ':referred', 'Välkomstmånad premium via partner')
  on conflict (ref) do nothing;

  return new;
end;
$func$;
revoke execute on function public.affiliate_on_first_listing() from public, anon, authenticated;

drop trigger if exists affiliate_on_first_listing_trigger on public.listings;
create trigger affiliate_on_first_listing_trigger
after insert or update of is_active on public.listings
for each row execute function public.affiliate_on_first_listing();
