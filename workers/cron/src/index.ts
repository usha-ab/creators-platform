/**
 * Usha-plattformens schemaläggare.
 *
 * Endpointerna bor i Next-appen på usha.se; det här är bara klockan. Den låg
 * tidigare i GitHub Actions, för att Vercel Hobby bara tillåter en körning per
 * dygn. Men GitHubs schemaläggning är uttalat "best effort", och för det här
 * repot betydde det i praktiken var 4,5:e timme med värsta glapp på 12,6.
 *
 * "Din bokning börjar snart"-mejlet letar efter bokningar inom två timmar. Med
 * fyra och en halv timme mellan körningarna hann de flesta bokningar passera
 * hela fönstret mellan två körningar: 5 av 57 bokningar fick sitt mejl.
 *
 * Alla endpoints är idempotenta (varsin dedup-kolumn), så en extra körning är
 * ofarlig — GitHub-schemat får ligga kvar som reserv.
 */

interface Env {
  /** Delad hemlighet med Next-appens verifyCronAuth. */
  CRON_SECRET: string;
  /** För larmmejlet när ett jobb failar. Utan den larmar Workern inte. */
  RESEND_API_KEY?: string;
  /** Vart larmet går. */
  ALERT_EMAIL?: string;
  /** Bas-URL, för att kunna peka om till en preview vid felsökning. */
  APP_URL?: string;
}

/**
 * Timmen i svensk lokaltid just nu.
 *
 * Workern kör i UTC, men "varje morgon kl. 08" betyder åtta på klockan i
 * Stockholm — inte 08 UTC, och inte en timme som glider en gång i halvåret när
 * sommartiden slår om. Genom att läsa lokal timme här i stället för att lägga
 * en cron-trigger på 06:00 UTC blir jobbet rätt året runt utan att någon
 * behöver komma ihåg att flytta det i oktober och mars.
 */
function svenskTimme(): number {
  return Number(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Stockholm",
      hour: "numeric",
      hour12: false,
    }).format(new Date())
  );
}

/** Dag i månaden, svensk tid – för jobb som ska gå en gång per månad/kvartal. */
function svenskDagIManaden(): number {
  return Number(
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", day: "numeric" }).format(new Date())
  );
}

/**
 * Jobben, i den ordning de körs. Namnet används i larmmejlet.
 *
 * `atHour` betyder "bara den här timmen, svensk tid". Utan den körs jobbet
 * varje hel timme som förut. `onDayOfMonth` begränsar dessutom till en dag.
 */
const JOBS = [
  { name: "booking-reminders-soon", desc: 'Påminnelse "börjar snart" (T-2h)' },
  { name: "creator-event-notify", desc: "Notis till följare om nya evenemang" },
  { name: "event-reminders", desc: "Autopublicering till Facebook (T-3d)" },
  { name: "waitlist-release", desc: "Mejl till väntelistan när biljetter släpps" },
  { name: "connect-sync", desc: "Synk av Stripe Connect-kapaciteter" },
  // Avräkningen låg bara i GitHub-schemat, som driver 4–12 timmar. Med
  // payout_delay_days = 1 ska underlaget finnas morgonen efter kvällen, och
  // det gör det inte om jobbet kör vid lunch. Körningen är idempotent
  // (UNIQUE(listing_id)), så att båda schemana pingar den är ofarligt.
  { name: "settlement-payouts", desc: "Avräkning mot partner för kvällar som varit" },
  // Betanivåerna delades ut utan betalning och med slutdatum 2099. De bär
  // påhittade Stripe-id, så ingen webhook kan nedgradera dem — utan det här
  // jobbet löper de vidare efter betan utan att någon valt att betala. En gång
  // per dygn räcker: en dags fördröjning på en nedgradering skadar ingen.
  { name: "expire-comp-subscriptions", desc: "Nedgradering av gratis nivåer som gått ut", atHour: 4 },
  // Nästa försäljning är det första riktiga testet av tvåflödesbygget: landar
  // Ushas egna event verkligen direkt på plattformskontot? En gång per morgon
  // räcker — larmet ska ge besked, inte pipa i realtid. Rutten samlar ihop allt
  // sedan förra körningen, så inget missas av att den kör en gång per dygn.
  // Första körningen sätter bara markören och skickar ingenting.
  { name: "platform-sale-alert", desc: "Larm när en betalning landar på plattformskontot", atHour: 8 },
  // Partnerprogrammet: kredit och premium-tid delas ut, andelar godkänns efter
  // ångerfönstret, utgången premium återställs. En gång per natt räcker.
  { name: "affiliate", desc: "Partnerprogrammets dagliga jobb (kredit, premium, godkännande)", atHour: 4 },
  // Kvartalsutbetalningen: första dagen i kvartalet kl 05. Idempotent per
  // partner och period, så att den råkar köra fler dagar är ofarligt.
  { name: "affiliate?task=payout", desc: "Partnerprogrammets kvartalsutbetalning", atHour: 5, onDayOfMonth: 1 },
  // Skyddsnät för det arvet inte fångar: en kväll som kopplas till lokalen
  // efter att den skapats, eller vars avräkning ändras för hand. Går kl 06 så
  // att beskedet finns innan avräkningen betalar ut dagens kvällar. Mejlar
  // bara när något avviker.
  { name: "settlement-gaps", desc: "Kvällar som inte följer en stående regel", atHour: 6 },
] as const;

async function runJob(env: Env, path: string): Promise<{ ok: boolean; detail: string }> {
  const base = env.APP_URL ?? "https://usha.se";
  try {
    const res = await fetch(`${base}/api/cron/${path}`, {
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    });
    const body = await res.text();
    return { ok: res.ok, detail: `${res.status} ${body.slice(0, 300)}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Larmar när ett jobb failat.
 *
 * Ett tyst schema är värre än inget schema: storage-backupen låg nere i trettio
 * dagar för att ingen fick veta. Går mejlet inte att skicka syns det åtminstone
 * i Workerns logg.
 */
async function alert(env: Env, failures: { name: string; desc: string; detail: string }[]) {
  const rader = failures.map((f) => `${f.desc} (${f.name}): ${f.detail}`).join("\n");
  console.error(`Cron-jobb misslyckades:\n${rader}`);

  if (!env.RESEND_API_KEY) return;
  const to = env.ALERT_EMAIL ?? "pablo.acosta@usha.se";
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Usha <no-reply@usha.se>",
        to,
        subject: `Cron: ${failures.length} jobb misslyckades`,
        text: `Schemaläggaren körde men följande jobb svarade inte som de skulle.\n\n${rader}\n\nKör om manuellt:\ncurl -H "Authorization: Bearer $CRON_SECRET" https://usha.se/api/cron/<jobb>`,
      }),
    });
  } catch (err) {
    console.error("Larmmejlet gick inte att skicka", err);
  }
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const failures: { name: string; desc: string; detail: string }[] = [];
        const timme = svenskTimme();
        const dagIManaden = svenskDagIManaden();
        for (const job of JOBS) {
          const atHour = "atHour" in job ? job.atHour : undefined;
          if (atHour !== undefined && atHour !== timme) continue;
          const onDay = "onDayOfMonth" in job ? job.onDayOfMonth : undefined;
          if (onDay !== undefined && onDay !== dagIManaden) continue;
          const res = await runJob(env, job.name);
          if (res.ok) console.log(`${job.name}: ${res.detail}`);
          else failures.push({ name: job.name, desc: job.desc, detail: res.detail });
        }
        if (failures.length) await alert(env, failures);
      })()
    );
  },

  /**
   * Manuell körning för felsökning, skyddad av samma hemlighet som jobben.
   * Utan den kan man bara vänta på nästa hela timme för att se om schemat lever.
   *
   * Kör medvetet ALLA jobb, även de som är låsta till en viss timme. Poängen med
   * den här vägen är att kunna prova ett jobb nu, inte att härma schemat.
   */
  async fetch(req: Request, env: Env): Promise<Response> {
    const auth = req.headers.get("authorization");
    if (!env.CRON_SECRET || auth !== `Bearer ${env.CRON_SECRET}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    const results: Record<string, string> = {};
    const failures: { name: string; desc: string; detail: string }[] = [];
    for (const job of JOBS) {
      const res = await runJob(env, job.name);
      results[job.name] = `${res.ok ? "ok" : "FEL"} ${res.detail}`;
      if (!res.ok) failures.push({ name: job.name, desc: job.desc, detail: res.detail });
    }
    // Larmar även här, så att larmvägen går att prova skarpt utan att vänta på
    // nästa hela timme. Ett larm ingen testat är ett larm man inte har.
    if (failures.length) await alert(env, failures);
    return Response.json(results);
  },
};
