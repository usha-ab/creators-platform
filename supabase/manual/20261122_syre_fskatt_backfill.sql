-- ─────────────────────────────────────────────────────────────────────────────
-- BACKFILL: Syre Bar och Event AB (Bacchi) — bolagsform och F-skatt.
--
-- !!! KÖR INTE förrän Pablo eller Ludvig har kontrollerat att Syre Bar och
-- !!! Event AB är godkänd för F-skatt i Skatteverkets "Hämta
-- !!! företagsinformation" och sparat utskriften som underlag.
--
-- Varför: avräkningen till Syre kräver från och med migrationen
-- 20261122_fskatt_mottagarkrav.sql kontrollerad F-skatt. Utan den här raden
-- (eller samma registrering via /dashboard/admin/fskatt) stoppas Syres
-- utbetalningar med skälet "mottagarens F-skatt är inte kontrollerad".
--
-- Förutsätter att migrationen är körd. Ligger medvetet utanför migrations/.
--
-- Före körning: byt ut '<DATUM FÖR KONTROLLEN>' mot dagen kontrollen gjordes
-- (YYYY-MM-DD). Platshållaren gör att satsen faller om den körs oändrad.
--
-- Supabase-MCP och SQL-editorn kör som postgres, inte service_role; utan
-- claimen nedan nollställer skyddstriggern tyst värdena. Läs tillbaka efteråt.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

-- Torrkörning: exakt en rad ska komma tillbaka, med Syres namn och org-nr.
SELECT id, company_name, org_number, company_form, f_tax_verified_at
FROM public.profiles
WHERE stripe_account_id = 'acct_1UAtdkFmVWAUCItC';

UPDATE public.profiles
SET company_form = 'aktiebolag',
    f_tax_verified_at = '<DATUM FÖR KONTROLLEN>'::date::timestamptz,
    f_tax_source = 'skatteverket_manuell'
WHERE stripe_account_id = 'acct_1UAtdkFmVWAUCItC'
  AND org_number IS NOT NULL
  AND org_number !~ '^[A-Za-z]{2}';

INSERT INTO public.payee_f_tax_checks (profile_id, action, checked_at, source, company_form, org_number)
SELECT id, 'registered', f_tax_verified_at, f_tax_source, company_form, org_number
FROM public.profiles
WHERE stripe_account_id = 'acct_1UAtdkFmVWAUCItC'
  AND f_tax_verified_at IS NOT NULL;

-- Läs tillbaka. company_form och f_tax_verified_at ska vara satta.
SELECT id, company_name, company_form, f_tax_verified_at, f_tax_source
FROM public.profiles
WHERE stripe_account_id = 'acct_1UAtdkFmVWAUCItC';

COMMIT;
