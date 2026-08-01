-- Tips: one-time gratitude payments to creators/taxi-dancers/crew via Stripe
-- destination charge. Rows are written by the Stripe webhook on completed
-- checkout (status='paid' only). Recipients read their own tips.
create table if not exists public.tips (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  tipper_email text,
  amount_ore integer not null check (amount_ore > 0),
  message text,
  stripe_session_id text unique,
  status text not null default 'paid',
  created_at timestamptz not null default now()
);

create index if not exists tips_recipient_idx on public.tips (recipient_id, created_at desc);

alter table public.tips enable row level security;

-- Recipients can read tips addressed to them. Writes happen only via the
-- service-role webhook (which bypasses RLS), so no INSERT/UPDATE policy.
drop policy if exists tips_recipient_select on public.tips;
create policy tips_recipient_select on public.tips
  for select using (recipient_id = auth.uid());
