import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { runSettlementPayouts } from "@/lib/settlements/run-payouts";
import { getResend, getFromEmail } from "@/lib/email/resend";

/**
 * Vem som ska veta att pengar lämnat bolaget.
 *
 * Samma lista som övriga ekonomilarm, och den innehåller ägaren. Att hårdkoda
 * en enda adress här vore att ge en av två delägare insyn i utbetalningar.
 */
function recipients(): string[] {
  const raw = process.env.PLATFORM_SALE_ALERT_TO || "pablo.acosta@usha.se";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

const kr = (ore: number) => `${(ore / 100).toFixed(2)} kr`;

function esc(v: string) {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Cron: för över partnerns andel för kvällar som varit.
 *
 * Körs en gång per dygn. Med payout_delay_days = 1 innebär det att pengarna går
 * dagen efter arrangemanget.
 *
 * Överföringar är avstängda tills SETTLEMENT_PAYOUTS_ENABLED=true. Dessförinnan
 * räknar jobbet ut allt och skriver en rad med status "dry_run" utan att flytta
 * pengar, så att beloppen går att jämföra mot Stripe innan det blir skarpt.
 */
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runSettlementPayouts();

    console.log(
      `[settlement-payouts] ${result.today} live=${result.live} ` +
        `betalda=${result.paid} torrkörda=${result.dryRun} ` +
        `blockerade=${result.blocked.length} uppskjutna=${result.deferred.length} ` +
        `misslyckade=${result.failed.length} ` +
        `summa=${(result.totalOre / 100).toFixed(2)} kr`
    );
    for (const b of result.blocked) console.log(`[settlement-payouts] blockerad ${b.title}: ${b.reason}`);
    for (const d of result.deferred)
      console.log(`[settlement-payouts] uppskjuten ${d.title}: saldot räcker inte ännu, försöker igen i morgon`);
    for (const f of result.failed) console.error(`[settlement-payouts] MISSLYCKAD ${f.title}: ${f.error}`);

    // Pengar som lämnat bolaget ska inte bara hamna i en logg ingen läser.
    // Beskedet går bara när något faktiskt fördes över eller misslyckades —
    // en tyst natt är det normala och ska förbli tyst.
    if (result.transfers.length > 0 || result.failed.length > 0) {
      const rader = [
        ...result.transfers.map(
          (t) =>
            `<tr><td style="padding:6px 10px;white-space:nowrap">${esc(t.eventDate)}</td>` +
            `<td style="padding:6px 10px">${esc(t.title)}</td>` +
            `<td style="padding:6px 10px">${esc(t.partnerName)}</td>` +
            `<td style="padding:6px 10px;text-align:right;white-space:nowrap">${kr(t.amountOre)}</td>` +
            `<td style="padding:6px 10px;color:#666;font-size:12px">${esc(t.transferId)}</td></tr>`
        ),
        ...result.failed.map(
          (f) =>
            `<tr style="color:#b00"><td style="padding:6px 10px">—</td>` +
            `<td style="padding:6px 10px">${esc(f.title)}</td>` +
            `<td colspan="3" style="padding:6px 10px">MISSLYCKADES: ${esc(f.error)}</td></tr>`
        ),
      ].join("");

      const summa = result.transfers.reduce((n, t) => n + t.amountOre, 0);
      const { error: mailError } = await getResend().emails.send({
        from: getFromEmail(),
        to: recipients(),
        subject:
          result.failed.length > 0
            ? `Usha: avräkning med ${result.failed.length} misslyckad${result.failed.length === 1 ? "" : "e"}`
            : `Usha: ${kr(summa)} utbetalt i avräkning`,
        html:
          `<h2>Avräkning ${esc(result.today)}</h2>` +
          `<p>${result.transfers.length} överföring${result.transfers.length === 1 ? "" : "ar"}, ` +
          `totalt <strong>${kr(summa)}</strong>.</p>` +
          `<table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">${rader}</table>` +
          (result.deferred.length > 0
            ? `<p style="color:#666">${result.deferred.length} kväll${result.deferred.length === 1 ? "" : "ar"} ` +
              `väntar på att pengarna ska bli tillgängliga i Stripe. De tas om i morgon.</p>`
            : "") +
          `<p style="color:#666;font-size:12px">Beloppet är partnerns andel efter moms. ` +
          `Mejlet skickas bara när något förts över eller misslyckats.</p>`,
      });

      if (mailError) console.error("[settlement-payouts] kunde inte skicka besked:", mailError);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[settlement-payouts] körningen kraschade:", error);
    return NextResponse.json({ error: "Settlement payout run failed" }, { status: 500 });
  }
}
