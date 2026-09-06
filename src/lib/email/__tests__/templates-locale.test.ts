import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import type { Translate } from "@/lib/i18n/server";
import type { Locale } from "@/i18n/config";
import { EMAIL_FALLBACK_LOCALE } from "@/lib/i18n/recipient";

import BookingConfirmation, { getBookingConfirmationSubject } from "@/components/emails/BookingConfirmation";
import BookingCancellation, { getBookingCancellationSubject } from "@/components/emails/BookingCancellation";
import BookingReminder, { getBookingReminderSubject } from "@/components/emails/BookingReminder";
import CreatorEventAnnouncement, { getCreatorEventSubject } from "@/components/emails/CreatorEventAnnouncement";
import GoldMemberWelcome, { getGoldWelcomeSubject } from "@/components/emails/GoldMemberWelcome";
import NewMessage, { getNewMessageSubject } from "@/components/emails/NewMessage";
import PayoutConfirmation, { getPayoutSubject } from "@/components/emails/PayoutConfirmation";
import TrialEnding, { getTrialEndingSubject } from "@/components/emails/TrialEnding";
import WelcomeCredit, { getWelcomeCreditSubject } from "@/components/emails/WelcomeCredit";

const LOCALES = ["sv", "en", "es"] as const;
const MESSAGES_DIR = join(process.cwd(), "src/i18n/messages");

function messagesFor(locale: Locale) {
  return JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), "utf8"));
}

/** The translator a real send hands the template. */
function translatorFor(locale: Locale): Translate {
  const messages = messagesFor(locale);
  const t = createTranslator({ locale, messages, namespace: "emails", onError: () => {} });
  const fn = ((key: string, params?: Record<string, string | number>) =>
    t(key as never, params as never) as unknown as string) as Translate;
  fn.has = (key: string) => messages.emails?.[key] != null;
  return fn;
}

// A fixed instant, so the rendered dates are stable across runs and machines.
const WHEN = new Date("2026-09-04T16:00:00Z");
const END = new Date("2026-09-04T19:00:00Z");

/** Every template with the props a real send would give it. */
function templates(t: Translate, locale: Locale) {
  return {
    BookingConfirmation: createElement(BookingConfirmation, {
      customerName: "Pau", serviceName: "Salsa 101", scheduledAt: WHEN, scheduledEndAt: END,
      creatorName: "Joy Nation", location: "Hornsberg", bookingId: "b-1",
      seller: { name: "Usha AB", orgNumber: "559401-8326", vatNote: "Moms ingår" }, t, locale,
    }),
    BookingCancellation: createElement(BookingCancellation, {
      recipientName: "Pau", serviceName: "Salsa 101", scheduledAt: WHEN, t, locale,
    }),
    BookingReminder: createElement(BookingReminder, {
      customerName: "Pau", serviceName: "Salsa 101", scheduledAt: WHEN,
      creatorName: "Joy Nation", location: "Hornsberg", variant: "day" as const, t, locale,
    }),
    CreatorEventAnnouncement: createElement(CreatorEventAnnouncement, {
      followerName: "Pau", creatorName: "Joy Nation", eventTitle: "Sparkle Day Party",
      eventDate: WHEN, location: "Hornsberg", eventUrl: "https://usha.se/listing/1", t, locale,
    }),
    GoldMemberWelcome: createElement(GoldMemberWelcome, {
      memberName: "Pau", expiryDate: WHEN, t, locale,
    }),
    // The preview is the sender's own words and is deliberately never
    // translated, so the fixture keeps it free of any language's marker words.
    NewMessage: createElement(NewMessage, {
      recipientName: "Pau", senderName: "Joy", messagePreview: "ok 👍", t,
    }),
    PayoutConfirmation: createElement(PayoutConfirmation, {
      creatorName: "Pau", amount: 1234, commission: 66, grossAmount: 1300,
      type: "batch" as const, transactionDate: WHEN,
      events: [{ title: "Sparkle", attendees: 12, revenue: 1300 }], t, locale,
    }),
    TrialEnding: createElement(TrialEnding, {
      memberName: "Pau", trialEndDate: WHEN, daysLeft: 3, t, locale,
    }),
    WelcomeCredit: createElement(WelcomeCredit, {
      recipientName: "Pau", amount: 50, minSpend: 150, expiresAt: WHEN, t, locale,
    }),
  };
}

// Words that only exist in one language. If one shows up in another language's
// render, some string was left hardcoded instead of going through a key.
const MARKERS: Record<Locale, RegExp> = {
  sv: /\b(Hej|Datum|Arrangör|Plats|Bokning|provperiod|Utbetalning|Frågor)\b/i,
  en: /\b(Date|Host|Place|Booking|trial|payout|Questions)\b/i,
  es: /\b(Hola|Fecha|Organizador|Lugar|Reserva|prueba|pago|Preguntas)\b/i,
};

describe("email templates render in the reader's language", () => {
  for (const locale of LOCALES) {
    const t = translatorFor(locale);
    for (const [name, element] of Object.entries(templates(t, locale))) {
      it(`${name} in ${locale} has no other language's words`, () => {
        const html = renderToStaticMarkup(element);
        expect(html.length).toBeGreaterThan(200);
        // Never ship an unresolved key or a stray interpolation placeholder.
        expect(html).not.toMatch(/\{[a-zA-Z]+\}/);
        for (const other of LOCALES) {
          if (other === locale) continue;
          const foreign = html.match(MARKERS[other]);
          // Swedish "Plats"/Spanish "pago" style overlaps are avoided by the
          // word lists above being disjoint across the three languages.
          expect(foreign, `${name} (${locale}) contains ${other} text: ${foreign?.[0]}`).toBeNull();
        }
      });
    }
  }

  it("writes every subject line in the reader's language", () => {
    const subjects = (locale: Locale) => {
      const t = translatorFor(locale);
      return [
        getBookingConfirmationSubject(t, "Salsa 101"),
        getBookingCancellationSubject(t, "Salsa 101"),
        getBookingReminderSubject(t, "Salsa 101", "soon"),
        getBookingReminderSubject(t, "Salsa 101", "day"),
        getCreatorEventSubject(t, "Joy", "Sparkle"),
        getGoldWelcomeSubject(t),
        getNewMessageSubject(t, "Joy"),
        getPayoutSubject(t, "batch", 1234),
        getPayoutSubject(t, "instant", 1234),
        getTrialEndingSubject(t, 1),
        getWelcomeCreditSubject(t, 50),
        getTrialEndingSubject(t, 5),
      ];
    };

    const sv = subjects("sv");
    const en = subjects("en");
    const es = subjects("es");

    // Same count, no blanks, no leaked keys, and genuinely different wording.
    for (const list of [sv, en, es]) {
      for (const s of list) {
        expect(s.length).toBeGreaterThan(3);
        expect(s).not.toMatch(/\{[a-zA-Z]+\}/);
      }
    }
    expect(sv).not.toEqual(en);
    expect(en).not.toEqual(es);
    expect(sv[0]).toContain("Salsa 101");
    expect(es[0]).toContain("Salsa 101");
  });

  it("formats dates for the region, never always Swedish", () => {
    const sv = renderToStaticMarkup(templates(translatorFor("sv"), "sv").BookingConfirmation);
    const en = renderToStaticMarkup(templates(translatorFor("en"), "en").BookingConfirmation);
    const es = renderToStaticMarkup(templates(translatorFor("es"), "es").BookingConfirmation);
    expect(sv).toContain("september");
    expect(en).toContain("September");
    expect(es).toContain("septiembre");
    // 16:00 UTC is 18:00 in Stockholm — the timezone must survive translation.
    for (const html of [sv, en, es]) expect(html).toContain("18:00");
  });
});

describe("recipients we know nothing about", () => {
  it("fall back to English, not Swedish", () => {
    // A .se address is not a Swedish reader. Someone who never told us their
    // language gets the app's neutral language, the same as a cookieless visitor.
    expect(EMAIL_FALLBACK_LOCALE).toBe("en");
  });
});

describe("no email template keeps hardcoded prose", () => {
  const DIR = join(process.cwd(), "src/components/emails");

  it("has no Swedish letters left outside the message files", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(DIR).filter((f) => f.endsWith(".tsx"))) {
      const src = readFileSync(join(DIR, file), "utf8");
      // Strip comments, which may legitimately be written in any language.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      for (const m of code.matchAll(/[^\n]*[åäöÅÄÖ][^\n]*/g)) {
        offenders.push(`${file}: ${m[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
