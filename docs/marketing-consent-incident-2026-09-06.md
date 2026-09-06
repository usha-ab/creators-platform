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

## Kvar att bestämma

- Samtyckesruta vid registrering, så nya konton får ett riktigt val.
- Om de 19 ska kontaktas. Ett meddelande om saken är i sig ytterligare ett
  utskick till samma personer, vilket talar emot.
