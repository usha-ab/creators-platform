import { request as httpsRequest, Agent } from "node:https";
import type { SwishCommerceConfig } from "./config";

/**
 * Swish Commerce API över mTLS (klientcertifikat). Tre anrop:
 *   PUT  /swish-cpcapi/api/v2/paymentrequests/{instructionUUID}  skapa
 *   GET  /swish-cpcapi/api/v1/paymentrequests/{id}               hämta (v2 har ingen GET, MSS svarar 405)
 *   POST mpc.getswish.net/qrg-swish/api/v1/commerce              QR-bild för en token (inget certifikat)
 *
 * Inga certifikat, nycklar eller tokens skrivs till loggen.
 */

export type SwishStatus = "CREATED" | "PAID" | "DECLINED" | "ERROR" | "CANCELLED";

/** Betalningsförfrågan så som Swish returnerar den (GET och callback). */
export interface SwishPaymentRequest {
  id: string;
  payeePaymentReference?: string | null;
  paymentReference?: string | null;
  callbackUrl?: string | null;
  payerAlias?: string | null;
  payeeAlias: string;
  amount: number | string;
  currency: string;
  message?: string | null;
  status: SwishStatus | string;
  dateCreated?: string | null;
  datePaid?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface CreatePaymentRequestInput {
  instructionId: string;
  amountOre: number;
  message: string;
  payeePaymentReference: string;
  callbackIdentifier: string;
}

export class SwishApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly codes: string[],
  ) {
    super(`Swish svarade ${status}${codes.length ? ` (${codes.join(", ")})` : ""}`);
    this.name = "SwishApiError";
  }
}

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

export type SwishTransport = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string; tls: boolean },
) => Promise<RawResponse>;

const agents = new WeakMap<SwishCommerceConfig, Agent>();

function agentFor(cfg: SwishCommerceConfig): Agent {
  let a = agents.get(cfg);
  if (!a) {
    a = new Agent({ ...cfg.tls, keepAlive: true, minVersion: "TLSv1.2" });
    agents.set(cfg, a);
  }
  return a;
}

/** Riktiga nätverksanrop. Byts ut i testerna. */
export function nodeTransport(cfg: SwishCommerceConfig): SwishTransport {
  return (url, init) =>
    new Promise<RawResponse>((resolve, reject) => {
      const req = httpsRequest(
        url,
        { method: init.method, headers: init.headers, agent: init.tls ? agentFor(cfg) : undefined, timeout: 10_000 },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
          res.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new Error("Swish timeout")));
      req.on("error", reject);
      if (init.body) req.write(init.body);
      req.end();
    });
}

function header(h: RawResponse["headers"], name: string): string | null {
  const v = h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

function errorCodes(body: Buffer): string[] {
  try {
    const parsed = JSON.parse(body.toString("utf8"));
    if (Array.isArray(parsed)) return parsed.map((e) => String(e?.errorCode ?? "")).filter(Boolean);
  } catch {
    // tom eller inte JSON
  }
  return [];
}

/** Öre → "130.00", som Swish vill ha beloppet. */
export function oreToSwishAmount(ore: number): string {
  return (Math.round(ore) / 100).toFixed(2);
}

/** "130.00" / 130 → 13000 öre. NaN om det inte är ett belopp. */
export function swishAmountToOre(amount: number | string): number {
  const n = typeof amount === "number" ? amount : Number(String(amount).trim());
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

export interface SwishClient {
  create(input: CreatePaymentRequestInput): Promise<{ token: string | null; location: string | null }>;
  get(id: string): Promise<SwishPaymentRequest | null>;
  qr(token: string): Promise<Buffer>;
}

export function createSwishClient(cfg: SwishCommerceConfig, transport: SwishTransport = nodeTransport(cfg)): SwishClient {
  const base = `${cfg.baseUrl}/swish-cpcapi/api`;
  return {
    async create(input) {
      const body = JSON.stringify({
        payeePaymentReference: input.payeePaymentReference,
        callbackUrl: cfg.callbackUrl,
        payeeAlias: cfg.payeeAlias,
        amount: oreToSwishAmount(input.amountOre),
        currency: "SEK",
        message: input.message,
        callbackIdentifier: input.callbackIdentifier,
      });
      const res = await transport(`${base}/v2/paymentrequests/${input.instructionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) },
        body,
        tls: true,
      });
      if (res.status !== 201) throw new SwishApiError(res.status, errorCodes(res.body));
      return { token: header(res.headers, "PaymentRequestToken"), location: header(res.headers, "Location") };
    },
    async get(id) {
      const res = await transport(`${base}/v1/paymentrequests/${id}`, { method: "GET", headers: { Accept: "application/json" }, tls: true });
      if (res.status === 404) return null;
      if (res.status !== 200) throw new SwishApiError(res.status, errorCodes(res.body));
      return JSON.parse(res.body.toString("utf8")) as SwishPaymentRequest;
    },
    async qr(token) {
      const body = JSON.stringify({ token, format: "png", size: 300, border: 0 });
      const res = await transport(cfg.qrUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) },
        body,
        tls: false,
      });
      if (res.status !== 200) throw new SwishApiError(res.status, []);
      return res.body;
    },
  };
}
