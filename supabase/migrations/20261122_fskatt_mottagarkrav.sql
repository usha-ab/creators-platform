-- ─────────────────────────────────────────────────────────────────────────────
-- F-skatt och bolagsform som krav för att ta emot pengar via Usha.
--
-- Juristens flödesförslag, godkänt av Pablo 2026-11-22. company_verified_at
-- betyder bara att momsnumret är giltigt i VIES. Det är F-skatten som avgör om
-- Usha blir skyldig att göra skatteavdrag (SFL 10 kap. 2 och 11 §§) och betala
-- arbetsgivaravgifter (SAL 2 kap. 5 §). Momsregistrering krävs inte: en enskild
-- firma under omsättningsgränsen och en förening utan moms ska kunna godkännas.
--
-- Koden (lib/payments/beta-gate.ts) kräver för alla mottagare utom Ushas eget
-- konto: company_form, svenskt org_number och f_tax_verified_at som inte är
-- äldre än F_TAX_MAX_AGE_DAYS.
--
-- ORDNING: kör den här migrationen INNAN koden deployas. Utan kolumnerna fäller
-- PostgREST avräkningskörningens fråga, och kassorna spärrar alla utom Usha.
--
-- Syre Bar och Event AB (som redan får avräkningar) stoppas tills deras F-skatt
-- är registrerad. Antingen via adminverktyget /dashboard/admin/fskatt, eller
-- med den separata filen supabase/manual/20261122_syre_fskatt_backfill.sql.
-- Den ligger medvetet UTANFÖR migrations/ så att den aldrig körs automatiskt.
--
-- Rent additiv. Inga befintliga rader ändras.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Kolumner -------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS company_form TEXT
    CHECK (company_form IN ('aktiebolag', 'enskild_firma', 'forening')),
  ADD COLUMN IF NOT EXISTS f_tax_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS f_tax_source TEXT
    CHECK (f_tax_source IN ('skatteverket_manuell', 'skatteverket_api')),
  ADD COLUMN IF NOT EXISTS f_tax_checked_by UUID
    REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.profiles.company_form IS
  'Verifierad bolagsform för utbetalning: aktiebolag, enskild_firma eller forening. Sätts bara av admin/service-role.';
COMMENT ON COLUMN public.profiles.f_tax_verified_at IS
  'När F-skatten senast kontrollerades som godkänd (Skatteverket). Skild från company_verified_at (VIES-moms).';
COMMENT ON COLUMN public.profiles.f_tax_source IS
  'Källa för F-skattekontrollen: skatteverket_manuell (Hämta företagsinformation) eller skatteverket_api.';
COMMENT ON COLUMN public.profiles.f_tax_checked_by IS
  'Admin som registrerade kontrollen.';

-- 2. Historik: varje kontroll sparas som underlag -------------------------------
CREATE TABLE IF NOT EXISTS public.payee_f_tax_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('registered', 'removed')),
  checked_at TIMESTAMPTZ,
  source TEXT CHECK (source IN ('skatteverket_manuell', 'skatteverket_api')),
  company_form TEXT,
  org_number TEXT,
  checked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payee_f_tax_checks_profile_idx
  ON public.payee_f_tax_checks (profile_id, created_at DESC);

-- Bara service-role. RLS på utan policyer = ingen åtkomst för anon/authenticated.
ALTER TABLE public.payee_f_tax_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payee_f_tax_checks FROM anon, authenticated;

-- 3. Skydda kolumnerna -----------------------------------------------------------
-- Egen trigger i stället för att skriva om protect_profile_privileged_columns():
-- den funktionen måste upprepa hela kolumnlistan vid varje ändring, och en
-- tappad rad öppnar tyst för självtilldelning. Den här rör bara de nya fälten
-- och täcker även INSERT.
--
-- org_number skyddas redan av protect_profile_privileged_columns (UPDATE).
CREATE OR REPLACE FUNCTION public.protect_profile_payee_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (SELECT auth.role()) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.company_form := NULL;
    NEW.f_tax_verified_at := NULL;
    NEW.f_tax_source := NULL;
    NEW.f_tax_checked_by := NULL;
  ELSE
    NEW.company_form := OLD.company_form;
    NEW.f_tax_verified_at := OLD.f_tax_verified_at;
    NEW.f_tax_source := OLD.f_tax_source;
    NEW.f_tax_checked_by := OLD.f_tax_checked_by;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.protect_profile_payee_columns() FROM PUBLIC;

DROP TRIGGER IF EXISTS protect_profile_payee_columns_trigger ON public.profiles;
CREATE TRIGGER protect_profile_payee_columns_trigger
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_payee_columns();

-- 4. Läsrätt ---------------------------------------------------------------------
-- Ingen GRANT till anon/authenticated. profiles har kolumn-allowlist sedan
-- 20260813b, så nya kolumner är oläsbara för dem tills någon uttryckligen
-- grantar. Koden läser dem med service-role (lib/payments/load-payee.ts).

COMMIT;
