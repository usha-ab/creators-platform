/**
 * Swish Handel (Swish Commerce API) — konfiguration.
 *
 * Allt ligger bakom SWISH_COMMERCE_ENABLED. Är flaggan av, eller saknas
 * något av det som behövs, returnerar getCommerceConfig() null och sajten
 * kör Swish Företag precis som förut (vilande bokning, entrén bekräftar).
 *
 * Variablerna (sätts i Vercel, aldrig i koden):
 *   SWISH_COMMERCE_ENABLED   "true" slår på. Allt annat = av.
 *   SWISH_COMMERCE_ENV       "test" (MSS, mss.cpc.getswish.net) eller "prod" (cpc.getswish.net). Standard test.
 *   SWISH_PAYEE_ALIAS        Swish Handel-numret, 10 siffror (123…).
 *   SWISH_CERT_PEM           Klientcertifikatet (PEM, eller PEM som base64).
 *   SWISH_KEY_PEM            Certifikatets privata nyckel (PEM, eller base64).
 *   SWISH_P12_BASE64         Alternativ till CERT/KEY: hela .p12-filen som base64.
 *   SWISH_P12_PASSPHRASE     Lösenordet till .p12-filen.
 *   SWISH_CA_PEM             Valfri. Rot-CA för Swish-servern. Krävs för MSS
 *                            (Swish TLS Root CA); i prod räcker Nodes egna
 *                            (DigiCert Global Root G2).
 *   SWISH_CALLBACK_BASE_URL  Valfri. Bas för callbackUrl, standard NEXT_PUBLIC_APP_URL eller https://usha.se.
 *
 * Inga värden loggas. Felmeddelanden nämner bara vilken variabel som saknas.
 */

export type SwishCommerceEnv = "test" | "prod";

export interface SwishTlsMaterial {
  cert?: string;
  key?: string;
  pfx?: Buffer;
  passphrase?: string;
  ca?: string;
}

export interface SwishCommerceConfig {
  env: SwishCommerceEnv;
  baseUrl: string;
  qrUrl: string;
  payeeAlias: string;
  callbackUrl: string;
  tls: SwishTlsMaterial;
}

export const SWISH_BASE_URL: Record<SwishCommerceEnv, string> = {
  test: "https://mss.cpc.getswish.net",
  prod: "https://cpc.getswish.net",
};

/** QR-API:t för en betalningsförfrågans token (dator → mobil). Samma värd för båda miljöerna enligt Swish. */
export const SWISH_QR_URL = "https://mpc.getswish.net/qrg-swish/api/v1/commerce";

type Env = Record<string, string | undefined>;

/** PEM rakt av, eller PEM som base64 (Vercel tycker bättre om en rad). */
function pemOrBase64(v: string | undefined): string | undefined {
  const s = v?.trim();
  if (!s) return undefined;
  if (s.includes("-----BEGIN")) return s.replace(/\\n/g, "\n");
  try {
    const decoded = Buffer.from(s, "base64").toString("utf8");
    return decoded.includes("-----BEGIN") ? decoded : undefined;
  } catch {
    return undefined;
  }
}

export type CommerceConfigProblem =
  | "disabled"
  | "SWISH_PAYEE_ALIAS"
  | "SWISH_CERT_PEM/SWISH_KEY_PEM eller SWISH_P12_BASE64"
  | "SWISH_COMMERCE_ENV";

/** Läser konfigurationen. Returnerar antingen config eller vad som saknas (utan värden). */
export function readCommerceConfig(env: Env = process.env): { config: SwishCommerceConfig } | { problem: CommerceConfigProblem } {
  if ((env.SWISH_COMMERCE_ENABLED ?? "").trim().toLowerCase() !== "true") return { problem: "disabled" };

  const rawEnv = (env.SWISH_COMMERCE_ENV ?? "test").trim().toLowerCase();
  if (rawEnv !== "test" && rawEnv !== "prod") return { problem: "SWISH_COMMERCE_ENV" };
  const which = rawEnv as SwishCommerceEnv;

  const payeeAlias = (env.SWISH_PAYEE_ALIAS ?? "").replace(/\D/g, "");
  if (!/^123\d{7}$/.test(payeeAlias)) return { problem: "SWISH_PAYEE_ALIAS" };

  const tls: SwishTlsMaterial = {};
  const cert = pemOrBase64(env.SWISH_CERT_PEM);
  const key = pemOrBase64(env.SWISH_KEY_PEM);
  const p12 = env.SWISH_P12_BASE64?.trim();
  if (cert && key) {
    tls.cert = cert;
    tls.key = key;
  } else if (p12) {
    tls.pfx = Buffer.from(p12, "base64");
    tls.passphrase = env.SWISH_P12_PASSPHRASE ?? "";
  } else {
    return { problem: "SWISH_CERT_PEM/SWISH_KEY_PEM eller SWISH_P12_BASE64" };
  }
  const ca = pemOrBase64(env.SWISH_CA_PEM);
  if (ca) tls.ca = ca;

  const base = (env.SWISH_CALLBACK_BASE_URL || env.NEXT_PUBLIC_APP_URL || "https://usha.se").trim().replace(/\/+$/, "");
  return {
    config: {
      env: which,
      baseUrl: SWISH_BASE_URL[which],
      qrUrl: SWISH_QR_URL,
      payeeAlias,
      callbackUrl: `${base}/api/swish/commerce/callback`,
      tls,
    },
  };
}

let warned = false;

/** Konfigurationen, eller null = Swish Handel av (Swish Företag gäller). */
export function getCommerceConfig(env: Env = process.env): SwishCommerceConfig | null {
  const r = readCommerceConfig(env);
  if ("config" in r) return r.config;
  if (r.problem !== "disabled" && !warned) {
    warned = true;
    console.error(`Swish Handel är påslaget men ${r.problem} saknas eller är fel. Faller tillbaka på Swish Företag.`);
  }
  return null;
}

/** För sidor: är Swish Handel på? Läser bara miljövariablerna, inga nätverksanrop. */
export function isCommerceEnabled(env: Env = process.env): boolean {
  return getCommerceConfig(env) !== null;
}
