-- Klippkort för alla kreatörer, inte bara taxidansare.
--
-- Mekanismen fanns redan: ett listing_type 'dance_package' med dance_count,
-- en bokning som bär dances_total/dances_redeemed, och en inlösenknapp som
-- räknar upp och stänger bokningen när sista klippet är taget. Den var låst
-- till creator_subcategory = 'taxi_dancer' och hette danspaket överallt.
--
-- Plattformen är inte en dansplattform (en boxningstränare säljer 5- och
-- 10-passkort på precis samma sätt), så begreppet får ett neutralt namn och
-- öppnas för alla kreatörer. Noll rader använde funktionen vid omdöpningen —
-- verifierat mot produktion — så bytet är rent, utan datamigrering.
--
-- 'dance_package' fortsätter accepteras som gammalt värde, av samma skäl som
-- 'experience' gör det för roller: en klient som ligger efter ska inte falla.
alter table public.listings  rename column dance_count      to session_count;
alter table public.bookings  rename column dances_total     to sessions_total;
alter table public.bookings  rename column dances_redeemed  to sessions_redeemed;

alter table public.listings rename constraint listings_dance_count_check
  to listings_session_count_check;
alter table public.bookings rename constraint bookings_dances_redeemed_check
  to bookings_sessions_redeemed_check;
alter table public.bookings rename constraint bookings_dances_redeemed_within_total
  to bookings_sessions_redeemed_within_total;

alter table public.listings drop constraint listings_listing_type_check;
alter table public.listings add constraint listings_listing_type_check
  check (listing_type = any (array[
    'service', 'event', 'table_reservation', 'spa_treatment', 'group_activity',
    'package',        -- klippkort: N pass som löses in ett i taget
    'dance_package',  -- gammalt namn, accepteras men skapas inte längre
    'coaching_session', 'b2b_offering'
  ]));

comment on column public.listings.session_count is
  'Antal pass i ett klippkort (listing_type = package). Null för andra typer.';
comment on column public.bookings.sessions_total is
  'Klippkortets storlek vid köptillfället. Null = inte ett klippkort.';
comment on column public.bookings.sessions_redeemed is
  'Antal inlösta pass. Når det sessions_total markeras bokningen completed.';
