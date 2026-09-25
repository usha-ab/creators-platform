# Utskick utan samtycke, 6 september 2026

Anteckning för egen räkning. Ingen myndighetsanmälan bedöms krävas (se
Bedömning), men händelsen ska gå att redogöra för i efterhand.

## Vad som hände

Ett mejl om ett välkomstavdrag på 50 kr gick till 38 kontoinnehavare.
Urvalet filtrerade bort dem som uttryckligen tackat nej till marknadsföring
— men behandlade en tom inställningsrad som ett ja.

Det stämde inte med vad appen visade. Både `GET /api/settings` och
inställningssidan renderar marknadsföring som **av** för den som aldrig
sparat något, medan `shouldSendEmail` svarade **true** på samma tomma rad.
36 av de 38 såg alltså "av" i sina inställningar och fick mejlet ändå.

## Fördelning

| Grund | Antal |
|---|---|
| Aktivt ja (`notif_marketing = true`) | 2 |
| Befintlig kund, tidigare köp (mjukt samtycke) | 17 |
| Varken samtycke eller kundrelation | 19 |

## Bedömning

Frågan är i första hand marknadsföringslagen 19–21 §§ och ePrivacy, inte
ett personuppgiftsincidentärende: ingen obehörig fick tillgång till data,
inget läckte. Art. 33-anmälan bedöms därför inte aktuell.

För de 17 med tidigare köp finns ett rimligt stöd i undantaget för egna,
liknande erbjudanden till befintliga kunder — mejlet gällde plattformens
egen tjänst och innehöll en avregistreringslänk.

För de 19 utan köphistorik saknades grund. Att mejlet gällde ett saldo som
redan låg på deras konto kan tala för att se det som ett servicemeddelande,
men det uppmanade till köp, och den tolkningen bör inte lutas mot.

## Åtgärdat

- `shouldSendEmail` kräver nu ett aktivt `true` för `notif_marketing`. Tom
  rad och databasfel räknas båda som nej. Transaktionella notiser (bokning,
  utbetalning) behåller sin opt-out-default — de rör något användaren själv
  satt igång.
- `scripts/send-welcome-credit.ts` väljer bara mottagare med aktivt ja.
- Regressionstest i `src/lib/email/__tests__/check-preferences.test.ts`.

- Samtyckesruta vid registrering (7 sep 2026). Omarkerad som standard;
  valet går via `raw_user_meta_data.marketing_consent` till
  `handle_new_user`, som nu skapar user_settings-raden direkt vid
  kontoskapandet. Bara strängen 'true' räknas — saknad nyckel och OAuth-flöden
  utan ruta blir nej. Verifierat mot alla tre fallen.

- OAuth-flödet (7 sep 2026). Rutan flyttad till ovanför Google- och
  Facebook-knapparna, så den föregår alla tre registreringsvägarna; nere vid
  formulärets knapp hade den aldrig hunnit synas för den som klickar Google.
  Valet reser i `pending_marketing_consent`-cookien och plockas upp i
  /callback, men bara när rundturen nyss skapade kontot — annars kunde en
  kvarliggande cookie slå på marknadsföring vid en senare inloggning.

## Beslut

- **De 19 kontaktas inte** (7 sep 2026). Ett meddelande om saken är i sig
  ytterligare ett utskick till precis de personer som inte bett om ett.
  Samtyckesrutan får i stället bygga listan framåt.
