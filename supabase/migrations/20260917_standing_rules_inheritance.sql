-- Stående regler ska bo där de uttalas, inte kopieras till varje kväll.
--
-- Bakgrund: tre regler var formulerade som "alltid, tills något annat sägs" —
-- Bacchi får 50 % av alla sina kvällar, Nicolas går gratis på alla The Lab-
-- kvällar, Christian är medarrangör på alla Zouk-kvällar. Alla tre lagrades
-- per kväll. En ny kväll började därför tom, och regeln föll tyst. Samma lucka
-- upptäcktes tre gånger på en dag.
--
-- Lösningen är inte en kontroll som larmar i efterhand, utan att kvällen ärver
-- reglerna i samma transaktion som den skapas. Då kan den inte existera utan
-- dem, oavsett om den skapas i appen, via API eller med rå SQL.

-- ---------------------------------------------------------------------------
-- 1. Avtalet med en lokal hör till lokalen
-- ---------------------------------------------------------------------------

create table if not exists public.venue_revenue_share_defaults (
  venue_profile_id  uuid primary key references public.profiles(id) on delete cascade,
  partner_percent   integer not null check (partner_percent >= 0 and partner_percent <= 100),
  vat_rate          numeric not null check (vat_rate >= 0 and vat_rate < 1),
  payout_delay_days integer not null default 1 check (payout_delay_days >= 0 and payout_delay_days <= 30),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.venue_revenue_share_defaults is
  'Standardavtal per lokal. Nya kvällar på lokalen ärver detta till event_revenue_shares.';

alter table public.venue_revenue_share_defaults enable row level security;

-- Läsning: lokalens ägare ser sitt eget avtal. Skrivning sker med service_role,
-- eftersom raden avgör hur mycket pengar som lämnar bolaget.
drop policy if exists "Venue reads own share default" on public.venue_revenue_share_defaults;
create policy "Venue reads own share default"
  on public.venue_revenue_share_defaults for select
  using ((select auth.uid()) = venue_profile_id);

-- ---------------------------------------------------------------------------
-- 2. Stående fribiljetter hör till serien
-- ---------------------------------------------------------------------------

create table if not exists public.series_access_codes (
  id             uuid primary key default gen_random_uuid(),
  series_slug    text not null,
  code           text not null,
  label          text,
  max_uses       integer not null default 1 check (max_uses >= 1),
  -- NULL = gratis, precis som i event_access_codes.
  discount_price integer,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (series_slug, code)
);

comment on table public.series_access_codes is
  'Koder som gäller varje kväll i en serie. Nya kvällar ärver dem till event_access_codes.';

alter table public.series_access_codes enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Stående medarrangörer hör till serien
-- ---------------------------------------------------------------------------

create table if not exists public.series_collaborators (
  id          uuid primary key default gen_random_uuid(),
  series_slug text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('creator','taxi_dancer','volunteer','co_host')),
  can_scan    boolean not null default false,
  can_manage  boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (series_slug, user_id)
);

comment on table public.series_collaborators is
  'Medarrangörer som gäller hela serien. Nya kvällar ärver dem till listing_collaborators.';

alter table public.series_collaborators enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Arvet
-- ---------------------------------------------------------------------------

create or replace function public.inherit_standing_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Klippkort och tjänster har ingen egen kväll att dela intäkten av.
  if new.event_date is not null and new.venue_profile_id is not null then
    insert into public.event_revenue_shares
      (listing_id, partner_profile_id, partner_percent, vat_rate, payout_delay_days)
    select new.id, d.venue_profile_id, d.partner_percent, d.vat_rate, d.payout_delay_days
    from public.venue_revenue_share_defaults d
    where d.venue_profile_id = new.venue_profile_id
    on conflict (listing_id) do nothing;
  end if;

  if new.series_slug is not null then
    insert into public.event_access_codes
      (listing_id, code, label, max_uses, discount_price, is_active)
    select new.id, c.code, c.label, c.max_uses, c.discount_price, c.is_active
    from public.series_access_codes c
    where c.series_slug = new.series_slug and c.is_active
    on conflict (listing_id, code) do nothing;

    insert into public.listing_collaborators
      (listing_id, user_id, role, status, accepted_at, can_scan, can_manage)
    select new.id, s.user_id, s.role, 'accepted', now(), s.can_scan, s.can_manage
    from public.series_collaborators s
    where s.series_slug = new.series_slug
    on conflict (listing_id, user_id) do nothing;
  end if;

  return new;
end;
$$;

-- PUBLIC har EXECUTE som standard, och anon ärver det. En SECURITY DEFINER-
-- funktion som skriver i tre tabeller ska inte gå att anropa utifrån — den ska
-- bara köras av triggern.
revoke all on function public.inherit_standing_rules() from public;
revoke all on function public.inherit_standing_rules() from anon, authenticated;

drop trigger if exists trg_inherit_standing_rules on public.listings;
create trigger trg_inherit_standing_rules
  after insert on public.listings
  for each row execute function public.inherit_standing_rules();

-- ---------------------------------------------------------------------------
-- 5. Reglerna som gäller i dag
-- ---------------------------------------------------------------------------

-- Bacchi Syre: 50 % av allt, moms 25 %, utbetalning dagen efter.
insert into public.venue_revenue_share_defaults
  (venue_profile_id, partner_percent, vat_rate, payout_delay_days)
values ('46d9a376-7d15-4b51-ad5c-f3111bcb9e9a', 50, 0.250, 1)
on conflict (venue_profile_id) do update
  set partner_percent = excluded.partner_percent,
      vat_rate = excluded.vat_rate,
      payout_delay_days = excluded.payout_delay_days,
      updated_at = now();

-- Nicolas Asenjo går gratis på alla The Lab-kvällar, måndag som torsdag.
insert into public.series_access_codes
  (series_slug, code, label, max_uses, discount_price, is_active)
values
  ('the-lab-mandag',  'NICOLAS-A7K2', 'Nicolas Asenjo – stående fribiljett', 1, null, true),
  ('the-lab-torsdag', 'NICOLAS-A7K2', 'Nicolas Asenjo – stående fribiljett', 1, null, true)
on conflict (series_slug, code) do nothing;

-- Christian Jonsson är medarrangör på hela zoukserien. Ingen ekonomisk
-- behörighet — can_manage styr eventadministration, aldrig pengar.
insert into public.series_collaborators
  (series_slug, user_id, role, can_scan, can_manage)
values
  ('brazilian-zouk-tisdag', 'a0d94aea-6081-48f6-9a84-7c74c542f05c', 'co_host', true, true)
on conflict (series_slug, user_id) do nothing;
