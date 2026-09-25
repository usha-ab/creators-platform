-- Partnerprogram, del B: belöningarna blir verkliga.
--
-- credit_ledger: kredit att handla för (påfyllning från partnerbelöningar,
-- debitering i biljettkassan). Skild från account_credits, som är
-- välkomstavdragets engångsrad.
-- premium_grants: tidsbegränsad premium från programmet, med minne av vilken
-- nivå kontot hade innan så den kan återställas när tiden gått ut.
-- affiliate_payouts: kvartalsvisa utbetalningar (Stripe-transfer till bolag,
-- annars kredit), en rad per partner och period = dubbelbetalningslåset.

create table if not exists public.credit_ledger (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  delta_ore  integer not null,
  reason     text not null,
  ref        text not null unique,
  created_at timestamptz not null default now()
);
comment on table public.credit_ledger is 'Kredit i öre att handla för. Positiva rader = påfyllning, negativa = använt i kassan. ref gör varje rad idempotent.';
create index if not exists credit_ledger_profile_idx on public.credit_ledger (profile_id);
alter table public.credit_ledger enable row level security;
drop policy if exists "Egen kredit" on public.credit_ledger;
create policy "Egen kredit" on public.credit_ledger for select using (auth.uid() = profile_id);
revoke insert, update, delete on public.credit_ledger from anon, authenticated;

create table if not exists public.premium_grants (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  days        integer not null check (days > 0),
  source      text not null default 'affiliate',
  ref         text not null unique,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz not null,
  tier_before text,
  reverted_at timestamptz,
  created_at  timestamptz not null default now()
);
comment on table public.premium_grants is 'Tidsbegränsad premium från partnerprogrammet. tier_before återställs av det dagliga jobbet när ends_at passerat, om inget aktivt abonnemang finns.';
create index if not exists premium_grants_active_idx on public.premium_grants (ends_at) where reverted_at is null;
alter table public.premium_grants enable row level security;
drop policy if exists "Egna premiumperioder" on public.premium_grants;
create policy "Egna premiumperioder" on public.premium_grants for select using (auth.uid() = profile_id);
revoke insert, update, delete on public.premium_grants from anon, authenticated;

create table if not exists public.affiliate_payouts (
  id                 uuid primary key default gen_random_uuid(),
  profile_id         uuid not null references public.profiles(id) on delete cascade,
  period             text not null,
  amount_ore         integer not null check (amount_ore >= 0),
  status             text not null check (status in ('dry_run', 'paid', 'credited', 'failed')),
  stripe_transfer_id text unique,
  error              text,
  created_at         timestamptz not null default now(),
  paid_at            timestamptz,
  unique (profile_id, period)
);
alter table public.affiliate_payouts enable row level security;
drop policy if exists "Egna utbetalningar" on public.affiliate_payouts;
create policy "Egna utbetalningar" on public.affiliate_payouts for select using (auth.uid() = profile_id);
revoke insert, update, delete on public.affiliate_payouts from anon, authenticated;
