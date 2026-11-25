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
import SwishPending, { getSwishPendingSubject } from "@/components/emails/SwishPending";
import BookingReminder, { getBookingReminderSubject } from "@/components/emails/BookingReminder";
import CreatorEventAnnouncement, { getCreatorEventSubject } from "@/components/emails/CreatorEventAnnouncement";
import SubscriptionWelcome, { getSubscriptionWelcomeSubject } from "@/components/emails/SubscriptionWelcome";
import NewMessage, { getNewMessageSubject } from "@/components/emails/NewMessage";
import PayoutConfirmation, { getPayoutSubject } from "@/components/emails/PayoutConfirmation";
import SettlementStatement, { getSettlementStatementSubject } from "@/components/emails/SettlementStatement";
import VenueTeamInvite, { getVenueTeamInviteSubject } from "@/components/emails/VenueTeamInvite";
import { WithdrawalReceipt, WithdrawalSellerNotice, getWithdrawalReceiptSubject, getWithdrawalSellerSubject } from "@/components/emails/Withdrawal";
import { VENUE_CAPABILITIES } from "@/lib/venues/members";
import { buildMonthlyStatement } from "@/lib/settlements/monthly-statement";

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
      seller: { name: "Usha AB", orgNumber: "559401-8326", vatNote: "Moms ingår" },
      amountOre: 20000, t, locale,
    }),
    BookingCancellation: createElement(BookingCancellation, {
      recipientName: "Pau", serviceName: "Salsa 101", scheduledAt: WHEN, t, locale,
    }),
    SwishPending: createElement(SwishPending, {
      customerName: "Pau", serviceName: "Salsa 101", scheduledAt: WHEN, amountSek: 130,
      swishNumber: "123 711 11 80", swishMessage: "The Lab 11/12",
      swishUrl: "https://app.swish.nu/1/p/sw/?sw=1237111180&amt=130.00&msg=The%20Lab", bookingId: "b-1", t, locale,
    }),
    BookingReminder: createElement(BookingReminder, {
      customerName: "Pau", serviceName: "Salsa 101", scheduledAt: WHEN,
      creatorName: "Joy Nation", location: "Hornsberg", variant: "day" as const, t, locale,
    }),
    CreatorEventAnnouncement: createElement(CreatorEventAnnouncement, {
      followerName: "Pau", creatorName: "Joy Nation", eventTitle: "Sparkle Day Party",
      eventDate: WHEN, location: "Hornsberg", eventUrl: "https://usha.se/listing/1", t, locale,
    }),
    SubscriptionWelcome: createElement(SubscriptionWelcome, {
      memberName: "Pau", planName: "Guld", expiryDate: WHEN, t, locale,
      // Förmånerna kommer utifrån i skarp drift; fixturen ger dem på svenska
      // eftersom mallen aldrig översätter dem själv.
      benefits: ["Upp till 15 aktiva event eller tjänster"],
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
    SettlementStatement: createElement(SettlementStatement, {
      partnerName: "Joy Nation", t, locale,
      statement: buildMonthlyStatement("2026-10", [
        { listingId: "l1", eventDate: "2026-10-01", title: "The Lab", tickets: 10, grossOre: 184000, refundedOre: 0,
          vatOre: 36800, basisOre: 147200, vatRate: 0.25, partnerPercent: 50, amountOre: 73600, status: "paid",
          paidAt: "2026-10-03T05:00:00Z", transferId: "tr_a" },
        { listingId: "l2", eventDate: "2026-10-29", title: "The Lab", tickets: 5, grossOre: 50000, refundedOre: 0,
          vatOre: 10000, basisOre: 40000, vatRate: 0.25, partnerPercent: 50, amountOre: 20000, status: "dry_run",
          paidAt: null, transferId: null },
      ], [
        { listingId: "l0", eventDate: "2026-09-29", title: "Zouk", seq: 1, amountOre: 8000, dueOre: 40000, grossOre: 0,
          refundedOre: 0, vatOre: 0, basisOre: 0, status: "paid", paidAt: "2026-10-05T08:00:00Z", transferId: "tr_k" },
      ]),
    }),
    VenueTeamInvite: createElement(VenueTeamInvite, {
      venueName: "Joy Nation", recipientName: "Pau",
      capabilities: ["events", "bookings", "scan"], token: "tok_abc", t,
    }),
    WithdrawalReceipt: createElement(WithdrawalReceipt, {
      recipientName: "Pau", serviceName: "Salsa 101", bookingCode: "USH-1A2B3C4D", receivedAt: WHEN,
      refundOre: 65000, refundMethod: "stripe" as const, refundDueAt: END, t, locale,
    }),
    WithdrawalReceiptManual: createElement(WithdrawalReceipt, {
      recipientName: "Pau", serviceName: "Salsa 101", bookingCode: "USH-1A2B3C4D", receivedAt: WHEN,
      refundOre: 65000, refundMethod: "manual" as const, paymentMethodLabel: "Swish", refundDueAt: END, t, locale,
    }),
    WithdrawalSellerNotice: createElement(WithdrawalSellerNotice, {
      recipientName: "Joy", buyerName: "Pau", serviceName: "Salsa 101", bookingCode: "USH-1A2B3C4D", receivedAt: WHEN,
      refundOre: 65000, refundMethod: "manual" as const, paymentMethodLabel: "Swish", refundDueAt: END, t, locale,
    }),
    VenueTeamInviteNoCaps: createElement(VenueTeamInvite, {
      venueName: "Joy Nation", recipientName: null, capabilities: [], token: "tok_abc", t,
    }),
  };
}

describe("venue team invite", () => {
  for (const locale of LOCALES) {
    const t = translatorFor(locale);
    it(`${locale}: lists every chosen capability, the money note and the join link`, () => {
      const html = renderToStaticMarkup(templates(t, locale).VenueTeamInvite);
      expect(html).toContain("/app/venue-team/join/tok_abc");
      for (const c of ["events", "bookings", "scan"]) {
        expect(html).toContain(t(`venueTeamInvite.caps.${c}`).replace(/'/g, "&#x27;"));
      }
      // Ekonomin delas aldrig ut — det ska stå innan personen tackar ja.
      expect(html).toContain("Stripe");
      expect(html).not.toContain(t("venueTeamInvite.caps.messages"));
    });

    it(`${locale}: has a translation for every capability that exists`, () => {
      // En sjunde behörighet utan text skulle synas som en nyckel i mejlet.
      for (const c of VENUE_CAPABILITIES) {
        expect(t(`venueTeamInvite.caps.${c}`)).not.toContain("venueTeamInvite");
      }
    });
  }
});

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
        getSwishPendingSubject(t, "Salsa 101", 130),
        getBookingReminderSubject(t, "Salsa 101", "soon"),
        getBookingReminderSubject(t, "Salsa 101", "day"),
        getCreatorEventSubject(t, "Joy", "Sparkle"),
        getSubscriptionWelcomeSubject(t, "Guld"),
        getNewMessageSubject(t, "Joy"),
        getPayoutSubject(t, "batch", 1234),
        getPayoutSubject(t, "instant", 1234),
        getSettlementStatementSubject(t, "Joy Nation", "2026-10", "sv"),
        getVenueTeamInviteSubject(t, "Bacchi Syre"),
        getWithdrawalReceiptSubject(t, "Salsa 101"),
        getWithdrawalSellerSubject(t, "Salsa 101"),
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

describe("withdrawal receipt", () => {
  for (const locale of LOCALES) {
    it(`${locale}: says when the notice was received, the amount and the booking code`, () => {
      const t = translatorFor(locale);
      const html = renderToStaticMarkup(templates(t, locale).WithdrawalReceipt);
      // Mottagningsbeviset ska visa tidpunkten (10 a §): 18:00 svensk tid.
      expect(html).toContain("18:00");
      expect(html).toContain("650");
      expect(html).toContain("USH-1A2B3C4D");
      expect(html).toContain("support@usha.se");
    });
  }
});
