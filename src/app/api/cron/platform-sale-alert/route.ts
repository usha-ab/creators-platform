import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { stripe } from "@/lib/stripe/client";
import { getResend, getFromEmail } from "@/lib/email/resend";
import { createClient } from "@supabase/supabase-js";

const CURSOR_KEY = "platform_sale_alert_cursor";

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function recipients(): string[] {
  const raw = process.env.PLATFORM_SALE_ALERT_TO || "pablo.acosta@usha.se";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

const sek = (ore: number) => `${(ore / 100).toFixed(2)} kr`;

/**
 * Tells us the moment a sale actually lands on the platform account.
 *
 * Since the two-flow rebuild went live on 2026-08-18, Usha's own events are
 * supposed to charge straight onto the platform account with no transfer and
 * no application fee, while third-party sales still route to the organizer's
 * connected account. Nothing has verified that in production: between go-live
 * and 2026-09-06 there were zero transfers and zero application fees, which
 * proves nothing was mis-routed but not that the routing works — there simply
 * was no volume. Meanwhile every platform payout since 2026-06-22 has been
 * 0.00 kr, because historically the money arrived on connected accounts while
 * the Connect and Stripe Tax fees were billed to the platform.
 *
 * So the next sale is the real test, and it is worth catching the day it
 * happens rather than assuming. This job reports each new charge on the
 * platform account with the one fact that settles it: did the money stay here,
 * or was it transferred onwards?
 *
 * Cursor lives in app_config. On the very first run it is seeded to "now" and
 * nothing is sent — the point is the next sale, not a backlog of old ones.
 */
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  const { data: row } = await admin
    .from("app_config")
    .select("value")
    .eq("key", CURSOR_KEY)
    .maybeSingle();

  const cursor = (row?.value as { last_charge_created?: number } | null)?.last_charge_created;

  // First run: start the clock, stay quiet.
  if (!cursor) {
    const now = Math.floor(Date.now() / 1000);
    await admin
      .from("app_config")
      .upsert({ key: CURSOR_KEY, value: { last_charge_created: now } }, { onConflict: "key" });
    return NextResponse.json({ seeded: true, from: now });
  }

  const charges = await stripe.charges.list({
    created: { gt: cursor },
    limit: 100,
  });

  const fresh = charges.data
    .filter((c) => c.status === "succeeded")
    .sort((a, b) => a.created - b.created);

  if (fresh.length === 0) {
    return NextResponse.json({ checked: true, new_charges: 0 });
  }

  const balance = await stripe.balance.retrieve();
  const available = balance.available.find((b) => b.currency === "sek")?.amount ?? 0;
  const pending = balance.pending.find((b) => b.currency === "sek")?.amount ?? 0;

  const rows = fresh.map((c) => {
    // A destination charge carries transfer_data; a principal charge does not.
    // That single fact is what the alert exists to report.
    const wentOnwards = Boolean(c.transfer_data?.destination || c.transfer);
    const model = (c.metadata?.model as string) || (wentOnwards ? "agent (antaget)" : "principal (antaget)");
    return `
      <tr>
        <td style="padding:6px 12px;border-bottom:1px solid #eee">
          ${new Date(c.created * 1000).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" })}
        </td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee">${sek(c.amount)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee">${model}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee">
          <strong>${wentOnwards ? "Nej — vidare till anslutet konto" : "Ja — stannade på plattformen"}</strong>
        </td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px">${c.id}</td>
      </tr>`;
  });

  const stayed = fresh.filter((c) => !(c.transfer_data?.destination || c.transfer)).length;

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:760px">
      <h2 style="margin:0 0 4px">Försäljning på plattformskontot</h2>
      <p style="color:#555;margin:0 0 20px">
        ${fresh.length} ny${fresh.length === 1 ? "" : "a"} betalning${fresh.length === 1 ? "" : "ar"},
        varav ${stayed} stannade på plattformskontot.
      </p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <thead>
          <tr style="text-align:left;background:#fafafa">
            <th style="padding:6px 12px">Tid</th>
            <th style="padding:6px 12px">Belopp</th>
            <th style="padding:6px 12px">Modell</th>
            <th style="padding:6px 12px">Stannade här?</th>
            <th style="padding:6px 12px">Charge</th>
          </tr>
        </thead>
        <tbody>${rows.join("")}</tbody>
      </table>
      <p style="margin-top:24px;color:#555">
        Plattformskontots saldo just nu: <strong>${sek(available)}</strong> tillgängligt,
        ${sek(pending)} på väg in.
      </p>
      <p style="color:#888;font-size:12px">
        "Stannade här" avgörs av om betalningen bär transfer_data. Saknas den gick inga
        pengar vidare till ett anslutet konto, vilket är vad Ushas egna event ska göra.
      </p>
    </div>`;

  const { error } = await getResend().emails.send({
    from: getFromEmail(),
    to: recipients(),
    subject: `Usha: ${fresh.length} betalning${fresh.length === 1 ? "" : "ar"} på plattformskontot`,
    html,
  });

  if (error) {
    // Leave the cursor alone so the next run retries instead of losing the alert.
    console.error("platform-sale-alert: kunde inte skicka mejl:", error);
    return NextResponse.json({ error: "Could not send alert" }, { status: 500 });
  }

  await admin
    .from("app_config")
    .upsert(
      { key: CURSOR_KEY, value: { last_charge_created: fresh[fresh.length - 1].created } },
      { onConflict: "key" }
    );

  return NextResponse.json({ alerted: fresh.length, stayed_on_platform: stayed });
}
