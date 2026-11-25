-- Klippkortets villkor i kassan, förlängning vid inställd kväll och påminnelser
-- före förfall. Underlag: juristens text 2026-11-25 (Kodspår 2 och 3) och
-- Pablos beslut 3 samma dag.
--
-- 1. pass_early_start_requested_at: köparen kryssade i "Jag vill kunna använda
--    kortet direkt" i kassan (2 kap. 15 § p. 3 distansavtalslagen). Bara då får
--    en proportionell del för använda klipp dras av om köpet ångras. NULL =
--    ingen begäran, och då betalas hela beloppet tillbaka.
-- 2. pass_expiry_reminded_30_at / _7_at: påminnelsen före sista giltighetsdag
--    har gått iväg. Gör cron-jobbet idempotent.
-- 3. pass_expiry_extensions: en rad per kort och inställd kväll. unique gör att
--    samma kväll aldrig förlänger samma kort två gånger, även om säljaren
--    avpublicerar och publicerar igen.
--
-- Additiv. Rör inga befintliga rader.

alter table public.bookings
  add column if not exists pass_early_start_requested_at timestamptz,
  add column if not exists pass_expiry_reminded_30_at timestamptz,
  add column if not exists pass_expiry_reminded_7_at timestamptz;

comment on column public.bookings.pass_early_start_requested_at is
  'Köparen begärde i kassan att få börja använda kortet inom ångerfristen (2 kap. 15 § p. 3).';

create table if not exists public.pass_expiry_extensions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  days integer not null check (days > 0),
  previous_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (booking_id, listing_id)
);

comment on table public.pass_expiry_extensions is
  'Förlängd giltighet på klippkort när säljaren ställt in en kväll i serien. En rad per kort och kväll.';

alter table public.pass_expiry_extensions enable row level security;
revoke all on public.pass_expiry_extensions from anon, authenticated;

create index if not exists bookings_pass_expires_open_idx
  on public.bookings (pass_expires_at)
  where sessions_total is not null and status = 'confirmed';
