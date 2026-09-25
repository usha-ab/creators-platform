# Usha AB — Praktisk modell & rekommendation

> Sammanfattning av Ushas konkreta situation, konkret modellrekommendation och compliance-checklista. Underlag, ej juridisk/skatterådgivning. 2026-06-17. Bygger på [usha-skatt-research.md](./usha-skatt-research.md). Se även [egenanstallning-gigapay.md](./egenanstallning-gigapay.md) för egenanställning-spåret.

---

## Så funkar det när pengar passerar Usha — kärnan

Idag är premissen att **bokningspengar passerar Usha AB:s bolagskonto** innan utbetalning till kreatör/venue. Det skapar **två separata regelproblem**:

1. **Betaltjänstreglering (FI):** Att ta in tredje parts pengar på eget konto och slussa vidare är **penningöverföring/betalningstransaktion för annans räkning** (lag 2010:751, 1 kap. 2 § & 4 §) → tillståndspliktigt. Handelsagentundantaget (1 kap. 6–7 §) räddar **inte** Usha, eftersom det enligt PSD2/EBA bara gäller agent för *en* part — Usha är mellanhand för *båda*.
2. **Moms (eget vs annans namn):** Om Usha framstår som kundens motpart och kontrollerar tillhandahållandet anses Usha enligt **6 kap. 7 § ML** ha köpt och sålt tjänsten själv → moms på **hela** gaget, inte bara provisionen.

Båda problemen försvinner i hög grad om Usha **aldrig tar custody över pengarna** och **konsekvent presenteras som förmedlare** — inte leverantör.

> **Viktigt:** Detta avviker från dagens flöde (pengar via bolagskontot). Det är medvetet — researchen pekar tydligt på att lägga om till en licensierad PSP. Se rekommendation nedan.

---

## Modellval — tre alternativ

### (a) Marketplace tar emot pengar och betalar ut själv
- **Compliance:** Hög. Triggar betaltjänstreglering → FI-tillstånd som betalningsinstitut (>3 MEUR/mån) eller registrering som registrerad betaltjänstleverantör (<3 MEUR/mån). Avgifter: prövning undantag 232 500 kr, årlig tillsyn 50 000 kr (registrering); tillstånd dyrare. Risk för moms på hela transaktionen.
- **När rimligt:** först när volym och egen regulatorisk kapacitet finns. Inte tidig fas.

### (b) Ren förmedlare — kreatör fakturerar venue direkt, Usha tar provision av kreatör
- **Compliance:** Lägst. Usha rör aldrig kundens pengar; säljer bara förmedlingstjänst. Moms bara på provisionen.
- **Nackdel:** sämre produktupplevelse (ingen samlad betalning/escrow i appen), svagare kontroll över betalflöde och tvister, svårare att garantera att kreatör/venue faktiskt betalar.

### (c) Stripe Connect / reglerad PSP-partner ⟵ **REKOMMENDERAS**
- **Compliance:** Låg. Den licensierade PSP:n (Stripe/Adyen) håller medlen och gör utbetalningarna. Usha förblir **teknisk facilitator** (undantag lag 2010:751, 1 kap. 6 §) — **inget eget FI-tillstånd**. Pengar landar aldrig på Ushas konto.
- **Produkt:** behåller samlad in-app-betalning, escrow-liknande hold, automatiska utbetalningar, KYC via Stripe.
- **Hur:** *destination charges* eller *separate charges and transfers* + *funds segregation*. Kreatörer/venues onboardas som connected accounts (KYC hos Stripe).

> **Komplement (egenanställning):** för kreatörer utan F-skatt/eget bolag kan ett umbrella-bolag via API (Gigapay) agera korttidsarbetsgivare per gig → tar bort både F-skattekravet och betaltjänstrisken. Se [egenanstallning-gigapay.md](./egenanstallning-gigapay.md). En fusion av (a)+(b)+(c) diskuteras i [cowork-fusion-prompt.md](./cowork-fusion-prompt.md).

---

## Rekommendation för Usha (tidig fas)

**Kombinera (c) som betalningsmodell + förmedlare i *annans namn* som momsmodell.**

1. **Betalningar via Stripe Connect** (destination charges). Stripe håller och betalar ut. Usha tar aldrig custody → ingen FI-tillståndsplikt. *Lägg om dagens flöde där pengar går via bolagskontot.*
2. **Moms-status: förmedlare i annans namn.** Usha säljer förmedlingstjänst, momsar **bara provisionen** (25 %). Kreatören är säljare mot venue. Undviker att Usha "ärver" kreatörens skattesatser och påverkas av att många kreatörer ligger under 120 000 kr-gränsen.
3. **Krav för att hålla "annans namn"-statusen** (annars slår 6 kap. 7 § till): kreatören ska framstå som säljare/motpart mot venue; avtalsförhållandet ska tydligt vara kreatör↔venue; villkor, fakturatexter och kvitton ska beskriva Usha som **förmedlare som tar provision**, inte som leverantör av framträdandet. Stripe destination charge är förenligt så länge presentationen är konsekvent.
4. **DAC7 gäller oavsett betalningsmodell.** Även med Stripe Connect är Usha rapporteringsskyldig plattformsoperatör → registrera hos Skatteverket, samla TIN/personnr/orgnr i onboarding, logga ersättning per säljare/kvartal, lämna KU90–KU93 senast 31 jan.
5. **F-skattegrind:** verifiera/spara kreatörens F-skattestatus innan utbetalning som näringsinkomst — annars riskerar Usha/venue arbetsgivaransvar (skatteavdrag + arbetsgivaravgifter). *Alternativt: led kreatörer utan F-skatt till egenanställning (Gigapay).*

**Motivering:** tidig fas → minimera regulatorisk börda och kapitalbindning utan att offra produktupplevelsen. Stripe Connect ger samlad betalning *utan* att Usha blir betalningsinstitut. Annans namn-momsen minimerar Ushas momsbas och administrativa risk. DAC7 + F-skattegrind är icke-förhandlingsbara baskrav som byggs in i onboarding och utbetalningsflöde.

---

## Compliance-checklista

### Bolaget (Usha AB) — regulatoriskt
- [ ] **Stripe Connect** (eller Adyen) live; pengar går aldrig via Ushas eget konto (destination charges / funds segregation).
- [ ] Verifiera med skatterådgivare att betalningsupplägget håller "teknisk facilitator"-undantaget (1 kap. 6 § lag 2010:751).
- [ ] Bevaka 3 MEUR/mån-tröskeln — dokumentera att Usha inte själv är betalningsinstitut.
- [ ] **Momsmodell "annans namn"** dokumenterad: villkor, fakturamallar, kvitton beskriver Usha som förmedlare. Skatterådgivare bekräftar att 6 kap. 7 § ML inte slår till.
- [ ] Usha momsregistrerat; 25 % moms tas ut på provision.

### DAC7
- [ ] Registrera Usha som **rapporteringsskyldig plattformsoperatör** hos Skatteverket (senast 2 mån efter att kriterierna uppfylls).
- [ ] Onboarding samlar **TIN/personnummer (kreatör) / orgnr (venue/AB)**, namn, adress, hemviststat, kontoidentifikator.
- [ ] Kundkännedom/rimlighetsprövning mot register; klar senast **31 dec** varje år.
- [ ] Logga **ersättning per säljare per kvartal** + provisioner/avgifter.
- [ ] Lämna **KU90–KU93** senast **31 jan** året efter.
- [ ] **Informera säljaren** om vilka uppgifter som rapporteras (DAC7-transparens i appen).

### F-skattegrind & utbetalning
- [ ] Kräv/verifiera **godkänd F-skatt** för kreatörer som tar emot näringsinkomst innan utbetalning.
- [ ] Spara F-skattestatus + tidsstämpel (giltig vid avtals- ELLER betalningstidpunkt).
- [ ] Flagga/blockera utbetalning som näringsinkomst till kreatör utan F-skatt (annars arbetsgivaransvar) — *eller* led till egenanställning.
- [ ] Tydlig kommunikation: "detta är en utbetalning, inte lön".

### In-app-guidning (se [copy](./usha-inapp-guidning-copy.md) + [UX](./usha-inapp-guidning-ux.md))
- [ ] Kreatör-onboarding "Innan din första utbetalning".
- [ ] Pop-up vid första utbetalning ("utbetalning, inte lön").
- [ ] Sektion "Skatt & deklaration" (hobby/näring-quiz, YTD, januari-påminnelse, DAC7-transparens).
- [ ] Venue-onboarding (AB/enskild firma, bokföring, moms per event-typ, kassaregister).
- [ ] Skatte-FAQ + disclaimer + "kontakta din revisor"-CTA.

### Återkommande
- [ ] Årlig avstämning av belopp/trösklar (egenavgifter, 120 000 kr, 4 pbb, momssatser) mot Skatteverket.
- [ ] Bevaka Prop. 2025/26:109 (danstillställningar 6 %) och livsmedelsmoms 6 % (2026-04-01).
