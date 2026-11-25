import { describe, it, expect } from "vitest";
import sv from "@/i18n/messages/sv.json";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// /for-platser visar FAQ_COUNT = 6 frågor. Saknas en fråga på ett språk visar
// next-intl nyckeln i stället för texten.
const FAQ_COUNT = 6;

describe("/for-platser texter", () => {
  for (const [lang, m] of Object.entries({ sv, en, es })) {
    const fv = (m as any).forVenues;
    it(`${lang}: alla ${FAQ_COUNT} frågor har fråga och svar`, () => {
      for (let n = 1; n <= FAQ_COUNT; n++) {
        expect(fv.faq[`q${n}`], `q${n}`).toBeTruthy();
        expect(fv.faq[`a${n}`], `a${n}`).toBeTruthy();
      }
    });
  }

  it("sv: en enda version av kostnaden", () => {
    const fv = (sv as any).forVenues;
    expect(fv.cost.fee).toContain("3,5 % + 3,50 kr");
    expect(fv.faq.a1).toContain("3,5 % + 3,50 kr");
    const all = JSON.stringify(fv);
    expect(all).not.toMatch(/sätter villkoren|väljer modell|8 %/);
  });

  it("sv: utbetalningen beskrivs som Pablo formulerat den", () => {
    const fv = (sv as any).forVenues;
    expect(fv.faq.a4).toContain("Pengarna förs över dagen efter kvällen och brukar finnas på kontot inom ett par dagar.");
  });

  // Pablos beslut 2026-11-25: kontaktadressen för lokaler och guiden är
  // support@usha.se (alias till Pablos inkorg), inte hans personliga adress.
  it("kontaktadressen är support@usha.se på /for-platser, i /guide och i lokalens prisrad", () => {
    const page = readFileSync(join(__dirname, "..", "page.tsx"), "utf8");
    expect(page).toContain('CONTACT_EMAIL = "support@usha.se"');
    expect(page).not.toContain("pablo.acosta@");
    for (const m of [sv, en, es] as any[]) {
      expect(m.guide.help.body).toContain("support@usha.se");
      expect(m.billing.noPlansVenue).toContain("support@usha.se");
      expect(JSON.stringify(m.guide) + m.billing.noPlansVenue + JSON.stringify(m.forVenues)).not.toContain("pablo.acosta@");
    }
  });
});
