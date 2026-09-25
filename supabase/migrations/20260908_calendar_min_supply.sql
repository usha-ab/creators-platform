-- Publik kalender (/kalender) och dess länk i toppmenyn.
--
-- Sidan finns alltid på sin adress, men länken i menyn visas först när det
-- finns tillräckligt att visa: minst så här många distinkta händelser
-- (en serie räknas som en). Ändra värdet här — ingen deploy behövs.
insert into public.app_config (key, value)
values ('calendar_min_supply', '5'::jsonb)
on conflict (key) do nothing;
