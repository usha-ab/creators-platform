// ---------------------------------------------------------------------------
// Usha Bastu (bastu.usha.se) — nav bridge, Phase 0, same shape as the shop link.
//
// The sauna does not exist yet: no permit has been applied for. Its site is a
// dossier for the City of Stockholm and a showcase, reachable by direct link but
// deliberately undiscoverable — noindex, no sitemap, and unlinked from usha.se.
//
// This flag gates ONLY the nav links here. It does not gate access to
// bastu.usha.se; that site serves anyone who has the link, by design.
// Flip NEXT_PUBLIC_BASTU_PUBLIC to "true" on the platform when the sauna is real.
// ---------------------------------------------------------------------------
export const BASTU_URL = "https://bastu.usha.se";

export function isBastuLinkVisible(): boolean {
  return process.env.NEXT_PUBLIC_BASTU_PUBLIC === "true";
}
