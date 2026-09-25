-- Spår på att mottagaren fått veta att avdraget finns.
--
-- Utan kolumnen finns ingen skillnad mellan "har inte mejlats" och "mejlades
-- innan skriptet dog halvvägs", och en omkörning skulle skicka om till alla.
alter table public.account_credits
  add column if not exists notified_at timestamptz;

comment on column public.account_credits.notified_at is
  'När mottagaren fick mejlet om avdraget. Null = inte mejlad; gör utskicket ofarligt att köra om.';
