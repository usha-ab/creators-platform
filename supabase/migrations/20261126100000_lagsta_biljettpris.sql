-- Lägsta betalda biljettpris: 0 kr (gratis) eller minst 50 kr.
--
-- KÖRS INTE UTAN PABLOS JA. Appen validerar redan regeln på servern
-- (src/lib/stripe/min-price.ts); det här är försvar på djupet mot skrivningar
-- som går förbi serveråtgärderna (service-role-skript, SQL för hand).
--
-- Läget i produktion 2026-11-25 (SELECT, inget ändrat): 0 rader med ett pris
-- mellan 0 och 50 kr i listings.price, listings.early_bird_price,
-- ticket_types.price, event_access_codes.discount_price och
-- series_access_codes.discount_price. Lägsta betalda pris var 50 kr.
--
-- Kontroll före körning (ska ge 0 på varje rad):
--   select count(*) from listings where price > 0 and price < 50;
--   select count(*) from listings where early_bird_price > 0 and early_bird_price < 50;
--   select count(*) from ticket_types where price > 0 and price < 50;
--   select count(*) from event_access_codes where discount_price > 0 and discount_price < 50;
--   select count(*) from series_access_codes where discount_price > 0 and discount_price < 50;
--
-- Skulle en rad ha tillkommit avbryts migrationen på den constrainten och
-- ingenting ändras (allt i en transaktion).

begin;

alter table public.listings
  add constraint listings_price_min_paid
  check (price is null or price = 0 or price >= 50);

alter table public.listings
  add constraint listings_early_bird_price_min_paid
  check (early_bird_price is null or early_bird_price = 0 or early_bird_price >= 50);

alter table public.ticket_types
  add constraint ticket_types_price_min_paid
  check (price = 0 or price >= 50);

alter table public.event_access_codes
  add constraint event_access_codes_discount_price_min_paid
  check (discount_price is null or discount_price = 0 or discount_price >= 50);

alter table public.series_access_codes
  add constraint series_access_codes_discount_price_min_paid
  check (discount_price is null or discount_price = 0 or discount_price >= 50);

commit;
