-- Rollen venue går förlorad vid registrering.
--
-- Gränssnittet har skickat 'venue' sedan 2026-06-16 (73ec944, när rollerna
-- normaliserades till creator/venue/customer), men triggern släppte bara
-- igenom 'creator', 'experience' och 'customer'. Den som valde "Venue" fick
-- alltså tyst rollen customer.
--
-- Att felet inte syns i databasen i dag beror på en omväg: en venue som
-- BankID-verifierar sig efteråt får rollen satt av /callback, som skriver
-- role från den signerade BankID-cookien. Det enda kontot som registrerats
-- med 'venue' rättades exakt så. Omvägen är inte en fix — den förutsätter
-- att användaren hittar till BankID trots att hen landat i fel del av appen.
--
-- 'experience' tas emot fortfarande, men lagras som 'venue'. Ingen klient
-- skickar värdet längre (mobilappen är ett skal som laddar usha.se, så den
-- kan inte ligga efter webben), och appens normalizeRole mappar det till
-- venue — att lagra det kanoniska värdet direkt gör att ingen läsare
-- behöver känna till det gamla namnet. Aliaset kostar en rad och skyddar
-- mot en bortglömd länk eller ett gammalt bokmärke.
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
  resolved_role := CASE new.raw_user_meta_data->>'role'
    WHEN 'creator'    THEN 'creator'
    WHEN 'venue'      THEN 'venue'
    WHEN 'experience' THEN 'venue'   -- gammalt namn, se kommentaren ovan
    WHEN 'customer'   THEN 'customer'
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
