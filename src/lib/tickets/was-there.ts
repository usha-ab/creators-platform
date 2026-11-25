import type { SupabaseClient } from "@supabase/supabase-js";
import { checkinButtonMode, type EveningLike } from "./evening";

/**
 * "Var du där?" — betala för en PASSERAD kväll i efterhand, i 24 timmar
 * efter att kvällen slutat (beslut Pablo 2026-11-25, se evening.ts).
 *
 * Skilt från vanliga köp. Den vanliga kassan säljer aldrig en passerad kväll
 * (sale-state säger "past"); bara en begäran med `wasThere: true` — som
 * bara bekräftelsesteget skickar — släpps igenom, och då med spärrar:
 *  1. Kvällen måste ligga i efterköpsfönstret.
 *  2. En biljett, en person. Inga klippkort.
 *  3. Ett köp per kväll och konto eller e-postadress. Gäster utan konto
 *     måste ange adressen, annars finns inget att kontrollera mot.
 * Köpet gäller en kväll som redan ägt rum — se köpvillkoren om ångerrätten.
 */

export type WasThereGate =
  /** Ingen efterköpsbegäran — vanliga kassan, som säljer kommande kvällar. */
  | { kind: "off" }
  /** Efterköp, alla spärrar passerade. */
  | { kind: "ok" }
  | { kind: "error"; status: number; code: "wasThereClosed" | "wasThereNoPass" | "wasThereEmail" | "wasThereAlreadyPaid" };

export function isWasThere(listing: EveningLike, now: Date): boolean {
  return checkinButtonMode(now, listing) === "wasThere";
}

/** Spärrarna. `email` ska vara normaliserad (normalizeEmail). */
export async function wasThereGate(opts: {
  admin: SupabaseClient;
  listing: EveningLike & { id: string };
  now: Date;
  /** Begäran kommer från bekräftelsesteget ("Var du där?"). */
  requested: boolean;
  isPass: boolean;
  userId: string | null;
  email: string | null;
}): Promise<WasThereGate> {
  const { admin, listing, now } = opts;
  if (!opts.requested) return { kind: "off" };
  if (!isWasThere(listing, now)) return { kind: "error", status: 403, code: "wasThereClosed" };
  if (opts.isPass) return { kind: "error", status: 400, code: "wasThereNoPass" };
  if (!opts.userId && !opts.email) return { kind: "error", status: 400, code: "wasThereEmail" };

  const paid = ["confirmed", "completed"];
  const checks: PromiseLike<{ data: unknown[] | null }>[] = [];
  if (opts.userId) {
    checks.push(
      admin.from("bookings").select("id").eq("listing_id", listing.id).eq("customer_id", opts.userId).in("status", paid).limit(1)
    );
  }
  if (opts.email) {
    checks.push(
      admin.from("bookings").select("id").eq("listing_id", listing.id).ilike("guest_email", opts.email).in("status", paid).limit(1)
    );
  }
  const results = await Promise.all(checks);
  if (results.some((r) => (r.data ?? []).length > 0)) {
    return { kind: "error", status: 409, code: "wasThereAlreadyPaid" };
  }
  return { kind: "ok" };
}

/**
 * Raden på kvittot: kvällens namn och datum, så att kvittot och momsunderlaget
 * säger vilken kväll betalningen gäller — inte bara dagen den gjordes.
 */
export function eveningLineName(title: string, eventDate: string | null | undefined, eventTime?: string | null): string {
  if (!eventDate) return title;
  const day = new Date(`${eventDate.slice(0, 10)}T12:00:00Z`).toLocaleDateString("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Stockholm",
  });
  return `${title} – ${day}${eventTime ? ` ${eventTime.slice(0, 5)}` : ""}`;
}
