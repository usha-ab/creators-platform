"use client";

import { useEffect, useRef } from "react";
import { trackPurchase } from "@/lib/analytics";
import type { PurchasePayload } from "@/lib/analytics/events";

/**
 * Rapporterar ett köp en gång per sidvisning. Refen finns för att React kör
 * effekter två gånger i utvecklingsläge — utan den blir varje köp två i GA4
 * så fort någon tittar på siffrorna lokalt.
 */
export function TrackPurchase({ payload }: { payload: PurchasePayload }) {
  const skickad = useRef(false);
  useEffect(() => {
    if (skickad.current) return;
    skickad.current = true;
    trackPurchase(payload);
  }, [payload]);
  return null;
}
