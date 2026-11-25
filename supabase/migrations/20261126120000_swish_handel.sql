-- Swish Handel (Swish Commerce API): en rad per betalningsförfrågan.
--
-- En vilande Swish-bokning kan få flera förfrågningar (gästen nekar i appen,
-- tiden går ut efter tre minuter, försöker igen). Därför en egen tabell och
-- inte en kolumn på bookings. Raden skrivs INNAN förfrågan skickas till
-- Swish, så att callbacken alltid hittar den.
--
-- callback_identifier är hemligheten Swish skickar tillbaka i callbackens
-- header. Bara servern (service role) läser och skriver: RLS utan policyer.
-- Ingen betalares telefonnummer sparas.

create table if not exists public.swish_payment_requests (
  -- Swishs instructionUUID, 32 tecken 0-9A-F.
  id text primary key check (id ~ '^[0-9A-F]{32}$'),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  listing_id uuid not null references public.listings(id) on delete restrict,
  env text not null check (env in ('test', 'prod')),
  payee_alias text not null,
  amount_ore integer not null check (amount_ore > 0),
  callback_identifier text not null,
  token text,
  status text not null default 'CREATED'
    check (status in ('CREATED', 'PAID', 'DECLINED', 'ERROR', 'CANCELLED', 'MISMATCH')),
  payment_reference text,
  error_code text,
  paid_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.swish_payment_requests is
  'Swish Handel: betalningsförfrågningar per vilande Swish-bokning. Callback och polling stämmer av mot Swishs GET och bekräftar bokningen via lib/swish/confirm.ts.';

create index if not exists swish_payment_requests_booking_idx
  on public.swish_payment_requests (booking_id, created_at desc);

-- Högst en betald förfrågan per bokning. En andra PAID vore en dubbelbetalning
-- och ska synas som fel, inte tyst läggas till.
create unique index if not exists swish_payment_requests_one_paid_idx
  on public.swish_payment_requests (booking_id)
  where status = 'PAID';

alter table public.swish_payment_requests enable row level security;
revoke all on public.swish_payment_requests from anon, authenticated;
