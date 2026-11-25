import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { commerce } from "@/lib/swish/commerce";
import { handleCallback } from "@/lib/swish/commerce/payment";

export const dynamic = "force-dynamic";

/**
 * POST /api/swish/commerce/callback — Swish meddelar utfallet.
 *
 * Kroppen används bara för att hitta förfrågan. Headern callbackIdentifier
 * måste vara den vi skickade med just den förfrågan, och status och belopp
 * hämtas sedan från Swish med vår egen GET (mTLS). Se lib/swish/commerce/payment.ts.
 */
export async function POST(req: NextRequest) {
  const c = commerce();
  if (!c) return NextResponse.json({ error: "disabled" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "badRequest" }, { status: 400 });
  }
  const r = await handleCallback(createAdminClient(), c.client, body, req.headers.get("callbackidentifier"));
  return NextResponse.json(r.body, { status: r.http });
}
