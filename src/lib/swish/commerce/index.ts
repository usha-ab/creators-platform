import { getCommerceConfig, type SwishCommerceConfig } from "./config";
import { createSwishClient, type SwishClient } from "./client";

let cached: { cfg: SwishCommerceConfig; client: SwishClient } | null = null;

/** Konfiguration + klient, eller null när Swish Handel är av. Klienten återanvänds (keep-alive). */
export function commerce(): { cfg: SwishCommerceConfig; client: SwishClient } | null {
  const cfg = getCommerceConfig();
  if (!cfg) return null;
  if (!cached || cached.cfg.env !== cfg.env || cached.cfg.payeeAlias !== cfg.payeeAlias) cached = { cfg, client: createSwishClient(cfg) };
  return cached;
}

/** swish://-länken som öppnar appen på mobilen och skickar gästen tillbaka till biljettsidan efteråt. */
export function swishAppUrl(token: string, returnUrl: string): string {
  return `swish://paymentrequest?token=${encodeURIComponent(token)}&callbackurl=${encodeURIComponent(returnUrl)}`;
}
