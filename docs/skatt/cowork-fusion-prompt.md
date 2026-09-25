# Cowork-prompt — fusion av modell a + b + c (best-of-breed utbetalningsarkitektur)

> Klistra in blocket nedan i Cowork. Syftet: designa en **fusionsmodell** som dirigerar varje gig till den mest compliant + bästa marknadslösningen, och välja best-of-breed-leverantörer. Självbärande — Cowork behöver inte se repot.

---

```
KONTEXT
Jag driver Usha AB, en svensk tvåsidig marknadsplats (app: Usha Platform) som matchar
venues (caféer, kulturhus, spa, eventlokaler) med fristående kreatörer (DJ:s,
performanceartister, ljudbadsledare, musiker, workshopledare, dansinstruktörer,
eventfotografer, taxidansare) mot provision. Kreatörerna är användare, inte anställda.
USP: alla kreatörer är BankID-verifierade. Tidig fas, låg volym, vill skala.

En tidigare juridisk genomgång (DAC7 lag 2022:1681, moms agent/principal 6 kap. 7 § ML,
betaltjänstlag 2010:751/FI, kreatör- och venueskatt) gav tre möjliga modeller. Jag vill
inte välja EN — jag vill ha en FUSION som plockar det bästa ur alla tre och dirigerar
varje gig till rätt väg. Jag vill ha de bästa lösningarna som finns på marknaden.

DE TRE MODELLERNA
(a) STRIPE CONNECT: en licensierad PSP (Stripe/Adyen) håller pengarna och betalar ut via
    destination charges → Usha tar aldrig custody → undviker FI-tillstånd. Usha momsar bara
    sin provision.
(b) EGENANSTÄLLNING VIA API (Gigapay, ev. Frilans Finans/Invoicery): ett umbrella-bolag blir
    formell korttidsarbetsgivare per gig, drar skatt + arbetsgivaravgifter, betalar
    färdigbeskattad nettolön. Kreatören behöver VARKEN F-skatt eller eget bolag. Gigapay är
    API-first (sandbox, webhooks, BankID-onboarding). Tar bort F-skattekravet OCH
    betaltjänstrisken. Avgift ~2–6%.
(c) REN FÖRMEDLARE: kreatör med eget AB / godkänd F-skatt fakturerar venue direkt; Usha tar
    bara provision. Lägst compliance, men funkar bara för kreatörer som redan har bolag/F-skatt.

FUSIONEN JAG VILL HA DESIGNAD
En "payout router" som per kreatör/gig väljer optimal compliant väg, medan Ushas provision
ALLTID flödar separat via Stripe (aldrig via lönekedjan):
  - Kreatör med eget AB / godkänd F-skatt        → väg (c): fakturerar direkt
  - Kreatör utan F-skatt / utan bolag             → väg (b): egenanställning via Gigapay
  - (a) Stripe Connect som det gemensamma lagret för provision + kortbetalning + escrow/hold
Provisionsflöde och lönflöde ska vara STRIKT separerade så att Usha aldrig blir
betalningsinstitut eller "förmedlare i eget namn" (moms på hela beloppet).

DET JAG VILL ATT DU GÖR — utmana mig hårt och var konkret:
1. Är router-fusionen rätt arkitektur, eller överarbetar jag? Vad är den enklaste versionen
   som ändå är compliant och skalbar?
2. BEST-OF-BREED LEVERANTÖRER: vilka är de faktiskt bästa på marknaden 2026 för
   (i) egenanställning-API för plattformar (Gigapay vs Invoicery/Frilans Finans vs Cool Company
   vs andra), (ii) PSP/marketplace-payments (Stripe Connect vs Adyen for Platforms vs Mangopay
   vs Lemonway vs andra)? Vad skulle du välja och varför — pris, API-kvalitet, svensk
   compliance, BankID, internationell payout, support?
3. Vem bär kostnaden för umbrella-avgiften (2–6%) och hur prissätter jag det utan att skrämma
   bort kreatörer eller venues?
4. DAC7: egenanställning tar inte säkert bort min rapporteringsplikt. Hur ska routern och
   datamodellen byggas så att jag ändå kan rapportera korrekt (KU90–KU93) oavsett vilken väg
   ett gig tog? Vem rapporterar vad när Gigapay är arbetsgivare?
5. EDGE CASES: kreatör som byter status mitt i (skaffar F-skatt), utländsk kreatör, kreatör
   som vill ha lön via egenanställning för ETT gig men fakturera för ett annat, venue som vill
   ha en samlad faktura. Hur hanterar routern det?
6. Vad är de största riskerna/fallgroparna med att blanda tre flöden? Var blir det krångligt
   tekniskt, bokföringsmässigt och för användarupplevelsen?
7. Vad skulle en svensk skattejurist + en PSD2/betaltjänstspecialist mest sannolikt invända
   mot fusionen?
8. Ge mig en PRIORITERAD ROADMAP: minsta-möjliga-säkra MVP först (vilken väg lanserar jag
   först?), sedan nästa steg, och vad jag absolut måste få jurist-OK på innan skarp lansering.

FÖRBEHÅLL: paragrafhänvisningar och avgifter ovan kommer från Skatteverkets vägledning +
leverantörssidor, inte ordagrann lagtext — peka ut var jag måste verifiera mot fulltext eller
expert innan jag agerar.

Leverera: en kritisk genomgång + ett konkret förslag på fusionsarkitektur med namngivna
best-of-breed-leverantörer + en prioriterad roadmap.
```
