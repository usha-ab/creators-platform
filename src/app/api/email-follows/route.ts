import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  emailFollowState,
  isValidEmail,
  normalizeEmail,
  subscribeEmailFollow,
  unsubscribeEmailFollow,
} from "@/lib/follows/email-follow";
import { sendFollowConfirmEmail } from "@/lib/email/send-follow-confirm";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Följ via e-post utan konto.
 *
 * Två källor med olika bevis:
 * - "ticket": anroparen står på sin egen biljettsida (kapabilitetslänk) och
 *   adressen måste vara bokningens. Räcker som bekräftelse.
 * - "event_page": vem som helst kan skriva in vilken adress som helst, så
 *   ingenting räknas förrän bekräftelselänken i mejlet klickats.
 */
export async function POST(req: NextRequest) {
  let body: {
    action?: "subscribe" | "unsubscribe";
    source?: "ticket" | "event_page";
    email?: string;
    followedId?: string;
    bookingId?: string;
    locale?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  const followedId = body.followedId ?? "";
  if (!isValidEmail(email) || !UUID.test(followedId)) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const locale = ["sv", "en", "es"].includes(body.locale ?? "") ? body.locale! : null;
  const admin = createAdminClient();

  const { data: target } = await admin.from("profiles").select("id, full_name").eq("id", followedId).maybeSingle();
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (body.source === "ticket") {
    if (!UUID.test(body.bookingId ?? "")) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    const { data: booking } = await admin
      .from("bookings")
      .select("guest_email, creator_id, listing_id, listings(venue_profile_id, venue_confirmed_at)")
      .eq("id", body.bookingId!)
      .maybeSingle();
    const listing = (booking as { listings?: { venue_profile_id: string | null; venue_confirmed_at: string | null } | null } | null)?.listings ?? null;
    const allowed = new Set<string>([booking?.creator_id ?? ""]);
    if (listing?.venue_profile_id && listing.venue_confirmed_at) allowed.add(listing.venue_profile_id);
    if (!booking?.guest_email || normalizeEmail(booking.guest_email) !== email || !allowed.has(followedId)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    if (body.action === "unsubscribe") {
      await unsubscribeEmailFollow(admin, email, followedId);
      return NextResponse.json({ state: "unsubscribed" });
    }
    const { row } = await subscribeEmailFollow(admin, { email, followedId, locale, source: "ticket", confirmed: true });
    return NextResponse.json({ state: emailFollowState(row) });
  }

  if (body.source === "event_page" && body.action === "subscribe") {
    const { row, wasActive } = await subscribeEmailFollow(admin, { email, followedId, locale, source: "event_page", confirmed: false });
    if (wasActive) return NextResponse.json({ state: "active" });
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://usha.se";
    await sendFollowConfirmEmail({
      to: email,
      creatorName: target.full_name || "Usha Platform",
      confirmUrl: `${appUrl}/folj/bekrafta/${row.confirm_token}`,
      locale,
    });
    return NextResponse.json({ state: "pending" });
  }

  return NextResponse.json({ error: "invalid_input" }, { status: 400 });
}
