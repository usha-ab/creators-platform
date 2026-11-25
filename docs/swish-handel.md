# Swish Handel (Swish Commerce API)

Bekräftar Swish-köp automatiskt. Gästen betalar på biljettsidan och Swish
meddelar oss utfallet, så att ingen behöver trycka på Bekräfta i entrén.

Allt ligger bakom flaggan `SWISH_COMMERCE_ENABLED`. När den är av fungerar
Swish Företag som förut: en vilande bokning skapas, och entrén bekräftar för hand.

## Flödet

1. På eventsidan trycker gästen på "Jag har swishat". `POST /api/swish/intent` skapar
   en vilande bokning (`status 'pending'`, `payment_method 'swish'`). Det är oförändrat.
2. På `/biljett/<id>` trycker gästen på **Betala N kr med Swish**. `POST /api/swish/commerce/start`
   lägger en rad i `swish_payment_requests` och anropar Swish med
   `PUT /swish-cpcapi/api/v2/paymentrequests/{instructionUUID}` (mTLS). Beloppet tas ur bokningen.
3. Det som visas beror på enheten:
   - **Mobil:** `swish://paymentrequest?token=…&callbackurl=<biljettsidan>` öppnar appen.
   - **Dator:** en QR-kod från Swishs QR-API (`mpc.getswish.net/qrg-swish/api/v1/commerce`),
     via `/api/swish/commerce/qr`.
4. Swish anropar `POST /api/swish/commerce/callback`. Callbacken verifieras så här:
   - Headern `callbackIdentifier` måste vara det slumpade värde vi skickade med just den förfrågan.
   - Kroppen används bara för att hitta raden. Status, belopp, mottagare och valuta hämtas med vår egen
     `GET /swish-cpcapi/api/v1/paymentrequests/{id}` (mTLS). v2 har ingen GET, och MSS svarar 405.
   - Bekräftelsen sker bara om id, `payeeAlias`, `SEK` och beloppet stämmer med raden.
5. Vid PAID anropas `decideSwishBooking()` i `src/lib/swish/confirm.ts` (från #636), samma funktion som
   entréns Bekräfta. Den sätter `confirmed`, räknar upp `tickets_sold`, mejlar biljetten och skickar notis.
   Den är idempotent: bara det anrop som flyttar bokningen från `pending` räknar.
6. Polling-reserven: biljettsidan frågar `GET /api/swish/commerce/status?booking=<id>` varannan sekund.
   Uteblir callbacken frågar servern Swish själv, högst var fjärde sekund per förfrågan.

Vid DECLINED, ERROR eller CANCELLED förblir bokningen vilande, och gästen kan försöka igen.
Entréns "Swish att bekräfta" finns kvar som reserv.

## Miljövariabler

Pablo sätter dem i Vercel. Lägg dem aldrig i koden och logga dem aldrig.

| Variabel | Krävs | Värde |
|---|---|---|
| `SWISH_COMMERCE_ENABLED` | ja | `true` slår på. Allt annat betyder av. |
| `SWISH_COMMERCE_ENV` | nej | `test` (MSS, standard) eller `prod` (`cpc.getswish.net`) |
| `SWISH_PAYEE_ALIAS` | ja | Swish Handel-numret, 10 siffror (123…) |
| `SWISH_CERT_PEM` | ja* | Klientcertifikatet från Swish företagsportal, som PEM (eller som base64 av PEM) |
| `SWISH_KEY_PEM` | ja* | Certifikatets privata nyckel, som PEM (eller som base64) |
| `SWISH_P12_BASE64` | ja* | Alternativ till CERT/KEY: hela .p12-filen som base64 |
| `SWISH_P12_PASSPHRASE` | med p12 | Lösenordet till .p12-filen |
| `SWISH_CA_PEM` | i test | Rot-CA för Swish-servern. Krävs mot MSS (Swish TLS Root CA). I prod räcker Nodes egna (DigiCert Global Root G2). |
| `SWISH_CALLBACK_BASE_URL` | nej | Bas för callbackUrl. Standard är `NEXT_PUBLIC_APP_URL`, annars `https://usha.se`. Måste vara HTTPS på port 443. |

\* Antingen CERT+KEY eller P12.

Saknas något när flaggan är på loggas vilken variabel det gäller (aldrig värdet), och sajten faller
tillbaka på Swish Företag.

Sätt variablerna med `printf`, inte `echo`, så att inget radslut följer med. Markera dem som Sensitive.
Sätt dem bara i **Production**. Preview delar produktionens nycklar och ska inte ha certifikatet.

## Databas

Migrationen `supabase/migrations/20261126120000_swish_handel.sql` skapar tabellen `swish_payment_requests`
med RLS utan policyer, så att bara servern kommer åt den. **Den är inte körd.** Den kräver Pablos ja
och måste köras innan flaggan slås på.

## Att slå på

1. Ludvig tecknar Swish Handel hos Nordea och utser en certifikatsansvarig.
2. Den certifikatsansvarige skapar klientcertifikatet i Swish företagsportal (BankID).
3. Kör migrationen (efter Pablos ja).
4. Sätt variablerna i Vercel Production. Börja med `SWISH_COMMERCE_ENV=prod`.
5. Kontrollera att `app_config.swish_number` är samma nummer som `SWISH_PAYEE_ALIAS`, eftersom
   tillgänglighetsregeln fortfarande läser numret därifrån.
6. Gör ett provköp på 1 kr. Kontrollera att biljetten visas utan att entrén gör något.

Vill du stänga av: ta bort `SWISH_COMMERCE_ENABLED` och gör en redeploy.

## Test mot MSS lokalt

Swishs offentliga testcertifikat finns på developer.swish.nu → Environments → Certificates
(`MSS_test_3.0.zip`, lösenord `swish`). Testnumret är 1234679304. Använd dem bara lokalt.

- MSS returnerar PAID efter ungefär 4 sekunder.
- Fel simuleras via meddelandet: `RF07`, `BANKIDCL`, `TM01` och `DS24` ger status ERROR med respektive kod.
- Meddelandet får bara innehålla a-ö, A-Ö, 0-9, mellanslag och `!?(),.-:;`. Ett snedstreck ger RP02.
- MSS skickar callbacks från 89.46.83.171. I produktion kommer de från `egress.api.getswish.se`
  (FQDN-baserad vitlistning). Vercel kan inte filtrera på IP, så skyddet ligger i callbackIdentifier
  och i vår egen GET.
