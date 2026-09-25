# Usch-Ja! — In-app-guidning: UX, flöden & beslut-tree

> Hur guidningen vävs in i appen och **vilken guidning som visas för vem, när**. Copy finns i [usha-inapp-guidning-copy.md](./usha-inapp-guidning-copy.md).

---

## Designprinciper

1. **Just-in-time, inte allt-på-en-gång.** Visa rätt guidning vid rätt moment (onboarding, första utbetalning, januari) — inte en vägg av skatteinfo i förväg.
2. **Blockera aldrig pengar i onödan.** Guidning är vägledande. Det enda hårda stoppet är **F-skattegrinden** för näringsutbetalning (regulatoriskt krav), och obligatoriska DAC7-fält.
3. **Spara progress.** "Jag fixar detta senare" tillåts — men flaggas tills klart.
4. **Status, inte besked.** Appen ger indikationer ("troligen näring"), aldrig bindande skattebesked. Disclaimer alltid synlig.
5. **En datapunkt, många vyer.** `creator_tax_profile` driver onboarding, quiz-resultat, YTD, januari-påminnelse och DAC7-vyn.

---

## Datamodell (föreslagen)

```
creator_tax_profile
  user_id
  business_type           enum: undecided | hobby | sole_trader | company
  org_or_personal_nr      (krävs för DAC7 + F-skattekoll)
  f_tax_status            enum: unknown | approved | not_approved   // verifieras mot Skatteverket
  f_tax_verified_at       timestamp
  vat_registered          bool
  self_assessment_result  enum: hobby | business | borderline | null
  onboarding_completed_at timestamp
  first_payout_ack_at     timestamp   // kvittens på "utbetalning, inte lön"

venue_tax_profile
  venue_id
  company_form            enum: ab | sole_trader | association | other
  org_nr
  vat_registered          bool
  takes_onsite_payment    bool        // styr kassaregister-guidning
  onsite_payment_yearly   enum: under_4pbb | over_4pbb | unknown

dac7_report_row (per säljare, per år)
  seller_id, tin, account_ref, consideration_by_quarter[], fees
```

---

## Beslut-tree: vilken kreatör-guidning visas?

```
Kreatör registrerar sig
        │
        ▼
[B1.1 Onboarding "Innan din första utbetalning"]
        │
        ├─ business_type = undecided?  ──► uppmana [B1.3.1 Självskattning]
        │
        ▼
 Självskattning (frivillig men nudgad)
        │
        ├─ result = hobby      ──► visa hobby-spår (T2, egenavgifter). Ingen F-skattegrind.
        ├─ result = business   ──► visa närings-spår. KRÄV F-skatt före näringsutbetalning.
        └─ result = borderline ──► visa [B3.3 "kontakta din revisor"-kort]
        │
        ▼
 Kreatör matchas & får uppdrag
        │
        ▼
 Utbetalning initieras
        │
        ├─ business_type ∈ {sole_trader, company} OCH f_tax_status ≠ approved?
        │        └─► ⛔ HÅRD GRIND: blockera utbetalning som näringsinkomst.
        │             Visa: "Vi behöver verifiera din F-skatt först." → ansök/verifiera.
        │             (Alternativ: betala ut först när F-skatt verifierad, eller led till egenanställning.)
        │
        ├─ business_type = hobby?  ──► tillåt utbetalning, ingen F-skattegrind.
        │
        ▼
 first_payout_ack_at = null?
        └─► [B1.2 Pop-up "utbetalning, inte lön"] med tvingande kryssruta
                │
                ▼
        Utbetalning genomförs (via Stripe Connect → connected account)
                │
                ▼
        Uppdatera YTD-summa [B1.3.2]
```

### F-skattegrind — beslutsregel (regulatoriskt)
```
om utbetalning avser ARBETE (näringsinkomst):
    om f_tax_status = approved (verifierad)        → betala ut, inget skatteavdrag
    annars                                          → BLOCKERA + guida till F-skatt (eller egenanställning)
om inkomst = hobby:
    → betala ut (kreatören redovisar T2 + egenavgifter själv)
```
*Motiv: betalning för arbete till någon utan F-skatt kan göra utbetalaren skyldig för skatteavdrag + arbetsgivaravgifter. Grinden skyddar både Usha och venue.*

---

## Beslut-tree: vilken venue-guidning visas?

```
Venue registrerar sig
        │
        ▼
[B2.1 Onboarding AB/enskild firma]  → company_form, org_nr, vat_registered
        │
        ▼
[B2.2 Hur Usha-intäkter bokförs]  (alltid, kort)
        │
        ▼
[B2.3 Moms per event-typ]
        └─ filtrera tabellen efter venuens event-kategorier (visa relevanta rader överst)
        │
        ▼
 Kassaregister-koll: "Tar ni betalt kontant/kort/Swish på plats?"
        ├─ nej (bara faktura/plattform)        ──► [B2.4] GRÖNT: troligen inget krav
        ├─ ja, < 4 pbb/år                       ──► [B2.4] GULT: kanske, håll koll
        └─ ja, ≥ 4 pbb/år                        ──► [B2.4] RÖTT: troligt krav på kassaregister
        │
        ▼
 Vid bokning av kreatör  ──► [B2.5 F-skattekoll-info: "vi kollar åt dig"]
```

---

## Tidslinje / triggers

| När | Trigger | Visas | Typ |
|---|---|---|---|
| Kreatör-signup | konto skapat | B1.1 Onboarding | Modal-flöde |
| Efter onboarding | business_type = undecided | Nudge → B1.3.1 quiz | Banner |
| Första utbetalningen | first_payout_ack_at = null | B1.2 Pop-up "inte lön" | Blockerande modal |
| Näringsutbetalning utan F-skatt | f_tax_status ≠ approved | F-skattegrind | Hård grind |
| Löpande | varje utbetalning | YTD uppdateras | Passiv |
| YTD ≥ 100 000 kr | tröskel | Momsgräns-notis | Banner |
| 2–7 jan | datum | Januari-påminnelse | Push + banner |
| jan–apr | deklarationsperiod | Deklarations-banner + underlag | Banner |
| När som helst | användaren öppnar | B1.3 Skatt & deklaration (inkl. DAC7-vy) | Statisk sektion |
| Venue-signup | konto skapat | B2.1–B2.4 | Modal-flöde |
| Venue bokar kreatör | bokning | B2.5 F-skattekoll-info | Inline |

---

## Placering i appen

- **Kreatör:** Onboarding-wizard vid signup → därefter permanent sektion **Profil → Skatt & deklaration** (quiz, YTD, DAC7, FAQ-länk). Pop-up + grind triggas i utbetalningsflödet.
- **Venue:** Onboarding-wizard vid signup → permanent sektion **Venue-inställningar → Ekonomi & skatt** (bokföring, moms, kassaregister, bokföringsunderlag).
- **Gemensamt:** **Hjälp/FAQ → Skatt** (B3.1). Disclaimer-fot (B3.2 kort) renderas av en delad komponent på alla skatteskärmar. "Kontakta din revisor"-CTA (B3.3) återanvänds vid gränsfall.

---

## Komponenter att bygga (skiss)

| Komponent | Återanvänds i |
|---|---|
| `<TaxDisclaimerFooter variant="short|long">` | alla skatteskärmar |
| `<HobbyBusinessQuiz>` → skriver `self_assessment_result` | B1.3.1 |
| `<YtdPayoutCard year>` + export | B1.3.2, januari-banner |
| `<Dac7TransparencyPanel>` | B1.3.4 |
| `<FirstPayoutAckModal>` (blockerande) | B1.2 |
| `<FTaxGate>` (blockerar näringsutbetalning) | utbetalningsflöde |
| `<VatRateTable filterBy={categories}>` | B2.3 |
| `<CashRegisterChecker>` (grön/gul/röd) | B2.4 |
| `<TalkToAccountantCTA>` | B3.3, quiz-borderline |

---

## Edge cases & regler

- **business_type = company (AB):** hoppa över hobby/näring-quiz; utbetalning går till bolaget; F-skattegrind gäller bolagets F-skatt.
- **Utländsk kreatör:** samla TIN + hemviststat (DAC7 kräver det); visa förenklad guidning + "kontakta revisor".
- **"Senare"-flöde:** tillåt att skjuta upp onboarding-block, men flagga i profilen + banner tills ifyllt; DAC7-obligatoriska fält och F-skattegrind kan dock inte hoppas över när de utlöses.
- **Belopp/gränser:** läs från en config (`tax_constants_2026`) så de uppdateras utan deploy — egenavgift 28,97 %, momsgräns 120 000 kr, 4 pbb = 236 800 kr, momssatser.
- **Aldrig** ordet "lön" i kreatör-utbetalningsflödet; aldrig "Usha säljer/anställer".
