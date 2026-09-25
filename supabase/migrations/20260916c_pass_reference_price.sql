-- Jämförpriset ett klippkort mäts mot.
--
-- Rabatten i köpvalet räknas mot kvällens ordinarie biljett för det kortet
-- täcker, hittad på namnet (pass_covers = biljettypens namn). Täcker kortet
-- flera biljetter tillsammans — practica + workshop, men inte socialen —
-- finns ingen enskild biljett att jämföra med, och då stod det ingenting.
-- Här skriver arrangören priset per kväll själv i stället för att systemet
-- ska gissa.

alter table listings add column if not exists pass_reference_price integer;

comment on column listings.pass_reference_price is
  'Ordinarie pris per kväll som klippkortets rabatt räknas mot. Null = jämför mot biljettypen som heter pass_covers, annars entrépriset.';
