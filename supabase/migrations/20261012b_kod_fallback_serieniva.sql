-- Inlösning faller tillbaka på serienivån.
--
-- Före: en kod fanns bara om triggern hunnit kopiera ner den när kvällen
-- SKAPADES. Tändes en avstängd kväll igen, eller lades serie-koden till efter
-- att kvällarna redan fanns, saknades kväll-raden och gästen nekades i dörren
-- utan att någon kunde se varför. Nu materialiseras raden i samma ögonblick
-- koden används, så serienivån är sanningen och kväll-raden bara dess avtryck.

create or replace function public.materialize_series_access_codes(
  p_listing uuid,
  p_code text default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inserted integer;
begin
  insert into public.event_access_codes
    (listing_id, code, label, max_uses, discount_price, is_active)
  select l.id, c.code, c.label, c.max_uses, c.discount_price, true
  from public.listings l
  join public.series_access_codes c on c.series_slug = l.series_slug
  where l.id = p_listing
    and c.is_active
    and (p_code is null or upper(btrim(c.code)) = upper(btrim(p_code)))
  on conflict (listing_id, code) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

comment on function public.materialize_series_access_codes(uuid, text) is
  'Kopierar ner seriens aktiva koder till en kväll som saknar dem. Idempotent.';

-- Samma kontrakt som förut (returnerar kodens id eller null), men letar på
-- serienivån först om kvällen inte har raden. Materialiseringen ligger INNE i
-- funktionen så att reservationen fortfarande är ett enda atomärt anrop.
create or replace function public.redeem_access_code(p_listing uuid, p_code text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.event_access_codes
    where listing_id = p_listing and code = upper(btrim(p_code))
  ) then
    perform public.materialize_series_access_codes(p_listing, p_code);
  end if;

  update public.event_access_codes
  set used_count = used_count + 1
  where listing_id = p_listing
    and code = upper(btrim(p_code))
    and is_active = true
    and (max_uses is null or used_count < max_uses)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.materialize_series_access_codes(uuid, text) from public, anon;
grant execute on function public.materialize_series_access_codes(uuid, text) to service_role;
