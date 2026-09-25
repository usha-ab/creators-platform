# Egenanställning via API — Gigapay, Frilans Finans m.fl.

> Research om att koppla ett egenanställningsföretag (umbrella) till Usha via API så att kreatörer kan korttidsanställa sig själva per gig — utan F-skatt eller eget bolag. Underlag, ej juridisk/skatterådgivning. 2026-06-30. Komplement till [usha-skatt-research.md](./usha-skatt-research.md) och [usha-praktisk-modell.md](./usha-praktisk-modell.md).
> **Metodförbehåll:** bygger på WebSearch + leverantörernas egna sidor, inte fulltext av lagtext. Bekräfta belopp/avgifter och betaltjänst-/DAC7-bedömning med skatterådgivare + jurist mot Ushas exakta upplägg.

---

## 1. Modellen: egenanställning

Ett **egenanställningsföretag** blir formell **arbetsgivare per uppdrag**, utan att kreatören startar bolag eller skaffar F-skatt:

1. Kreatören utför giget och rapporterar belopp till umbrellan.
2. Umbrellan **fakturerar venue** i kreatörens ställe (med moms).
3. Umbrellan gör **skatteavdrag** + betalar **arbetsgivaravgifter** (31,42 %; reducerat 20,81 % på del ≤ 25 000 kr/mån) till Skatteverket.
4. Kreatören får **färdigbeskattad nettolön**.

Skatteverket erkänner modellen uttryckligen: kreatören får inkomst av tjänst, behöver **varken F-skatt eller eget företag**. Som formellt anställd tjänar kreatören in **SGI** (Försäkringskassan), kan vara med i a-kassa som löntagare, får **semesterersättning** (12 %) och täcks normalt av umbrellans **försäkringar** + ev. pensionsavsättning.

---

## 2. Vad det löser för Usha

- **F-skattegrinden borttagen** — ingen kreatör behöver F-skatt; tröskeln för att ta betalt försvinner.
- **Usha/venue blir aldrig arbetsgivare** — allt arbetsgivaransvar ligger hos umbrellan.
- **Betaltjänstlagen/FI undviks** — förutsatt att Usha inte själv samlar in och slussar lönepengarna. Venue→umbrella→nettolön är en löne-/arbetsgivarrelation, inte penningöverföring.
- **Moms** — umbrellan fakturerar venue med moms; kreatören slipper momsregistrering. Ushas provision är en separat momspliktig tjänst.
- **Trygghet** — försäkring, SGI, semesterersättning, pension utan att Usha bygger det.

**Löser INTE säkert: DAC7.** Usha kan fortfarande vara rapporteringsskyldig plattformsoperatör eftersom plattformen *möjliggör* tjänsten. Beror på avtalsupplägget → stäm av med skatterådgivare/Skatteverket. Behandla rapporteringsplikten som potentiellt kvarstående tills verifierat.

---

## 3. Leverantörsjämförelse

| | **Gigapay** | **Frilans Finans** (Invoicery) | **Cool Company** |
|---|---|---|---|
| API för plattformar | ✅ API-first, dokumenterat, sandbox, webhooks | ⚠️ REST-API finns men ej självbetjäning; kräver partneravtal | ❌ Inget öppet plattforms-API |
| Roll | Employer/Merchant of Record per gig | Egenanställning (marknadsledare, >1 milj. fakturor) | Egenanställning (SE/NO/DK/FI) |
| Avgift | ~2 % plattformsvolym (publik SaaS: €279/mån + 4,9 %/payout) | 6 % av fakturerat | 5,98 % av fakturerat |
| BankID-onboarding | ✅ | ✅ | ✅ |
| Utländska arbetare | ✅ KYC/KYB i 80+ länder, payout i 65+ marknader | Främst SE | Norden |
| Ingår | Skatt, avgifter, semesterers., pension, försäkring, KYC, rapportering | Samma + kollektivavtal (minimilön, ITP-pension ~4,5 %) | Samma + försäkring |
| Lämplighet för inbäddad marknadsplats | **Hög** | Medel (partnerdialog) | Låg |

**Slutsats:** Gigapay är det mest renodlade valet för API-first marknadsplatsintegration. Frilans Finans/Invoicery är närmaste API-konkurrent men trögare. Cool Company främst som frilans-broker.

---

## 4. Gigapay — teknisk integration

**API:** REST/JSON över HTTPS, token-auth, sandbox + produktion. Dokumenterat på developer.gigapay.com. Integrationstid uppges 2–5 dagar.

**Flöde (v2):**
- `POST /v2/projects/` — container för ett uppdrag
- `POST /v2/prepayments/` — finansiera projektet
- `POST /v2/registrations/` — onboarda kreatör + KYC (BankID i SE)
- `POST /v2/payouts/` — betala ut

**Webhooks** att lyssna på: `EmployeeCreated`, `EmployeeNotified`, `EmployeeClaimed`, `EmployeeVerified`, `InvoiceCreated`, `InvoicePaid`, `PayoutCreated`, `PayoutNotified`, `PayoutAccepted`.

**Identitet:** svenska kreatörer — personnr/samordningsnr, svenskt bankkonto, BankID-signering (matchar Ushas befintliga `is_bankid_cleared`-grind). Utländska — KYC/KYB, lokala payout-rails (SEPA Instant, Faster Payments, ACH).

**Vad Usha skickar per gig:** belopp, mottagare (namn, kontakt, ev. personnr), kund-/venue-referens, uppdragsbeskrivning, valuta/marknad.

---

## 5. Pengaflöde i en Usha-integration

```
Venue betalar brutto
      │
      ├──► Usha behåller provision (via Stripe)
      │
      └──► lönedel + Gigapay-avgift  ──► Gigapay  ──► drar skatt/avgifter ──► nettolön till kreatör
```

**Regel:** håll **lönflödet hos umbrellan** och **provisionsflödet i Stripe**, strikt separerade. Usha skickar bara vidare det som ska bli lön; mellanskillnaden (provisionen) rör aldrig umbrellans utbetalningskedja. Att Usha själv samlar in *hela* beloppet och vidarebefordrar drar in betaltjänstfrågan igen — undvik det.

---

## 6. Avvägningar

- **Kostnad ovanpå provision** (2–6 %) — någon ska bära den (kreatör eller venue); påverkar prissättning.
- **Blir "lön", inte näringsinkomst** — perfekt för kreatör utan bolag, men en etablerad kreatör med eget AB vill fakturera direkt. → stöd troligen **båda spåren**.
- **DAC7 fortfarande öppen fråga.**
- **Tredjepartsberoende** för ett kärnflöde (utbetalningar).

---

## Källor
- Gigapay developer — https://developer.gigapay.com/
- Gigapay API/produkt — https://www.gigapay.com/product/gigapay-api · https://www.gigapay.com/product/integration · https://www.gigapay.com/product/compliance
- Gigapay svenska payouts — https://www.gigapay.com/legal/swedish-payouts
- Gigapay pris — https://www.gigapay.com/pricing · https://support.gigapay.se/en/articles/5973368-what-does-it-cost-to-use-gigapay
- Gigapay BankID — https://support.gigapay.com/en/articles/12689162-what-is-bankid-sweden-only
- Laravel-wrapper — https://github.com/mazimez/laravel-gigapay
- Skatteverket egenanställning — https://www.skatteverket.se/privat/skatter/arbeteochinkomst/inkomster/egenanstallning.4.4a47257e143e26725ae2b73.html
- Skatteverket arbetsgivaravgifter — https://www.skatteverket.se/foretag/arbetsgivare/arbetsgivaravgifterochskatteavdrag/arbetsgivaravgifter.4.233f91f71260075abe8800020817.html
- Skatteverket DAC7 — https://www.skatteverket.se/omoss/digitalasamarbeten/utvecklingavflertekniskalosningar/plattformsekonomiochdac7.4.7c708f0e16bed42cd0555d5.html
- Frilans Finans om oss — https://www.frilansfinans.se/en/om-frilans-finans/
- Frilans Finans försäkringar — https://www.frilansfinans.se/arbetsmiljo-och-forsakringar/
- Frilans Finans API-klient (open source) — https://github.com/buren/frilans_finans_api
- Invoicery Business — https://www.invoicerybusiness.se/en
- Cool Company egenanställd — https://coolcompany.com/se/resurser/ekonomi/lon/anstallning/egenanstalld/
- Första kollektivavtalet egenanställda — https://arbetet.se/2021/08/18/forsta-kollektivavtalet-for-egenanstallda-klart-paverkar-gigbranschen/
- Lag (2010:751) om betaltjänster — https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-2010751-om-betaltjanster_sfs-2010-751/
