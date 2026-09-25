-- Välkomstavdraget till konton som redan fanns när det infördes.
--
-- Triggern i 20260906_signup_credit.sql ger avdraget vid kontoskapande, så
-- utan den här körningen hade alla som funnits sedan tidigare stått utanför —
-- de som faktiskt använt plattformen längst.
--
-- Reason 'backfill' i stället för 'signup': utdelningen går att skilja åt i
-- efterhand, så en kostnad kan hänföras till rätt kampanj.
--
-- Egna konton (@usha.se) utesluts. Usha ger inte rabatt åt sig själv, och en
-- sådan rad hade sett ut som en riktig kostnad i avräkningen.
--
-- ON CONFLICT DO NOTHING gör körningen ofarlig att upprepa: ingen kan få två
-- avdrag, och ett redan använt avdrag återuppstår inte.
insert into public.account_credits (user_id, amount_ore, reason, expires_at)
select p.id, 5000, 'backfill', now() + interval '12 months'
from public.profiles p
join auth.users u on u.id = p.id
where p.deleted_at is null
  and u.deleted_at is null
  and p.email not like '%@usha.se'
on conflict (user_id) do nothing;
