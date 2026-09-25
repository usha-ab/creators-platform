-- Egen ordning på tjänster.
--
-- Tjänster har hittills visats i skapandeordning, nyast först. Det är en
-- godtycklig ordning ur kreatörens synvinkel: den som lägger upp ett dyrt
-- företagspaket sist får det överst, medan kärntjänsten hamnar längst ned.
-- Osvaldo ville ha sin kostrådgivning först och företagseventet under.
--
-- NULL betyder "ingen egen ordning" och sorteras sist, så allt som redan finns
-- behåller exakt sitt nuvarande utseende tills någon aktivt ändrar det.
alter table public.listings add column if not exists sort_order integer;

comment on column public.listings.sort_order is
  'Kreatörens egen ordning på sina tjänster. Lägre tal först. NULL = ingen egen ordning, sorteras sist och faller tillbaka på created_at.';

-- Partiellt index: bara rader som faktiskt har en ordning behöver slås upp.
create index if not exists listings_user_sort_idx
  on public.listings (user_id, sort_order)
  where sort_order is not null;
