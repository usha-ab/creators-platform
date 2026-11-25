import { describe, it, expect } from "vitest";
import {
  MIN_PAID_TICKET_PRICE_SEK,
  MIN_PRICE_ERROR_CODE,
  eventPricesAllowed,
  isAllowedPriceChange,
  isAllowedTicketPrice,
  minPriceError,
} from "../min-price";
import { platformCommissionOre } from "../commission";

describe("lägsta biljettpris", () => {
  it("gränsen är 50 kr", () => {
    expect(MIN_PAID_TICKET_PRICE_SEK).toBe(50);
  });

  it("0 ok, 49 nej, 50 ok", () => {
    expect(isAllowedTicketPrice(0)).toBe(true);
    expect(isAllowedTicketPrice(49)).toBe(false);
    expect(isAllowedTicketPrice(50)).toBe(true);
  });

  it("tomt pris räknas som gratis, negativt och ogiltigt nekas", () => {
    expect(isAllowedTicketPrice(null)).toBe(true);
    expect(isAllowedTicketPrice(undefined)).toBe(true);
    expect(isAllowedTicketPrice(1)).toBe(false);
    expect(isAllowedTicketPrice(49.99)).toBe(false);
    expect(isAllowedTicketPrice(-10)).toBe(false);
    expect(isAllowedTicketPrice(Number.NaN)).toBe(false);
    expect(isAllowedTicketPrice(450)).toBe(true);
  });

  it("vid gränsen går kreatörens del aldrig back (provision + Stripe)", () => {
    const ore = MIN_PAID_TICKET_PRICE_SEK * 100;
    const stripeOre = Math.round(ore * 0.015) + 180;
    expect(ore - platformCommissionOre(ore, 1) - stripeOre).toBeGreaterThan(0);
  });

  it("ett oförändrat pris från före regeln får stå kvar, ett ändrat måste följa den", () => {
    expect(isAllowedPriceChange(30, 30)).toBe(true);
    expect(isAllowedPriceChange(40, 30)).toBe(false);
    expect(isAllowedPriceChange(30, null)).toBe(false);
    expect(isAllowedPriceChange(60, 30)).toBe(true);
    expect(isAllowedPriceChange(0, 30)).toBe(true);
  });

  it("felet bär en kod så formuläret kan översätta det", () => {
    expect(minPriceError()).toEqual({ error: expect.stringContaining("50 kr"), code: MIN_PRICE_ERROR_CODE });
  });
});

describe("eventPricesAllowed", () => {
  it("nytt evenemang: pris, förköpspris och varje biljettyp prövas", () => {
    expect(eventPricesAllowed({ price: 150 })).toBe(true);
    expect(eventPricesAllowed({ price: 0 })).toBe(true);
    expect(eventPricesAllowed({ price: 49 })).toBe(false);
    expect(eventPricesAllowed({ price: 150, earlyBirdPrice: 30 })).toBe(false);
    expect(eventPricesAllowed({ price: 150, earlyBirdPrice: 0 })).toBe(true);
    expect(
      eventPricesAllowed({ price: null, ticketTypes: [{ price: 150 }, { price: 0 }] })
    ).toBe(true);
    expect(
      eventPricesAllowed({ price: null, ticketTypes: [{ price: 150 }, { price: 20 }] })
    ).toBe(false);
  });

  it("med biljettyper är det typerna som gäller, inte det tomma prisfältet", () => {
    // Prisfältet är avstängt i formuläret när det finns typer och skickas inte.
    expect(eventPricesAllowed({ price: null, ticketTypes: [{ price: 50 }] })).toBe(true);
  });

  it("redigering: befintliga priser under gränsen får stå kvar, nya typer prövas", () => {
    const prev = { price: 30, earlyBirdPrice: 20, ticketTypes: [{ id: "a", price: 30 }] };
    expect(eventPricesAllowed({ price: 30, earlyBirdPrice: 20 }, prev)).toBe(true);
    expect(eventPricesAllowed({ price: 35 }, prev)).toBe(false);
    expect(eventPricesAllowed({ price: null, ticketTypes: [{ id: "a", price: 30 }] }, prev)).toBe(true);
    expect(eventPricesAllowed({ price: null, ticketTypes: [{ id: "a", price: 25 }] }, prev)).toBe(false);
    // En ny typ (utan id) kan inte låna den gamla typens undantag.
    expect(eventPricesAllowed({ price: null, ticketTypes: [{ price: 30 }] }, prev)).toBe(false);
    expect(
      eventPricesAllowed({ price: null, ticketTypes: [{ id: "a", price: 30 }, { price: 40 }] }, prev)
    ).toBe(false);
  });
});
