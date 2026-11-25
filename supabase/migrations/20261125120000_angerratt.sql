-- Ångerfunktionen (2 kap. 10 a § distansavtalslagen, gäller sedan 2026-06-19).
--
-- En rad per ångrat köp. Raden är beviset på när ångermeddelandet kom in och vad
-- som hände sedan: återbetalning via Stripe direkt, eller ett ärende som Usha
-- betalar tillbaka för hand (Swish och Epassi) senast 14 dagar efter received_at
-- (14 §). Mottagningsbeviset till köparen skickas per e-post och receipt_sent_at
-- säger att det gick iväg.
--
-- unique(booking_id): ett köp kan bara ångras en gång. Raden skrivs FÖRE
-- återbetalningen, så två samtidiga klick inte kan ge två återbetalningar.
--
-- Bara servern (service role) läser och skriver. RLS utan policyer stänger
-- tabellen för anon och authenticated.

create table if not exists public.booking_withdrawals (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  received_at timestamptz not null default now(),
  buyer_name text not null,
  buyer_email text not null,
  -- 'stripe' = återbetalt automatiskt, 'manual' = Usha betalar tillbaka för hand.
  refund_method text not null check (refund_method in ('stripe', 'manual', 'none')),
  refund_amount_ore integer check (refund_amount_ore is null or refund_amount_ore >= 0),
  stripe_refund_id text,
  refunded_at timestamptz,
  refund_due_at timestamptz not null,
  refund_error text,
  receipt_sent_at timestamptz,
  seller_notified_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.booking_withdrawals is
  'Ångrade köp (2 kap. 10 a § distansavtalslagen). En rad per bokning; skrivs före återbetalningen.';

create index if not exists booking_withdrawals_open_manual_idx
  on public.booking_withdrawals (refund_due_at)
  where refunded_at is null;

alter table public.booking_withdrawals enable row level security;
revoke all on public.booking_withdrawals from anon, authenticated;
