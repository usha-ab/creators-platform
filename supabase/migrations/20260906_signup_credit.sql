-- Välkomstavdrag: 50 kr till den som skapar konto.
--
-- Beslut som styr reglerna (båda affärsbeslut, se lib/credits/signup.ts):
--   * Usha bär hela avdraget. Partnerns andel räknas på ordinarie pris via
--     bookings.credit_applied_ore, annars skulle en samarbetspartner tyst
--     finansiera halva marknadsföringen.
--   * Minsta köp 150 kr. Utan gräns blir en practica för 50 kr gratis, och ett
--     köparkonto kräver bara en mejladress.
create table if not exists public.account_credits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  amount_ore integer not null check (amount_ore > 0),
  reason text not null default 'signup',
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  used_at timestamptz,
  used_booking_id uuid references public.bookings(id) on delete set null
);

comment on table public.account_credits is
  'Engångsavdrag per konto. Usha bär kostnaden; partnerns andel räknas på ordinarie pris via bookings.credit_applied_ore.';

alter table public.account_credits enable row level security;

drop policy if exists "read own credit" on public.account_credits;
create policy "read own credit" on public.account_credits
  for select using ((select auth.uid()) = user_id);

alter table public.bookings
  add column if not exists credit_applied_ore integer not null default 0;

comment on column public.bookings.credit_applied_ore is
  'Välkomstavdrag som Usha stod för. Läggs tillbaka i underlaget före partnerdelning.';

-- handle_new_user ger avdraget i samma trigger som skapar profilen.
-- ON CONFLICT DO NOTHING: en omkörning får aldrig ge två avdrag.
-- (Funktionskroppen i sin helhet, se 20260904_signup_is_company_null.sql för
--  varför COALESCE:n runt is_company finns.)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $function$
DECLARE
  resolved_role TEXT;
  resolved_subcategory TEXT;
  resolved_is_company BOOLEAN;
  resolved_locale TEXT;
BEGIN
  resolved_role := CASE
    WHEN new.raw_user_meta_data->>'role' IN ('creator', 'experience', 'customer')
      THEN new.raw_user_meta_data->>'role'
    ELSE 'customer'
  END;

  resolved_subcategory := CASE
    WHEN resolved_role = 'creator'
      AND new.raw_user_meta_data->>'creator_subcategory' IN ('general', 'taxi_dancer')
      THEN new.raw_user_meta_data->>'creator_subcategory'
    ELSE 'general'
  END;

  -- COALESCE:n är hela poängen med migrationen. Utan den blir värdet NULL så
  -- fort nyckeln saknas, och NOT NULL-kolumnen fäller kontoskapandet.
  resolved_is_company := COALESCE(
    resolved_role = 'creator'
    AND new.raw_user_meta_data->>'is_company' = 'true',
    false
  );

  resolved_locale := CASE
    WHEN new.raw_user_meta_data->>'locale' IN ('sv', 'en', 'es')
      THEN new.raw_user_meta_data->>'locale'
    ELSE NULL
  END;

  INSERT INTO public.profiles (id, email, full_name, avatar_url, role, creator_subcategory, is_company, locale)
  VALUES (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url',
    resolved_role,
    resolved_subcategory,
    resolved_is_company,
    resolved_locale
  );
  -- Välkomstavdraget.
  INSERT INTO public.account_credits (user_id, amount_ore, reason, expires_at)
  VALUES (new.id, 5000, 'signup', now() + interval '12 months')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN new;
END;
$function$;
