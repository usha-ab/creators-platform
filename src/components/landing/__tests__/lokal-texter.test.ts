import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Texträttelserna från genomgången 2026-11-24 (usha-drift och
 * usha-kommunikation). Varje regel här motsvarar ett ställe där sajten sa en
 * sak och koden en annan.
 */

const DIR = join(process.cwd(), "src/i18n/messages");
const LOCALES = ["sv", "en", "es"] as const;
const msgs = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(join(DIR, `${l}.json`), "utf8"))])
) as Record<(typeof LOCALES)[number], Record<string, unknown>>;

function get(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], root);
}
function all(root: unknown): string {
  const out: string[] = [];
  (function walk(o: unknown) {
    if (typeof o === "string") out.push(o);
    else if (o && typeof o === "object") Object.values(o).forEach(walk);
  })(root);
  return out.join("\n");
}

describe("texterna säger samma sak som koden", () => {
  it("/for-kreatorer nämner inte 8 % (provisionen är 3,5 % + 3,50 kr sedan #586)", () => {
    for (const l of LOCALES) {
      expect(all(get(msgs[l], "forCreators")), l).not.toMatch(/\b8\s?%/);
    }
    expect(get(msgs.sv, "forCreators.hero.sub")).toContain("3,5 % + 3,50 kr");
  });

  it("vitmärkningen bär inget Premium-märke", () => {
    for (const l of LOCALES) expect(get(msgs[l], "dashProfile.form.whitelabelBadge"), l).toBeUndefined();
  });

  it("rollbyte pekar på Inställningar → Konto, inte Prenumeration", () => {
    const sv = msgs.sv;
    for (const k of ["roleToggle.lockedHint", "guide.s1.roleNote", "guide.faq.a3"]) {
      expect(get(sv, k), k).toContain("Inställningar → Konto");
    }
    expect(all(sv)).not.toMatch(/Prenumeration → Byt roll|Gå till Prenumeration för att byta roll/);
  });

  it("guiden lovar ingen gratisplan med tak", () => {
    for (const l of LOCALES) {
      expect(get(msgs[l], "guide.creators.servicesBody"), l).not.toMatch(/gratisplanen|free plan|plan gratuito/i);
    }
  });

  it("lokalens BankID kallas inte valfritt", () => {
    expect(get(msgs.sv, "onboarding.verifyBankidOptional")).not.toMatch(/valfritt/);
    expect(get(msgs.sv, "landing.trust.bankid.desc")).not.toMatch(/^Alla/);
  });

  it("utbetalningen beskrivs på ett enda sätt", () => {
    const mening = "förs över dagen efter kvällen och brukar finnas på kontot inom ett par dagar";
    for (const k of ["landing.faq.a3", "guide.money.payoutBody", "landing.pricing.upplevelseFree3", "payouts.nextPayout", "compare.row.payout.usha"]) {
      expect(get(msgs.sv, k), k).toContain(mening);
    }
    expect(all(msgs.sv)).not.toMatch(/första snabbutbetalningen varje månad är avgiftsfri|Fredag 23:00/);
  });

  it("vad en lokal betalar står på ett enda sätt", () => {
    const sv = all(get(msgs.sv, "landing.pricing")) + "\n" + String(get(msgs.sv, "billing.noPlansVenue"));
    expect(sv).not.toMatch(/sätter villkoren|väljer modell|intäktsdelning eller provision/);
    expect(get(msgs.sv, "billing.noPlansVenue")).toContain("3,5 % + 3,50 kr");
    expect(get(msgs.sv, "landing.pricing.footnoteVenue")).toContain("eget avtal med varje lokal");
  });

  it("rollen heter Lokal på svenska", () => {
    for (const k of ["roles.venue", "auth.roleExperience", "appProfile.roleExperience", "landing.pricing.roleExperience"]) {
      expect(get(msgs.sv, k), k).toBe("Lokal");
    }
  });
});
