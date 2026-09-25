-- "Följ oss" utan konto.
--
-- Följ-funktionen kräver inloggning, men de flesta som köper biljett till The
-- Lab gör det som gäster med bara en e-postadress. De hade ingen väg att få
-- veta när nästa kväll läggs upp. Den här tabellen är den vägen: ett aktivt ja
-- (knapp på biljettsidan, eller e-post + bekräftelselänk på eventsidan), en
-- avslutalänk i varje mejl, och ingenting skickas till den som inte bekräftat.
create table if not exists public.email_follows (
  id                uuid primary key default gen_random_uuid(),
  email             text not null,
  followed_id       uuid not null references public.profiles(id) on delete cascade,
  locale            text,
  source            text not null check (source in ('ticket', 'event_page')),
  confirm_token     uuid not null default gen_random_uuid(),
  confirmed_at      timestamptz,
  unsubscribe_token uuid not null default gen_random_uuid(),
  unsubscribed_at   timestamptz,
  created_at        timestamptz not null default now(),
  unique (email, followed_id)
);
comment on table public.email_follows is
  'Följare utan konto. confirmed_at null = väntar på bekräftelse (dubbel opt-in från eventsidan); biljettköpare bekräftas direkt eftersom de agerar från sin egen biljettlänk.';
create index if not exists email_follows_followed_idx on public.email_follows (followed_id) where confirmed_at is not null and unsubscribed_at is null;
create index if not exists email_follows_confirm_idx on public.email_follows (confirm_token);
create index if not exists email_follows_unsub_idx on public.email_follows (unsubscribe_token);

-- Bara service_role (API-rutter och notisjobbet) rör tabellen.
alter table public.email_follows enable row level security;
revoke all on public.email_follows from anon, authenticated;

-- "Följ oss"-länkar i sidfoten och på eventsidor. Null = visas inte.
-- Instagram fylls i när kontot finns (Mariana), utan deploy.
insert into public.app_config (key, value)
values ('social_links', '{"facebook":"https://www.facebook.com/438136616060981","instagram":null,"tiktok":null}'::jsonb)
on conflict (key) do nothing;
