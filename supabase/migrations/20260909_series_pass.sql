-- Klippkort som gäller på en serie ("The Lab – 5 kvällar").
--
-- Ett klippkort (listing_type = package) har hittills lösts in för hand i
-- bokningslistan. Kopplas det till en serie blir det en biljett: QR-koden
-- skannas i dörren vilken kväll som helst i serien, ett klipp per kväll.
-- Varje klipp loggas per tillfälle så att (1) samma kort inte kan klippas två
-- gånger samma kväll och (2) kvällens avräkning (t.ex. 50/50 med lokalen) får
-- med sig sin andel av kortet: 1/N av priset per inlöst klipp.
alter table public.listings
  add column if not exists pass_series_id uuid,
  add column if not exists pass_covers text;

comment on column public.listings.pass_series_id is
  'Klippkort (package): series_id för den serie kortet ger tillträde till. Null = löses in manuellt.';
comment on column public.listings.pass_covers is
  'Klippkort: vad ett klipp ger tillträde till, i klartext för dörren (t.ex. "Allt: practica + workshop + social").';

create index if not exists listings_pass_series_idx
  on public.listings (pass_series_id) where pass_series_id is not null;

create table if not exists public.pass_redemptions (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings(id) on delete cascade,
  listing_id  uuid not null references public.listings(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  scanned_by  uuid references auth.users(id) on delete set null,
  unique (booking_id, listing_id)
);
comment on table public.pass_redemptions is
  'Ett klipp på ett klippkort, knutet till det tillfälle (listing) där det löstes in.';
create index if not exists pass_redemptions_listing_idx on public.pass_redemptions (listing_id);

-- Bara service_role (skanner-API och avräkning) rör tabellen.
alter table public.pass_redemptions enable row level security;
revoke all on public.pass_redemptions from anon, authenticated;
