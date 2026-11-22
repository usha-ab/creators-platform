import { describe, it, expect } from "vitest";
import {
  isPayoutDue,
  payoutBlockedReason,
  isDeferrable,
  decidePayout,
  stockholmToday,
  type PartnerPayoutProfile,
  type PayoutCandidate,
} from "../payout";

const okPartner: PartnerPayoutProfile = {
  id: "p1",
  stripe_account_id: "acct_123",
  company_verified_at: "2026-08-01T00:00:00Z",
  company_form: "aktiebolag",
  org_number: "5566778899",
  // Färsk kontroll i förhållande till klockan när testet körs.
  f_tax_verified_at: new Date(Date.now() - 86_400_000).toISOString(),
  stripe_charges_enabled: true, stripe_payouts_enabled: true,
};

describe("isPayoutDue", () => {
  it("betalar ut dagen efter evenemanget", () => {
    expect(isPayoutDue("2026-09-07", 1, "2026-09-08")).toBe(true);
  });

  it("betalar INTE ut samma dag som evenemanget", () => {
    // Kvällen pågår fortfarande. Att föra över pengar för en kväll som inte är
    // slut är exakt det avtalet säger att vi inte gör.
    expect(isPayoutDue("2026-09-07", 1, "2026-09-07")).toBe(false);
  });

  it("betalar ut även om jobbet missat en dag", () => {
    // Cronjobbet kan ha legat nere. Kvällen ska ändå betalas ut, inte hoppas över.
    expect(isPayoutDue("2026-09-07", 1, "2026-09-20")).toBe(true);
  });

  it("respekterar längre fördröjning", () => {
    expect(isPayoutDue("2026-09-07", 3, "2026-09-09")).toBe(false);
    expect(isPayoutDue("2026-09-07", 3, "2026-09-10")).toBe(true);
  });

  it("klarar månadsskifte", () => {
    expect(isPayoutDue("2026-09-30", 1, "2026-10-01")).toBe(true);
    expect(isPayoutDue("2026-12-31", 1, "2027-01-01")).toBe(true);
  });

  it("klarar skottdag", () => {
    expect(isPayoutDue("2028-02-28", 1, "2028-02-29")).toBe(true);
    expect(isPayoutDue("2028-02-29", 1, "2028-03-01")).toBe(true);
  });

  it("avvisar trasigt datum i stället för att gissa", () => {
    expect(isPayoutDue("", 1, "2026-09-08")).toBe(false);
    expect(isPayoutDue("7 sep", 1, "2026-09-08")).toBe(false);
  });
});

describe("stockholmToday", () => {
  it("ger svensk lokaldag, inte UTC-dag", () => {
    // 22.30 UTC den 7:e är redan den 8:e i Stockholm (sommartid, UTC+2).
    // Utan tidszonen hade kvällen betalats ut ett dygn för sent.
    expect(stockholmToday(new Date("2026-09-07T22:30:00Z"))).toBe("2026-09-08");
    expect(stockholmToday(new Date("2026-09-07T12:00:00Z"))).toBe("2026-09-07");
  });
});

describe("payoutBlockedReason", () => {
  it("släpper igenom en färdig partner", () => {
    expect(payoutBlockedReason(okPartner)).toBeNull();
  });

  it("stoppar partner utan kontrollerad F-skatt", () => {
    expect(payoutBlockedReason({ ...okPartner, f_tax_verified_at: null })).toMatch(/F-skatt/);
  });

  it("stoppar partner med för gammal F-skattekontroll", () => {
    expect(payoutBlockedReason({ ...okPartner, f_tax_verified_at: "2026-01-01T00:00:00Z" }, new Date("2026-11-22T00:00:00Z"))).toMatch(/äldre än/);
  });

  it("stoppar partner utan bolagsform", () => {
    expect(payoutBlockedReason({ ...okPartner, company_form: null })).toMatch(/bolagsform/);
  });

  it("stoppar utländsk partner", () => {
    expect(payoutBlockedReason({ ...okPartner, org_number: "EL123456789" })).toMatch(/utländska/);
  });

  it("kräver inte momsregistrering (VIES)", () => {
    expect(payoutBlockedReason({ ...okPartner, company_verified_at: null })).toBeNull();
  });

  it("förening med F-skatt får avräkning", () => {
    expect(payoutBlockedReason({ ...okPartner, company_form: "forening", company_verified_at: null })).toBeNull();
  });

  it("Ushas eget konto går förbi bolagskraven men inte Stripe-kraven", () => {
    const usha = { id: "15d852ed-1f33-446f-9bcb-821c2444c84f", stripe_account_id: "acct_usha", stripe_charges_enabled: true, stripe_payouts_enabled: true };
    expect(payoutBlockedReason(usha)).toBeNull();
    expect(payoutBlockedReason({ ...usha, stripe_payouts_enabled: false })).toMatch(/betala ut/);
  });

  it("stoppar saknat Stripe-konto", () => {
    expect(payoutBlockedReason({ ...okPartner, stripe_account_id: null })).toMatch(/Stripe-konto/);
  });

  it("stoppar konto som inte kan ta emot", () => {
    expect(payoutBlockedReason({ ...okPartner, stripe_charges_enabled: false, stripe_payouts_enabled: false })).toMatch(/ta emot/);
  });

  it("stoppar saknad partner", () => {
    expect(payoutBlockedReason(null)).toBeTruthy();
  });
});

const candidate = (over: Partial<PayoutCandidate> = {}): PayoutCandidate => ({
  listingId: "l1",
  listingTitle: "Måndagsdans",
  eventDate: "2026-09-07",
  partner: okPartner,
  partnerPercent: 50,
  vatRate: 0.25,
  payoutDelayDays: 1,
  bookings: [
    { status: "confirmed", amount_paid: 12_500, platform_fee_amount: 1_250, refund_amount: null, guest_count: 1 },
  ],
  ...over,
});

describe("decidePayout", () => {
  it("räknar fram partnerns andel", () => {
    // 125 kr inkl moms → 100 kr underlag → 50 kr till partnern.
    const d = decidePayout(candidate());
    expect(d.blocked).toBeNull();
    expect(d.split.partnerOre).toBe(5_000);
  });

  it("räknar INTE av Usha-avgiften före delningen", () => {
    // Avgiften är plattformens egen intäkt. Hade den dragits av först hade
    // partnern betalat halva Ushas provision till Usha.
    const utan = decidePayout(candidate({
      bookings: [{ status: "confirmed", amount_paid: 12_500, platform_fee_amount: 0, refund_amount: null, guest_count: 1 }],
    }));
    const med = decidePayout(candidate());
    expect(med.split.partnerOre).toBe(utan.split.partnerOre);
  });

  it("blockerar när partnern inte får ta emot", () => {
    const d = decidePayout(candidate({ partner: { ...okPartner, f_tax_verified_at: null } }));
    expect(d.blocked).toMatch(/F-skatt/);
  });

  it("blockerar en helt återbetald kväll", () => {
    // Inställt arrangemang: allt återbetalt, ingen andel utgår till någon part.
    const d = decidePayout(candidate({
      bookings: [{ status: "canceled", amount_paid: 12_500, platform_fee_amount: null, refund_amount: 12_500, guest_count: 1 }],
    }));
    expect(d.split.partnerOre).toBe(0);
    expect(d.blocked).toBe("inget att betala ut");
  });

  it("blockerar en kväll utan sålda biljetter", () => {
    const d = decidePayout(candidate({ bookings: [] }));
    expect(d.blocked).toBe("inget att betala ut");
  });

  it("drar av delvis återbetalning innan delningen", () => {
    const d = decidePayout(candidate({
      bookings: [
        { status: "confirmed", amount_paid: 12_500, platform_fee_amount: null, refund_amount: null, guest_count: 1 },
        { status: "canceled", amount_paid: 12_500, platform_fee_amount: null, refund_amount: 12_500, guest_count: 1 },
      ],
    }));
    expect(d.split.partnerOre).toBe(5_000);
  });

  it("nämner orsaken när den blockerar, inte bara att den gjorde det", () => {
    // Skälet hamnar i felkolumnen. "Hoppades över" utan orsak är obrukbart när
    // någon undrar var pengarna tog vägen.
    const d = decidePayout(candidate({ partner: { ...okPartner, stripe_account_id: null } }));
    expect(d.blocked).toBeTruthy();
    expect(d.blocked!.length).toBeGreaterThan(10);
  });
});

describe("isDeferrable", () => {
  it("skjuter upp när pengarna inte blivit tillgängliga ännu", () => {
    // Kortpengar ligger i pending tills avräkningen passerat. Det är en väntan,
    // inte ett fel — och ska inte larma.
    expect(isDeferrable({ code: "balance_insufficient" })).toBe(true);
  });

  it("skjuter inte upp riktiga fel", () => {
    expect(isDeferrable({ code: "account_invalid" })).toBe(false);
    expect(isDeferrable(new Error("nätverket dog"))).toBe(false);
    expect(isDeferrable(null)).toBe(false);
  });
});

// Grinden mot konton som kan TA EMOT men inte BETALA UT. Bacchi Syre hörde av
// sig 8 oktober 2026: sju kvällar och 1 980 kr såg utbetalda ut hos oss, men
// Maria såg ingenting komma in. En Stripe-överföring till ett konto utan
// bankkonto lyckas och markeras betald — pengarna stannar i mottagarens
// Stripe-saldo. Innan det här fanns ingen kontroll alls.
describe("payoutBlockedReason: utbetalning till bank", () => {
  const ok = {
    id: "p1",
    stripe_account_id: "acct_123",
    company_verified_at: "2026-09-01T00:00:00Z",
    company_form: "aktiebolag",
    org_number: "5566778899",
    f_tax_verified_at: new Date(Date.now() - 86_400_000).toISOString(),
    stripe_charges_enabled: true,
    stripe_payouts_enabled: true,
  };

  it("släpper igenom ett konto som både tar emot och betalar ut", () => {
    expect(payoutBlockedReason(ok)).toBeNull();
  });

  it("blockerar när kontot inte kan betala ut", () => {
    expect(payoutBlockedReason({ ...ok, stripe_payouts_enabled: false })).toBe(
      "partnerns Stripe-konto kan inte betala ut till bank ännu"
    );
  });

  it("blockerar när flaggan är osynkad (null) — gissar inte", () => {
    expect(payoutBlockedReason({ ...ok, stripe_payouts_enabled: null })).toBe(
      "partnerns Stripe-konto kan inte betala ut till bank ännu"
    );
  });

  it("tar-emot-grinden vägs före betala-ut-grinden", () => {
    // Ett konto som varken kan ta emot eller betala ut ska få det första
    // skälet, annars pekar felmeddelandet på fel sak att åtgärda.
    expect(
      payoutBlockedReason({ ...ok, stripe_charges_enabled: false, stripe_payouts_enabled: false })
    ).toBe("partnerns Stripe-konto kan inte ta emot ännu");
  });

  it("mottagarkravet (F-skatt) vägs före båda", () => {
    expect(
      payoutBlockedReason({ ...ok, f_tax_verified_at: null, stripe_payouts_enabled: false })
    ).toBe("mottagarens F-skatt är inte kontrollerad");
  });
});
