-- Kampanjspårning ända fram till köpet.
--
-- GA4 tappar kanalen vid omdirigeringen till Stripe och tillbaka: rapporten
-- visar att en biljett såldes, inte att inlägget på Instagram sålde den.
-- Genom att bära utm-värdena från landningen i en cookie, vidare som
-- Stripe-metadata, och skriva dem på bokningen blir kanalen en kolumn i
-- databasen i stället för en gissning i ett rapportverktyg.
alter table public.bookings
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text;

comment on column public.bookings.utm_source is
  'Kanalen köpet kom från (instagram, facebook, linkedin …). Fångas i middleware från adressens utm_source, bärs genom kassan i Stripe-metadata. Null = okänd kanal, inte "direkt".';

create index if not exists bookings_utm_campaign_idx
  on public.bookings (utm_campaign, created_at desc) where utm_campaign is not null;
