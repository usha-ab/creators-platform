-- Spara samtycket till marknadsföring som ges vid registrering.
--
-- Bakgrund: user_settings-raden skapades först när någon öppnade
-- inställningssidan och ändrade något. Fram till dess fanns ingen rad alls,
-- och koden som avgjorde om reklam fick skickas tolkade den tomma raden som
-- ett ja — trots att appen visade valet som avstängt. Se
-- docs/marketing-consent-incident-2026-09-06.md.
--
-- Nu skrivs raden direkt vid kontoskapandet, med det användaren faktiskt
-- kryssade i. Kolumnens default är false, så ett saknat eller felstavat värde
-- i metadatan blir ett nej — aldrig ett oavsiktligt ja.
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
  resolved_marketing BOOLEAN;
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

  -- COALESCE:n är inte kosmetisk: TRUE AND NULL är NULL i SQL, och kolumnen är
  -- NOT NULL. Utan den föll varje registrering av en kreatör utan bolag.
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

  -- Bara den exakta strängen 'true' räknas. Allt annat — saknad nyckel, tom
  -- sträng, ett OAuth-flöde som aldrig visade rutan — blir nej.
  resolved_marketing := COALESCE(
    new.raw_user_meta_data->>'marketing_consent' = 'true',
    false
  );

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

  -- Välkomstavdraget. ON CONFLICT DO NOTHING så att en omkörning av triggern
  -- aldrig kan ge två avdrag till samma konto.
  INSERT INTO public.account_credits (user_id, amount_ore, reason, expires_at)
  VALUES (new.id, 5000, 'signup', now() + interval '12 months')
  ON CONFLICT (user_id) DO NOTHING;

  -- Samtyckesraden. Övriga kolumner tar sina defaults.
  INSERT INTO public.user_settings (user_id, notif_marketing)
  VALUES (new.id, resolved_marketing)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN new;
END;
$function$;
