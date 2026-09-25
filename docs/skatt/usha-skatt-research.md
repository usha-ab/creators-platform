# Usha AB — Skatt & reglering: research med källor och lagrum

> **Status:** Underlag, ej juridisk/skatterådgivning. Sammanställt 2026-06-17.
> **Metodvarning:** Direkt sidhämtning (WebFetch) var blockerad under researchen. Paragrafhänvisningar bygger på Skatteverkets rättsliga vägledning + riksdagens sökträffar, inte ord-för-ord-läsning av lagtext. **Alla load-bearing § och belopp ska bekräftas mot fulltext på riksdagen.se / lagen.nu samt med skatterådgivare innan de används i myndighetskontakt eller avtal.**

Usha AB driver en svensk tvåsidig marknadsplats (appen Usch-Ja!) som matchar **venues** (caféer, kulturhus, spa, eventlokaler) med fristående **kreatörer** (DJ:s, performanceartister, ljudbadsledare, musiker, workshopledare, dansinstruktörer, eventfotografer, taxidansare) mot **provision**. USP: BankID-verifierade kreatörer. Kreatörerna är *användare*, inte anställda.

Fem regelområden träffar bolaget: (1) DAC7-plattformsrapportering, (2) moms agent vs principal, (3) betaltjänstreglering/FI, (4) kreatörens egen skatt, (5) venuens skatt + kassaregister.

---

## 1. DAC7 — plattformsrapportering (lag 2022:1681)

### Tillämplig lag
- **Lag (2022:1681) om plattformsoperatörers inhämtande av vissa uppgifter på skatteområdet** ("POL") — i kraft 1 jan 2023. DAC7-genomförandet i svensk rätt.
- **Lag (2022:1682) om automatiskt utbyte av upplysningar om inkomster genom digitala plattformar** — Skatteverkets vidareförmedling till andra EU-länder.
- **Förordning (2022:1692)**.
- Sanktions-, kontrolluppgifts- och anmälningsregler ligger i **skatteförfarandelagen (2011:1244)** (SFL).

### Omfattas Usha? — Ja, sannolikt
Usha matchar säljare (kreatörer/venues) med användare mot ersättning, tar provision och möjliggör ("facilitate") transaktionen. Det gör Usha till **rapporteringsskyldig plattformsoperatör**. Att pengar (i nuvarande modell) passerar Ushas konto stärker bilden ytterligare — men rapporteringsskyldigheten kvarstår **även om betalningen läggs om till Stripe Connect**, eftersom Usha fortfarande känner till ersättningen och möjliggör verksamheten.

### Berörd verksamhet (POL 2 kap. 10 §)
Verksamhet mot ersättning som är: (1) uthyrning av fast egendom, (2) **personlig tjänst** (tids-/uppgiftsbaserat arbete av fysiska personer), (3) försäljning av varor, (4) uthyrning av transportmedel. Undantag: arbete säljaren utför som anställd hos plattformen.
→ **Kreatörers uppdrag = personlig tjänst. Klart inom tillämpningsområdet.**

### Vad ska rapporteras per säljare (KU90–KU93)
- Identitet: namn, adress; för enhet även orgnr/registreringsnr + ev. fast driftställe.
- **TIN / personnummer / orgnr** + utfärdande jurisdiktion.
- Hemviststat(er).
- Finansiellt konto (kontoidentifikator dit ersättning betalas; kontohavarens namn om annan än säljaren).
- **Ersättning per berörd verksamhet och per kvartal**, antal verksamheter, samt avgifter/provisioner/skatter som plattformen tagit ut.
- För fastighetsuthyrning även adress + fastighetsbeteckning (ej relevant för Usha primärt).

### Frister & registrering
- **Registrering hos Skatteverket:** snarast, senast **två månader** efter att kriterierna uppfyllts.
- **Kundkännedom (due diligence) klar:** senast **31 december** under rapporteringsperioden (kalenderåret).
- **Kontrolluppgift till Skatteverket:** senast **31 januari** året efter aktuellt år. (Sanktion knyts i lagtexten även till 31 mars — bekräfta exakt frist.)
- Säljaren ska informeras om vilka uppgifter som lämnas (→ DAC7-transparens i appen, se copy-dokumentet).

### Undantag & tröskelvärden
- **Undantagen plattformsoperatör:** kräver beslut från Skatteverket och förutsätter att plattformen *inte har några* rapporteringspliktiga säljare. **Ej tillämpligt på Usha.**
- **Undantagna säljare** (rapporteras ej): offentliga enheter, börsnoterade enheter, storskaliga fastighetsuthyrare (>2 000 tillfällen/objekt), samt **varuförsäljare med <30 transaktioner OCH ≤2 000 EUR** (de minimis — gäller **endast varuförsäljning**).
- **Ingen de minimis-tröskel för personliga tjänster.** Varje kreatör som fått ersättning via Usha är i princip rapporteringspliktig.

### Sanktioner — plattformsavgift (SFL)
- **2 500 kr** per kontrolluppgift där föreskrivna uppgifter saknas/inte lämnats.
- **5 000 kr** om operatören klart inte fullgjort skyldigheter avs. kontrolluppgift, kundkännedom eller dokumentation.
- Flera avgifter kan tas ut för samma brist.

### Källor
- Lag 2022:1681 — https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-20221681-om-plattformsoperatorers_sfs-2022-1681/
- Lag 2022:1682 — https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-20221682-om-automatiskt-utbyte-av_sfs-2022-1682/
- Förordning 2022:1692 — https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/forordning-20221692-om-plattformsoperatorers_sfs-2022-1692/
- SFL 2011:1244 — https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/skatteforfarandelag-20111244_sfs-2011-1244/
- Skatteverket, digitala plattformar lämna uppgifter — https://www.skatteverket.se/foretag/drivaforetag/startaochregistrera/digitalaplattformarlamnauppgifteromsaljareuthyrareochersattningar.4.7c708f0e16bed42cd0555d5.html
- KU90–KU93 — https://skatteverket.se/foretag/skatterochavdrag/kontrolluppgifter/kontrolluppgifterfranplattformsoperatorerku90ku91ku92ochku93.4.21e4ba96188260715e3109.html
- Rättslig vägledning, berörda verksamheter — https://www4.skatteverket.se/rattsligvagledning/edition/2022.14/415175.html
- Rättslig vägledning, rapporteringspliktiga säljare/undantag — https://www4.skatteverket.se/rattsligvagledning/edition/2025.1/415199.html
- Rättslig vägledning, kundkännedom — https://www4.skatteverket.se/rattsligvagledning/edition/2024.6/415205.html

---

## 2. Moms — förmedlare (agent) vs egen leverantör (principal)

### Två modeller, radikalt olika momsutfall
- **Förmedling i *annans* namn** (ren mellanhand): kreatören är säljare mot venue/kund. Usha säljer bara sin **förmedlingstjänst** → moms **endast på provisionen** (25 %). Pengaflöde över plattformen ändrar inte detta så länge Usha agerar i kreatörens namn.
- **Förmedling i *eget* namn** (kommissionärsliknande, **6 kap. 7 § ML**): om Usha framstår som kundens motpart och har kontroll över tillhandahållandet, anses Usha ha **både köpt och sålt** tjänsten (kreatör→Usha, Usha→kund). Då moms på **hela transaktionsbeloppet**.

### Avgörande test (Skatteverket)
Usha anses agera i *eget namn* om båda: (a) Usha har **kontroll över tillhandahållandet** till köparen, och (b) Usha **framstår som köparens motpart**. Båda uppfyllda = eget namn = moms på allt. Annars = annans namn = moms enbart på provision.

### Lagrum
- **6 kap. 7 § mervärdesskattelagen (2023:200)** — kommissionärsfiktionen (motsvarar art. 14.2 c / art. 28 i momsdirektivet).
- **9 kap. 2 § ML** — normalskattesats 25 %.
- **9 kap. 14 § ML** — reducerad 6 %.
- **10 kap. 30 § ML** — artistundantaget.
- **18 kap. ML** — särskild ordning för liten årsomsättning (omsättningsgräns).

### Skattesatser per kreatörstjänst
| Tjänst | Moms | Grund |
|---|---|---|
| Utövande konstnärs framförande av upphovsrättsskyddat verk inför publik (sångare, musiker, dansare, skådespelare, dirigent) | **Undantaget** | 10 kap. 30 § ML — gäller **inte** om artisten själv är arrangör |
| Upplåtelse/överlåtelse av upphovsrätt (royalty, inspelningsrätt) | **6 %** | 9 kap. 14 § ML |
| Tillträde till konsert/musikevenemang | **6 %** | 9 kap. 14 § ML |
| DJ (spela skivor), ljudbadsledare, workshopledare | **25 %** | 9 kap. 2 § ML |
| Dansundervisning/dansinstruktör | **25 %** | huvudregel |
| Eventfotograf, tekniker, stylist, sminkör, produktionsledare | **25 %** | huvudregel |

> **Rörligt område:** tillträde till **danstillställningar** föreslås sänkas till 6 % (Prop. 2025/26:109). Bedöm tjänst för tjänst — gränsdragningen är fallberoende.

### Omsättningsgräns för småföretag (kreatörerna)
- **120 000 kr/kalenderår** (höjt från 80 000 kr per 1 jan 2025), om omsättningen inte heller översteg gränsen något av de två föregående åren och säte i Sverige. Under gränsen → kan vara momsbefriad (ingen utgående moms, ingen avdragsrätt). Frivillig registrering möjlig.
- **Fördel med annans namn-modellen:** många kreatörer ligger under 120 000 kr → momsbefriade. Usha lägger ändå 25 % moms på **sin egen provision**, och kreatörens del flyter igenom momsfritt. Usha slipper "ärva" kreatörens varierande skattesats.

### Faktura — vem tar ut moms
- **Annans namn:** kreatören fakturerar venue (sin moms / momsfritt). Usha fakturerar kreatören (eller kunden) **provision + 25 %**. Usha kan ställa ut faktura *i kreatörens namn* (självfakturering).
- **Eget namn:** Usha fakturerar kunden hela beloppet med tillämplig moms; kreatören fakturerar Usha. Usha ärver kreatörens skattesats — administrativt tungt + risk att Usha blir momsskyldig för tjänster vars säljare egentligen var momsbefriade.

### Källor
- ML 2023:200 — https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/mervardesskattelag-2023200_sfs-2023-200/
- Konsoliderad ML (lagen.nu) — https://lagen.nu/2023:200/konsolidering/2024:594
- Förmedling i eget eller annans namn — https://www4.skatteverket.se/rattsligvagledning/edition/2023.15/384786.html
- Förmedling i eget namn — https://www4.skatteverket.se/rattsligvagledning/edition/2023.14/385623.html
- Artistframträdanden — https://www4.skatteverket.se/rattsligvagledning/edition/2024.5/360463.html
- Frågor & svar kulturmomsen — https://www4.skatteverket.se/rattsligvagledning/369447.html
- Momssatser & undantag — https://www.skatteverket.se/foretag/moms/saljavarorochtjanster/momssatserochundantagfranmoms.4.58d555751259e4d66168000409.html
- Höjd omsättningsgräns 120 000 — https://www.skatteverket.se/omoss/pressochmedia/nyheter/2024/nyheter/hojdomsattningsgransformoms.5.262c54c219391f2e9633e61.html
- Prop. 2025/26:109 (danstillställningar 6 %) — https://www.riksdagen.se/sv/dokument-och-lagar/dokument/proposition/sankt-mervardesskatt-pa-tilltrade-till_hd03109/html/

---

## 3. Betaltjänstreglering — lag (2010:751) & Finansinspektionen

### När blir "pengar genom kontot" tillståndspliktigt?
- **Lag (2010:751) om betaltjänster** kräver **tillstånd från FI** för att tillhandahålla betaltjänster (2 kap. 1 §). Betaltjänster definieras i **1 kap. 2 §** — bl.a. genomförande av betalningstransaktioner och **penningöverföring**.
- **Penningöverföring** (1 kap. 4 §): att ta emot medel från en betalare, utan att betalkonto öppnas, i enda syfte att överföra motsvarande belopp till en mottagare.
- En marknadsplats som **tar in köparens pengar på eget bolagskonto och slussar dem vidare** till kreatör/venue utför i praktiken en betalningstransaktion/penningöverföring för annans räkning → **tillståndspliktigt moment**. Avgörande är **förvaring och kontroll över andras medel i förmedlingssyfte**.

### Handelsagent-/kommissionärsundantaget (1 kap. 6–7 §§)
- Undantag finns för betalningar genom **handelsagent/liknande med behörighet att förhandla/sluta avtal för enbart betalarens *eller* enbart betalningsmottagarens räkning** (PSD2 art. 3 b).
- **PSD2/EBA-nyans:** undantaget gäller bara om agenten företräder **antingen betalaren eller mottagaren — inte båda**. En tvåsidig marknadsplats som hanterar betalning åt **både** köpare och säljare **faller utanför undantaget** (EBA Q&A 2020_5354).
- **Slutsats för Usha:** sätter Usha pris, tar betalt av köpare och betalar ut till kreatör som mellanled för båda → undantaget gäller normalt **inte**.

### Övriga undantag (1 kap. 6 §)
- **Begränsat nät** — passar dåligt en öppen bokningsmarknadsplats.
- **Teknisk leverantör som aldrig kommer i besittning av medlen** — **nyckeln**: tar Usha aldrig kontroll över pengarna behövs inget tillstånd.

### Tillstånd vs registrering
- **Betalningsinstitut (fullt tillstånd):** krävs om genomförda transaktioner i snitt överstiger **3 miljoner EUR/månad**.
- **Registrerad betaltjänstleverantör (undantag, 2 kap. 3 §):** lägre volym (<3 MEUR/mån snitt över 12 mån) kan ansöka om registrering. Måste löpande bevaka gränsen.
- **Avgifter (FI):** prövning tillstånd 405 000 kr; prövning undantag 232 500 kr (jur. person). Årlig tillsyn: betalningsinstitut minst 150 000 kr; undantag 50 000 kr.
- **Ombud:** den som bara är ombud för ett betalningsinstitut behöver ej eget tillstånd men ska registreras av huvudmannen hos FI.

### Hur Stripe Connect / Adyen for Platforms löser det
- Den **licensierade PSP:n (Stripe/Adyen) håller medlen och gör utbetalningarna** → plattformen blir **teknisk facilitator** (undantag 1 kap. 6 §). Pengarna går aldrig in på Ushas eget konto.
- **Destination charges:** betalning debiteras via plattformens Stripe-konto men frikopplas från överföringen till connected account; Stripe flyttar nettot till kreatören.
- **Separate charges and transfers + funds segregation:** debitering och transfer i separata anrop; medel kan hållas i "holding" som inte syns i plattformens balans och bara kan föras till connected account — funktionellt escrow utan civilrättslig custody hos plattformen.

### Svenska plattformsexempel
- **Yepstr:** undviker frågan helt via **arbetsgivarmodell** — ungdomarna är *anställda*, får färdigbeskattad lön (inkl. semesterersättning). Lön, ej penningöverföring.
- **Tiptapp / typiska gig-/bokningsmarknadsplatser:** **Stripe Connect / Adyen for Platforms** med innehållna utbetalningar (delayed payout), PSP:n håller medlen.
- **Heyhood / Tutti / Gigstr:** marknadsplats- resp. bemanningsmodeller; antingen licensierad PSP-partner eller (Gigstr) anställnings-/löneutbetalning. *Exakt PSP-partner per bolag kunde ej verifieras i öppna källor — den genomgående lösningen är extern PSP eller anställning.*

### Källor
- Lag 2010:751 — https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-2010751-om-betaltjanster_sfs-2010-751/
- Lag 2010:751 (lagen.nu) — https://lagen.nu/2010:751
- Prop. 2017/18:77 (PSD2-genomförande) — https://www.riksdagen.se/sv/dokument-och-lagar/dokument/proposition/nya-regler-om-betaltjanster_H50377/html/
- FI, söka tillstånd betaltjänster — https://www.fi.se/sv/betalningar/sok-tillstand/betaltjanster/
- FI, tillstånd eller enbart registrering — https://www.fi.se/sv/vara-register/foretagsregistret/tillstand-av-fi-eller-enbart-registrering/
- FI, ombud — https://www.fi.se/sv/betalningar/sok-tillstand/betaltjanster/ombud-for-betalningsinstitut-och-betaltjanstleverantorer/
- FI, undantag (PDF) — https://www.fi.se/contentassets/15eabba2304c427fb44e8c4e5d185ede/betaltjanster/betaltj_ans_undantagny2.pdf
- EBA Q&A 2020_5354 — https://www.eba.europa.eu/single-rule-book-qa/qna/view/publicId/2020_5354
- Stripe Connect charges — https://docs.stripe.com/connect/charges
- Stripe funds segregation — https://docs.stripe.com/connect/funds-segregation
- Adyen for Platforms — https://www.adyen.com/platform-payments

---

## 4. Kreatörens skatt — hobby vs näring, F-skatt, egenavgifter, deklaration

### Hobby eller näringsverksamhet — gränsdragningen (13 kap. 1 § IL)
Näringsverksamhet kräver tre kriterier **samtidigt**: **självständighet**, **varaktighet**, **vinstsyfte**.
- **Hobby** = självständig + varaktig men **saknar verkligt vinstsyfte** → beskattas som **inkomst av tjänst** även om den ger visst överskott.
- Glidande gräns; Skatteverket gör samlad bedömning (art, omfattning, marknadsföring, försörjningsbehov). **En kreatör som löpande säljer tjänster på en plattform glider snabbt över i näringsverksamhet.**

### Om hobby
- Deklareras som inkomst av tjänst på **bilaga T2** (SKV 2051). Endast **överskottet** beskattas; underskott kvittas bara mot framtida överskott i samma hobby.
- Kreatören betalar **egenavgifter själv**: **28,97 %** (född 1959+). Schablonavdrag på T2, avstäms året därpå.
- Plattformen gör normalt **inget skatteavdrag** och betalar inga arbetsgivaravgifter på hobbyinkomst.

### F-skatt / FA-skatt — och utbetalarens ansvar (KRITISKT)
- Den som **inte** är godkänd för F-skatt har **A-skatt**.
- **Har kreatören F-skatt** (åberopad skriftligen): utbetalaren ska **varken** göra skatteavdrag **eller** betala arbetsgivaravgifter. Kreatören sköter skatt + egenavgifter själv.
- **Saknar kreatören F-skatt** + får **ersättning för arbete**: utbetalaren kan bli skyldig att **göra skatteavdrag** + **betala arbetsgivaravgifter** (gäller från sammanlagt 1 000 kr/år till samma person). Skatteverket är tydlig att detta gäller även enskild näringsidkare utan F-skatt, och även om rätten till betalning överlåtits.
- **FA-skatt** = både F- och A-skatt; F-skatten åberopas bara i näringsverksamheten.
- **Konsekvens för Usha/venue:** betalas en kreatör utan F-skatt för arbete riskerar utbetalaren att betraktas som arbetsgivare. → **Usha bör kräva/verifiera godkänd F-skatt innan utbetalning som näringsinkomst.**

### Om näringsverksamhet
- Redovisas på **NE-bilaga**. Egenavgifter ~28,97 % på överskottet, schablonavdrag (vanligen 25 %).
- Löpande **debiterad preliminärskatt (F-skatt)** varje månad.

### Moms för kreatören
- Omsättningsgräns **120 000 kr/kalenderår** (höjt från 80 000 per 1 jan 2025). Under gränsen → kan vara momsbefriad. Vid passering: ta ut moms från den försäljning som överskred gränsen + momsregistrera.

### Praktiskt innan första utbetalning
1. Avgör hobby vs näring (självständighet/varaktighet/vinstsyfte). Återkommande betalda uppdrag = oftast näring.
2. **Hobby:** inget att registrera i förväg; spara underlag, redovisa överskott på T2, betala egenavgifter själv.
3. **Näring:** ansök om **F-skatt** (+ momsregistrering om 120 000-gränsen nås/väljs) via verksamt.se. Handläggning ~2–3 veckor.
4. Kontrollera plattformens krav — de behöver ofta F-skatt för att slippa skatteavdrag/arbetsgivaravgifter.

### Källor
- Vad är näringsverksamhet — https://www.skatteverket.se/foretag/drivaforetag/startaochregistrera/vadarnaringsverksamhet.4.6efe6285127ab4f1d25800025792.html
- Hobby – ekonomisk verksamhet? — https://www4.skatteverket.se/rattsligvagledning/edition/2024.7/369082.html
- Hobby (privat) — https://www.skatteverket.se/privat/skatter/arbeteochinkomst/inkomster/hobby.4.58d555751259e4d661680003940.html
- Bilaga T2 (SKV 2051) — https://www.skatteverket.se//privat/etjansterochblanketter/blanketterbroschyrer/blanketter/info/2051.4.39f16f103821c58f680006232.html
- Egenavgifter vid tjänsteinkomster — https://www.skatteverket.se/privat/skatter/arbeteochinkomst/inkomster/egenavgiftervidtjansteinkomster.4.70ac421612e2a997f85800022812.html
- Hobbybroschyr SKV 344 — https://www.skatteverket.se/download/18.7eada0316ed67d72829d0/1708607298602/hobbyverksamhet-skv344-utgava14.pdf
- Ersättning till den som har F-skatt — https://www4.skatteverket.se/rattsligvagledning/edition/2023.13/1326.html
- Den som ger ut ersättning för arbete ska betala — https://www4.skatteverket.se/rattsligvagledning/edition/2014.1/1316.html
- Momsregistrering ≤120 000 kr — https://www.skatteverket.se/foretag/moms/momsregistrering/momsregistreringnararsomsattningenarhogst120000kronor.4.3152d9ac158968eb8fd1efe.html
- verksamt.se F-skatt/moms — https://verksamt.se/en/f-tax-vat-employer-sni
- IL 1999:1229 — https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/inkomstskattelag-19991229_sfs-1999-1229/

---

## 5. Venuens skatt — fakturering, moms, kassaregister

### Bokföring av plattformsintäkter/-kostnader + moms
- Det venue tar betalt av besökare (entré, biljett, mat) är venuens **intäkt** → **utgående moms** på hela beloppet, även om pengaflödet passerar plattformen.
- Plattformens provision = **kostnad** med ev. ingående moms.
- Gaget till kreatören = **kostnad**; är kreatören momsregistrerad och fakturerar moms får venue **dra ingående moms**.
- **Blandad verksamhet** (momsfri idrott/sjukvård + momspliktig servering): moms dras bara på den momspliktiga delen.
- Plattformen kan utfärda faktura i venuens namn (självfakturering), men venue förblir skattskyldig för utgående moms.

### Moms per evenemangstyp
| Evenemang | Moms | Grund |
|---|---|---|
| Konsert/teater/bio/opera/balett/cirkus (entré) | **6 %** | kulturmoms |
| Tillträde till/utöva idrott (t.ex. dansklass, simning) | **6 %** (momsfritt om allmännyttig förening) | idrott |
| Klubbkväll utan kulturframförande | **25 %** | huvudregel |
| Workshop/kurs (utbildning, ej "utöva idrott") | **25 %** | huvudregel |
| Spa/relax/behandling | **25 %** | gym/spa ej "idrott" |
| Serveringstjänst café/restaurang | **12 %** (vin/sprit/starköl 25 %) | servering |
| Livsmedel (take-away/vara) | **6 % fr.o.m. 2026-04-01** (var 12 %) | livsmedel |

> **Arrangörsregeln:** säljer en artist *både* framträdandet och biljetterna i egen lokal blir artisten arrangör → 6 % på entrén. Venue som säljer biljett vidare tar ut moms på entrén.

### Kassaregisterkrav — lag (2007:592)
- **Huvudregel (2 §):** näringsidkare som säljer mot **kontant- eller kortbetalning** ska ha certifierat kassaregister + erbjuda kvitto.
- **Undantag (3 §):**
  - **Obetydlig omfattning:** kontant-/kortförsäljning ≤ **4 prisbasbelopp inkl. moms/räkenskapsår** (= **236 800 kr 2026**) → inget krav.
  - **Fakturerad försäljning** omfattas inte.
  - **Distans- och obemannad försäljning** undantas.
  - Stat/region/kommun, konkursbon, allmännyttiga ideella föreningar undantas.
- **Biljetter enbart online/via plattform** = distans/fakturerad → **kräver inte kassaregister**.

### Betalning enbart via plattform = utanför kravet?
- **Ja, om ingen kontant-/kortbetalning sker i lokalen.** Kravet utlöses bara av kontant/kort på plats.
- **OBS Swish & elektroniska betalningar jämställs med kortbetalning** — Swish vid kassan i lokalen räknas in.
- Banköverföring/faktura via plattformen (ingen fysisk terminal hos venue) ligger **utanför** kravet. Tar venue kontant/kort/Swish vid dörren/baren gäller kravet om gränsen 4 pbb överskrids.

### F-skattekontrollplikt vid betalning till kreatör
- Venue som betalar ersättning för **arbete** måste kontrollera att mottagaren är **godkänd för F-skatt** (eller FA + skriftlig F-hänvisning).
- **Saknas säker F-skatteuppgift → venue skyldigt att göra skatteavdrag + betala arbetsgivaravgifter.** Godkännandet ska finnas vid avtals- eller betalningstidpunkten.
- **För Usha-flödet:** plattformen bör verifiera/spara kreatörens F-skattestatus innan gage betalas ut, annars riskerar utbetalande venue arbetsgivaransvar.

### Källor
- Momssatser & undantag — https://www.skatteverket.se/foretag/moms/saljavarorochtjanster/momssatserochundantagfranmoms.4.58d555751259e4d66168000409.html
- Entréavgifter till föreställningar — https://www4.skatteverket.se/rattsligvagledning/edition/2023.16/339610.html
- Frågor & svar kulturmomsen — https://www4.skatteverket.se/rattsligvagledning/edition/2025.7/369447.html
- Tillträde till idrottsligt evenemang — https://www4.skatteverket.se/rattsligvagledning/edition/2025.2/426616.html
- Tjänster med samband med idrott — https://www4.skatteverket.se/rattsligvagledning/edition/2024.6/422440.html
- Utöva idrottslig verksamhet — https://www4.skatteverket.se/rattsligvagledning/edition/2025.3/426622.html
- Restaurang-/cateringtjänster — https://www4.skatteverket.se/rattsligvagledning/edition/2025.2/395002.html
- Livsmedelsmomsen sänks till 6 % — https://www.skatteverket.se/omoss/pressochmedia/nyheter/2026/nyheter/livsmedelsmomsensankstill6procent.5.70685bee19c85dd5dd0a3f.html
- Inköp till företaget (avdrag ingående moms) — https://www.skatteverket.se/foretag/moms/kopavarorochtjanster/kopavarorellertjanstertillforetaget.4.7459477810df5bccdd480005156.html
- Lag 2007:592 om kassaregister — https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-2007592-om-kassaregister-m-m-_sfs-2007-592/
- Undantag från krav på kassaregister — https://www.skatteverket.se/foretag/drivaforetag/kassaregister/undantagfrankravpakassaregister.4.6efe6285127ab4f1d2580005105.html
- Torg- och marknadshandel — https://skatteverket.se/foretagochorganisationer/drivaforetag/kassaregister/torgochmarknadshandel.4.5c1163881590be297b51bf03.html
- F- och FA-skatt — https://www.skatteverket.se/foretag/drivaforetag/startaochregistrera/fochfaskatt.4.58d555751259e4d661680006355.html

---

## Punkter att verifiera mot fulltext innan officiell användning
1. POL 2 kap. 10 § (berörda verksamheter) + exakta plattformsavgifter (2 500/5 000 kr) + frist 31 jan vs 31 mar.
2. Exakta § i lag 2010:751 (1 kap. 2 §, 4 §, 6–7 §; 2 kap. 1 §, 3 §) + FI:s aktuella avgifter och 3 MEUR-tröskel.
3. ML §: 6 kap. 7 §, 9 kap. 2 §/14 §, 10 kap. 30 §, 18 kap. — samt status för Prop. 2025/26:109 (danstillställningar).
4. Aktuella belopp 2026: egenavgifter 28,97 %, omsättningsgräns 120 000 kr, 4 pbb = 236 800 kr, livsmedelsmoms 6 % fr.o.m. 2026-04-01.
5. Exakt momssats för dansklass/workshop (idrott 6 % vs utbildning 25 %) — fallberoende.
