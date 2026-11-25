import { describe, it, expect, vi } from "vitest";
import { readCommerceConfig, getCommerceConfig, type SwishCommerceConfig } from "../config";
import { createSwishClient, oreToSwishAmount, swishAmountToOre, SwishApiError, type SwishTransport } from "../client";
import { swishAppUrl } from "..";

/**
 * Flaggan och miljövariablerna: av som standard, av när något saknas, och
 * rätt Swish-värd för test respektive prod. Klienten mot en fejkad transport.
 */

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
const KEY = "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----";
const base = { SWISH_COMMERCE_ENABLED: "true", SWISH_PAYEE_ALIAS: "123 467 93 04", SWISH_CERT_PEM: PEM, SWISH_KEY_PEM: KEY };

describe("readCommerceConfig", () => {
  it("av när flaggan saknas — Swish Företag gäller", () => {
    expect(readCommerceConfig({})).toEqual({ problem: "disabled" });
    expect(readCommerceConfig({ ...base, SWISH_COMMERCE_ENABLED: "false" })).toEqual({ problem: "disabled" });
    expect(getCommerceConfig({ ...base, SWISH_COMMERCE_ENABLED: "1" })).toBeNull();
  });
  it("av när numret eller certifikatet saknas", () => {
    expect(readCommerceConfig({ ...base, SWISH_PAYEE_ALIAS: "0701234567" })).toEqual({ problem: "SWISH_PAYEE_ALIAS" });
    expect(readCommerceConfig({ ...base, SWISH_KEY_PEM: "" })).toEqual({ problem: "SWISH_CERT_PEM/SWISH_KEY_PEM eller SWISH_P12_BASE64" });
    expect(readCommerceConfig({ ...base, SWISH_COMMERCE_ENV: "staging" })).toEqual({ problem: "SWISH_COMMERCE_ENV" });
  });
  it("test som standard → MSS; prod → cpc.getswish.net", () => {
    const t = readCommerceConfig(base);
    expect("config" in t && t.config).toMatchObject({ env: "test", baseUrl: "https://mss.cpc.getswish.net", payeeAlias: "1234679304" });
    const p = readCommerceConfig({ ...base, SWISH_COMMERCE_ENV: "prod" });
    expect("config" in p && p.config.baseUrl).toBe("https://cpc.getswish.net");
  });
  it("PEM som base64 och \\n-rader fungerar; p12 som alternativ", () => {
    const r = readCommerceConfig({ ...base, SWISH_CERT_PEM: Buffer.from(PEM).toString("base64"), SWISH_KEY_PEM: KEY.replace(/\n/g, "\\n") });
    expect("config" in r && r.config.tls).toMatchObject({ cert: PEM, key: KEY });
    const p12 = readCommerceConfig({ ...base, SWISH_CERT_PEM: "", SWISH_KEY_PEM: "", SWISH_P12_BASE64: Buffer.from("p12").toString("base64"), SWISH_P12_PASSPHRASE: "swish" });
    expect("config" in p12 && p12.config.tls.passphrase).toBe("swish");
  });
  it("callbackUrl från SWISH_CALLBACK_BASE_URL, annars sajten", () => {
    const a = readCommerceConfig({ ...base, SWISH_CALLBACK_BASE_URL: "https://preview.example/" });
    expect("config" in a && a.config.callbackUrl).toBe("https://preview.example/api/swish/commerce/callback");
    const b = readCommerceConfig(base);
    expect("config" in b && b.config.callbackUrl).toMatch(/\/api\/swish\/commerce\/callback$/);
  });
});

describe("belopp", () => {
  it("öre ↔ Swish", () => {
    expect(oreToSwishAmount(13000)).toBe("130.00");
    expect(oreToSwishAmount(12950)).toBe("129.50");
    expect(swishAmountToOre("130.00")).toBe(13000);
    expect(swishAmountToOre(129.5)).toBe(12950);
    expect(Number.isNaN(swishAmountToOre("abc"))).toBe(true);
  });
});

describe("createSwishClient", () => {
  const cfg: SwishCommerceConfig = {
    env: "test",
    baseUrl: "https://mss.cpc.getswish.net",
    qrUrl: "https://mpc.getswish.net/qrg-swish/api/v1/commerce",
    payeeAlias: "1234679304",
    callbackUrl: "https://usha.se/api/swish/commerce/callback",
    tls: {},
  };

  it("PUT v2 med rätt kropp, token ur headern", async () => {
    const transport = vi.fn<SwishTransport>(async () => ({ status: 201, headers: { paymentrequesttoken: "tok", location: "loc" }, body: Buffer.alloc(0) }));
    const c = createSwishClient(cfg, transport);
    const r = await c.create({ instructionId: "A".repeat(32), amountOre: 13000, message: "The Lab 26-11 ref X", payeePaymentReference: "abc", callbackIdentifier: "B".repeat(32) });
    expect(r).toEqual({ token: "tok", location: "loc" });
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe(`https://mss.cpc.getswish.net/swish-cpcapi/api/v2/paymentrequests/${"A".repeat(32)}`);
    expect(init).toMatchObject({ method: "PUT", tls: true });
    expect(JSON.parse(init.body!)).toEqual({
      payeePaymentReference: "abc",
      callbackUrl: cfg.callbackUrl,
      payeeAlias: "1234679304",
      amount: "130.00",
      currency: "SEK",
      message: "The Lab 26-11 ref X",
      callbackIdentifier: "B".repeat(32),
    });
  });

  it("422 blir SwishApiError med Swishs koder", async () => {
    const transport: SwishTransport = async () => ({ status: 422, headers: {}, body: Buffer.from('[{"errorCode":"RP02","errorMessage":"Wrong formatted message"}]') });
    const err = await createSwishClient(cfg, transport).create({ instructionId: "A".repeat(32), amountOre: 100, message: "x", payeePaymentReference: "a", callbackIdentifier: "B".repeat(32) }).catch((e) => e);
    expect(err).toBeInstanceOf(SwishApiError);
    expect(err.codes).toEqual(["RP02"]);
  });

  it("GET går mot v1 (v2 har ingen GET); 404 → null", async () => {
    const transport = vi.fn<SwishTransport>(async () => ({ status: 200, headers: {}, body: Buffer.from('{"id":"X","status":"PAID","amount":130,"currency":"SEK","payeeAlias":"1234679304"}') }));
    const r = await createSwishClient(cfg, transport).get("X");
    expect(transport.mock.calls[0][0]).toBe("https://mss.cpc.getswish.net/swish-cpcapi/api/v1/paymentrequests/X");
    expect(r?.status).toBe("PAID");
    const none = await createSwishClient(cfg, async () => ({ status: 404, headers: {}, body: Buffer.alloc(0) })).get("X");
    expect(none).toBeNull();
  });

  it("QR utan klientcertifikat", async () => {
    const transport = vi.fn<SwishTransport>(async () => ({ status: 200, headers: {}, body: Buffer.from("png") }));
    await createSwishClient(cfg, transport).qr("tok");
    expect(transport.mock.calls[0][1].tls).toBe(false);
    expect(JSON.parse(transport.mock.calls[0][1].body!)).toMatchObject({ token: "tok", format: "png" });
  });
});

describe("swishAppUrl", () => {
  it("token och URL-kodad återkomstadress", () => {
    expect(swishAppUrl("tok", "https://usha.se/biljett/1")).toBe("swish://paymentrequest?token=tok&callbackurl=https%3A%2F%2Fusha.se%2Fbiljett%2F1");
  });
});
