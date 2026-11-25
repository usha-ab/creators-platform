import type { Metadata } from "next";
import { isPassBooking, passRemaining, passSeriesIds, pickOccurrence, seriesOccurrences } from "@/lib/passes/series-pass";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { Calendar, Clock, MapPin, CheckCircle2, XCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import VenueConsentCard from "./venue-consent-card";
import { consentIdentity, consentState, shouldAskConsent } from "@/lib/venues/consent";
import { getLocale } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import EmailFollowCard from "./email-follow-card";
import { FollowButton } from "@/components/follow-button";
import { emailFollowState, findEmailFollow } from "@/lib/follows/email-follow";
import { ShareEventButton } from "@/components/share-event-button";
import { appleWalletConfigured, googleWalletConfigured } from "@/lib/tickets/wallet";
import { swishOfferForListing } from "@/lib/swish/availability";
import { swishPaymentUrl } from "@/lib/swish/config";
import { PendingRefresh } from "./pending-refresh";
import { isPaidBooking } from "@/lib/tickets/checkin";
import { eveningIsOver, selfCheckinWindow } from "@/lib/tickets/evening";
import { checkinColor } from "@/lib/tickets/checkin-color";
import { LiveTicket } from "@/components/tickets/live-ticket";
import { SelfCheckinButton } from "@/components/tickets/self-checkin-button";
import WithdrawalCard from "./withdrawal-card";
import { withdrawalState } from "@/lib/bookings/withdrawal";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Din biljett · Usha Platform",
  robots: { index: false, follow: false },
};

function isUUID(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/**
 * Public, login-free ticket page keyed by the booking UUID (an unguessable
 * capability link, like any e-ticket). Works for guest bookings (customer_id
 * null) AND account bookings. The QR only encodes the verify URL — scanning
 * still requires an authenticated scanner to check anyone in.
 */
export default async function GuestTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUUID(id)) notFound();

  const t = await getTranslations("ticketPage");
  const tCommon = await getTranslations("common");
  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id, status, scheduled_at, guest_name, guest_email, customer_id, creator_id, listing_id, checked_in_at, ticket_type_name, ticket_type_id, guest_count, sessions_total, sessions_redeemed, pass_expires_at, payment_method, amount_paid, refunded_at, created_at, minutes_total, is_free")
    .eq("id", id)
    .maybeSingle();
  if (!booking) notFound();

  const [{ data: listing }, { data: creator }] = await Promise.all([
    admin
      .from("listings")
      .select("user_id, title, slug, event_date, event_time, event_end_time, event_location, venue_profile_id, venue_confirmed_at, pass_series_id, pass_series_ids, pass_covers")
      .eq("id", booking.listing_id)
      .maybeSingle(),
    admin
      .from("profiles")
      .select("full_name")
      .eq("id", booking.creator_id)
      .maybeSingle(),
  ]);

  // Klippkort på en serie: biljetten visar seriens nästa kväll (eller kvällens),
  // inte köpögonblicket, och hur många klipp som är kvar.
  const isPass = isPassBooking(booking);
  const passSeries = passSeriesIds(listing);
  const passPick = isPass && passSeries.length > 0 ? pickOccurrence(await seriesOccurrences(admin, passSeries)) : null;
  const passShown = passPick ? passPick.today ?? passPick.next : null;

  let attendee: string | null = booking.guest_name;
  if (!attendee && booking.customer_id) {
    const { data: c } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", booking.customer_id)
      .maybeSingle();
    attendee = c?.full_name ?? null;
  }

  // Frågan om deltagaren vill höra från lokalen. Den ställs här och inte i
  // kassan: ett samtycke som samlas in efter köpet är otvetydigt frivilligt,
  // eftersom ingenting i köpet berodde på svaret.
  const identity = consentIdentity(booking);
  const askVenue = shouldAskConsent({
    venueProfileId: listing?.venue_profile_id,
    venueConfirmedAt: listing?.venue_confirmed_at,
    identity,
  });

  let venueName: string | null = null;
  let venueConsent: "granted" | "withdrawn" | "unanswered" = "unanswered";
  if (askVenue) {
    const [{ data: venue }, { data: consentRow }] = await Promise.all([
      admin
        .from("profiles")
        .select("company_name, full_name")
        .eq("id", listing!.venue_profile_id!)
        .maybeSingle(),
      admin
        .from("venue_marketing_consents")
        .select("granted_at, withdrawn_at")
        .eq("venue_profile_id", listing!.venue_profile_id!)
        .eq(identity!.profileId ? "profile_id" : "email", identity!.profileId ?? identity!.email!)
        .maybeSingle(),
    ]);
    venueName = (venue?.company_name || venue?.full_name || "").trim() || null;
    venueConsent = consentState(consentRow);
  }

  // Övriga pass på samma kväll, för "Lägg till".
  //
  // The Lab är tre pass efter varandra: practica, workshop, social. Den som
  // köpt ett av dem och vill stanna hade ingen väg vidare från biljetten — hen
  // fick leta upp eventsidan igen mitt i kvällen, medan arrangören står ensam
  // i dörren. Nu ligger de andra passen här, en knapp per pass, och köparen
  // sköter det själv i sin egen telefon.
  //
  // Passen köps som en egen biljett, inte som en ändring av den här. Att räkna
  // mellanskillnad och byta typ på en betald bokning är en ny pengaväg, och en
  // sådan lägger jag inte in dagarna före den första betalkvällen.
  const { data: otherTypes } = booking.status !== "canceled"
    ? await admin
        .from("ticket_types")
        .select("id, name, price, capacity, tickets_sold")
        .eq("listing_id", booking.listing_id)
        .neq("name", booking.ticket_type_name ?? "")
        .order("price", { ascending: true })
    : { data: null };

  // Samma kvällsslut som köpgränsen (evening.ts) — inte UTC-datumet, som
  // gömde tilläggen redan 01–02 svensk tid mitt under kvällen.
  const eventOver = listing ? eveningIsOver(listing, new Date()) : false;
  const addOns = eventOver
    ? []
    : (otherTypes ?? []).filter(
        (tt) => tt.capacity == null || (tt.tickets_sold ?? 0) < tt.capacity
      );

  const locale = await getLocale();

  // Ångerrätten (2 kap. distansavtalslagen): ett kort eller paket utan datum
  // kan ångras här i 14 dagar, också av en gäst. En biljett till ett bestämt
  // datum har ingen ångerrätt, och det ska stå. Ett redan ångrat köp visar
  // beskedet i stället för knappen.
  const withdrawal = withdrawalState(booking);
  const { data: withdrawn } = await admin
    .from("booking_withdrawals")
    .select("received_at, refund_method")
    .eq("booking_id", booking.id)
    .maybeSingle();
  let buyerEmail = booking.guest_email ?? "";
  if (!buyerEmail && booking.customer_id && (withdrawal.kind === "open" || withdrawn)) {
    const { data: c } = await admin.from("profiles").select("email").eq("id", booking.customer_id).maybeSingle();
    buyerEmail = c?.email ?? "";
  }
  const tW = await getTranslations("ticketPage.withdrawal");
  const withdrawalLabels = {
    title: tW("title"),
    lead: withdrawal.kind === "open" ? tW("lead", { date: withdrawal.lastDay }) : "",
    open: tW("open"),
    nameLabel: tW("nameLabel"),
    emailLabel: tW("emailLabel"),
    confirmText: tW("confirmText", { title: listing?.title ?? t("eventFallback"), code: `USH-${booking.id.slice(0, 8).toUpperCase()}` }),
    confirm: tW("confirm"),
    cancel: tW("cancel"),
    doneTitle: tW("doneTitle"),
    doneBody: tW("doneBody", { when: "{when}" }),
    refundStripe: tW("refundStripe"),
    refundManual: tW("refundManual"),
    policyLink: tW("policyLink"),
    errors: {
      emailMismatch: tW("errors.emailMismatch"),
      expired: tW("errors.expired"),
      fixedDate: tW("errors.fixedDate"),
      notWithdrawable: tW("errors.notWithdrawable"),
      nameMissing: tW("errors.nameMissing"),
      rateLimited: tW("errors.rateLimited"),
      failed: tW("errors.failed"),
    },
  };

  // "Följ oss" efter köpet. Gästen (utan konto) får en fråga med aktivt ja;
  // kontoinnehavaren får den vanliga följ-knappen. Frågan ställs här och inte
  // i kassan av samma skäl som lokalens samtycke: svaret påverkar inget köp.
  const followedId = booking.creator_id;
  const { data: { user: viewer } } = await (await createClient()).auth.getUser();
  const guestEmail = !booking.customer_id ? booking.guest_email : null;
  const emailFollow = guestEmail && followedId ? await findEmailFollow(admin, guestEmail, followedId) : null;
  const [{ count: organizerFollowerCount }, { data: viewerFollow }] = await Promise.all([
    admin.from("follows").select("id", { count: "exact", head: true }).eq("followed_id", followedId),
    viewer && followedId
      ? admin.from("follows").select("id").eq("follower_id", viewer.id).eq("followed_id", followedId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const tFollow = await getTranslations("emailFollow");
  const organizerName = creator?.full_name || t("eventFallback");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://usha.se";
  const code = `USH-${booking.id.slice(0, 8).toUpperCase()}`;
  const verifyUrl = `${appUrl}/api/tickets/verify?code=${code}&id=${booking.id}`;
  const qrOpts = {
    width: 240,
    margin: 2,
    errorCorrectionLevel: "M" as const,
    color: { dark: "#000000", light: "#ffffff" },
  };
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, qrOpts);

  // Multi-ticket order: one QR per attendee, each individually scannable.
  // Swish-bokningar har inga attendee-rader (en QR, antalet platser ligger i
  // guest_count och skannern räknar), så de faller tillbaka på den enkla vyn.
  const attendeeQrs: { id: string; label: string; checkedIn: boolean; checkedInAt: string | null; qr: string }[] = [];
  if ((booking.guest_count ?? 1) > 1) {
    const { data: attRows } = await admin
      .from("ticket_attendees")
      .select("id, idx, name, checked_in_at")
      .eq("booking_id", booking.id)
      .order("idx", { ascending: true });
    for (const a of attRows ?? []) {
      const url = `${appUrl}/api/tickets/verify?code=${code}&id=${booking.id}&att=${a.id}`;
      attendeeQrs.push({
        id: a.id,
        label: a.name || t("guestLabel", { idx: a.idx, count: booking.guest_count ?? 1 }),
        checkedIn: !!a.checked_in_at,
        checkedInAt: a.checked_in_at,
        qr: await QRCode.toDataURL(url, qrOpts),
      });
    }
  }
  const isMulti = attendeeQrs.length > 0;

  // scheduled_at is UTC — always format in Europe/Stockholm so a 14:00 Swedish
  // event doesn't render as 12:00. event_time (when set) is already Swedish
  // wall-clock, so it's shown verbatim.
  const scheduled = new Date(booking.scheduled_at);
  const dateSource = passShown?.event_date ?? listing?.event_date ?? null;
  const dateLabel = dateSource
    ? new Date(dateSource + "T00:00").toLocaleDateString("sv-SE", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Europe/Stockholm",
      })
    : scheduled.toLocaleDateString("sv-SE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Stockholm" });
  const timeSource = passShown?.event_time ?? listing?.event_time ?? null;
  const timeLabel = timeSource
    ? timeSource.slice(0, 5)
    : scheduled.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" });

  const canceled = booking.status === "canceled";
  const used = booking.status === "completed" || !!booking.checked_in_at;

  // Självincheckning och den levande biljetten. Fönstret (start − 30 min till
  // kvällens slut) och betalningen avgörs här på servern; rutten
  // /api/tickets/self-checkin kontrollerar samma sak igen när gästen trycker.
  // Klippkort: kvällens tillfälle i serien, och bara i dag — inte nästa kväll.
  const now = new Date();
  const evening = isPass ? passPick?.today ?? null : listing;
  const eveningListingId = isPass ? passPick?.today?.id ?? null : booking.listing_id;
  const checkinWindow = evening ? selfCheckinWindow(evening, now) : ({ state: "none" } as const);
  const paid = isPaidBooking(booking);
  let liveAt: string | null = null;
  if (isPass && eveningListingId) {
    const { data: clip } = await admin
      .from("pass_redemptions")
      .select("redeemed_at")
      .eq("booking_id", booking.id)
      .eq("listing_id", eveningListingId)
      .eq("is_manual", false)
      .maybeSingle();
    liveAt = clip?.redeemed_at ?? null;
  } else if (isMulti) {
    liveAt = attendeeQrs.map((a) => a.checkedInAt).filter((x): x is string => !!x).sort().pop() ?? null;
  } else {
    liveAt = booking.checked_in_at;
  }
  // "Checka in" och den levande biljetten gäller till midnatt, eller till
  // sluttiden om kvällen pågår efter midnatt (checkinButtonMode). Därefter är
  // kvällen passerad; biljetten har redan betalats, så "Var du där?" hör inte
  // hemma här utan på kvällens eventsida.
  const eveningLive = checkinWindow.state === "open";
  const showLive = !!liveAt && eveningLive && !canceled;
  const attendeesIn = attendeeQrs.filter((a) => a.checkedIn).length;
  const canSelfCheckin =
    paid &&
    !canceled &&
    eveningLive &&
    (isPass ? !liveAt && passRemaining(booking) > 0 : isMulti ? attendeesIn < attendeeQrs.length : !booking.checked_in_at);
  const ts = await getTranslations("selfCheckin");
  const color = showLive && eveningListingId && evening?.event_date ? checkinColor(eveningListingId, evening.event_date) : null;
  const opensAtLabel =
    checkinWindow.state === "before" && paid && !canceled
      ? checkinWindow.opensAt.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" })
      : null;
  const opensToday = checkinWindow.state === "before" && checkinWindow.opensAt.getTime() - now.getTime() < 18 * 3_600_000;

  // Swish som inte bekräftats än. Det här är sidan gästen landar på direkt
  // efter "Fortsätt till Swish": här görs betalningen, här står vad som händer
  // sedan, och här byts allt mot QR-koden när entrén tryckt Bekräfta. Utan
  // den här vyn visade sidan en QR som dörren nekar, och ingen förstod varför.
  const swishPending = booking.status === "pending" && booking.payment_method === "swish";
  const swishOffer = swishPending && listing ? await swishOfferForListing(admin, { user_id: listing.user_id, title: listing.title, event_date: listing.event_date }) : null;
  const swishAmountSek = Math.round((booking.amount_paid ?? 0) / 100);
  const swishUrl = swishOffer && swishAmountSek > 0 ? swishPaymentUrl({ number: swishOffer.number, amountSek: swishAmountSek, message: swishOffer.message }) : null;
  const swishQr = swishUrl
    ? `/api/swish/qr?listing=${encodeURIComponent(booking.listing_id)}${booking.ticket_type_id ? `&tt=${encodeURIComponent(booking.ticket_type_id)}` : ""}&qty=${booking.guest_count ?? 1}`
    : null;

  // Wallet passes — only rendered when the provider's credentials are configured.
  const appleOn = appleWalletConfigured();
  const googleOn = googleWalletConfigured();
  const walletButtons = (att?: string) => {
    if (canceled || (!appleOn && !googleOn)) return null;
    const q = `id=${booking.id}${att ? `&att=${att}` : ""}`;
    return (
      <div className="flex w-full flex-col gap-2">
        {appleOn && (
          <a
            href={`/api/tickets/wallet?${q}&provider=apple`}
            className="flex items-center justify-center gap-2 rounded-xl border border-[var(--usha-border)] bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:border-white/40"
          >
            {t("walletApple")}
          </a>
        )}
        {googleOn && (
          <a
            href={`/api/tickets/wallet?${q}&provider=google`}
            className="flex items-center justify-center gap-2 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] px-4 py-2.5 text-sm font-medium text-[var(--usha-white)] transition hover:border-[var(--usha-gold)]/40"
          >
            {t("walletGoogle")}
          </a>
        )}
      </div>
    );
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--usha-black)] px-4 py-10 text-[var(--usha-white)]">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)]">
        <div className="border-b border-[var(--usha-border)] px-6 py-4 text-center">
          <span className="text-lg font-bold text-[var(--usha-gold)]">Usha Platform</span>
        </div>

        <div className="space-y-4 p-6">
          <div className="text-center">
            <h1 className="text-xl font-semibold">{listing?.title ?? t("eventFallback")}</h1>
            {(isPass || booking.ticket_type_name) && (
              <p className="mt-1 inline-block rounded-full bg-[var(--usha-gold)]/10 px-2.5 py-0.5 text-xs font-medium text-[var(--usha-gold)]">
                {isPass
                  ? t("passChip", { remaining: passRemaining(booking), total: booking.sessions_total ?? 0 })
                  : booking.ticket_type_name}
              </p>
            )}
            {/* Giltighetstiden är ett villkor för kortet. Innehavaren måste
                kunna se sitt eget slutdatum utan att fråga någon. */}
            {isPass && booking.pass_expires_at && (
              <p className="mt-1 text-xs text-[var(--usha-muted)]">
                {t("passValidUntil", {
                  date: new Date(booking.pass_expires_at).toLocaleDateString("sv-SE"),
                })}
              </p>
            )}
            {attendee && (
              <p className="mt-1 text-sm text-[var(--usha-muted)]">{attendee}</p>
            )}
          </div>

          {showLive && liveAt && (
            <LiveTicket
              checkedInAt={liveAt}
              title={(isPass ? passShown?.title : null) ?? listing?.title ?? t("eventFallback")}
              dateLabel={dateLabel}
              holder={attendee}
              color={color ? { bg: color.bg, fg: color.fg, name: ts(`colors.${color.key}`) } : null}
              note={isMulti ? ts("party", { in: attendeesIn, total: attendeeQrs.length }) : null}
              labels={{ title: ts("liveTitle", { time: "{time}" }), hint: ts("liveHint"), now: ts("liveNow"), colorLabel: ts("colorLabel") }}
            />
          )}
          {canSelfCheckin && (
            <SelfCheckinButton
              bookingId={booking.id}
              attendees={isMulti ? attendeeQrs.map((a) => ({ id: a.id, label: a.label, checkedIn: a.checkedIn })) : undefined}
              labels={{
                button: ts("button"),
                buttonParty: ts("buttonParty", { n: "{n}" }),
                choose: ts("choose"),
                working: ts("working"),
                failed: ts("failed"),
                network: ts("network"),
              }}
            />
          )}
          {!showLive && !canSelfCheckin && paid && !canceled && checkinWindow.state === "before" && (
            <p className="rounded-xl border border-green-600/30 bg-green-600/10 p-3 text-center text-xs leading-relaxed text-[var(--usha-muted)]">
              {opensToday && opensAtLabel ? ts("opensAt", { time: opensAtLabel }) : ts("hint")}
            </p>
          )}

          {/* QR or status */}
          {swishPending ? (
            <div className="space-y-3 rounded-xl border border-[var(--usha-gold)]/40 bg-[var(--usha-black)]/40 p-4 text-sm">
              <PendingRefresh />
              <p className="font-semibold">{t("swishPendingTitle", { amount: swishAmountSek })}</p>
              <p className="text-xs leading-relaxed text-[var(--usha-muted)]">{t("swishPendingLead")}</p>
              {swishUrl && swishOffer ? (
                <>
                  <a
                    href={swishUrl}
                    aria-label={`${t("swishOpenApp")} Swish`}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-black px-4 py-3 text-sm font-bold text-white transition hover:border-white/40"
                  >
                    <span className="whitespace-nowrap">{t("swishOpenApp")}</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/payments/swish-logo-dark.png" alt="Swish" width={66} height={20} className="h-5 w-auto shrink-0" />
                  </a>
                  <p className="text-center text-xs text-[var(--usha-muted)]">
                    {t("swishNumberLabel")} <span className="font-mono font-semibold text-[var(--usha-white)]">{swishOffer.formatted}</span>
                    {" · "}
                    {t("swishMessageLabel")} <span className="font-semibold text-[var(--usha-white)]">{swishOffer.message}</span>
                  </p>
                  <details className="text-xs text-[var(--usha-muted)]">
                    <summary className="cursor-pointer text-center">{t("swishQrHint")}</summary>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={swishQr ?? undefined} alt="" className="mx-auto mt-2 w-full max-w-[200px] rounded-xl bg-white p-2" />
                  </details>
                </>
              ) : (
                <p className="text-xs text-[var(--usha-muted)]">{t("swishUnavailable")}</p>
              )}
              <div className="space-y-1.5 border-t border-[var(--usha-border)] pt-3 text-xs leading-relaxed text-[var(--usha-muted)]">
                <p>{t("swishThen", { email: booking.guest_email ?? "" })}</p>
                <p>{t("swishAtDoor")}</p>
              </div>
            </div>
          ) : canceled ? (
            <div className="flex flex-col items-center gap-2 rounded-xl bg-red-500/10 p-6 text-center">
              <XCircle className="h-8 w-8 text-red-400" />
              <p className="text-sm font-medium text-red-400">{t("canceled")}</p>
            </div>
          ) : isMulti ? (
            <div className="flex flex-col items-center gap-5">
              <p className="text-xs text-[var(--usha-muted)]">
                {t("multiHeader", { count: booking.guest_count ?? 1 })}
              </p>
              {attendeeQrs.map((a) => (
                <div key={a.id} className="flex flex-col items-center gap-2">
                  <p className="text-sm font-medium">{a.label}</p>
                  {a.checkedIn && (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-green-400">
                      <CheckCircle2 className="h-3.5 w-3.5" /> {t("checkedIn")}
                    </div>
                  )}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.qr}
                    alt={a.label}
                    width={200}
                    height={200}
                    className={`rounded-xl bg-white p-3 ${a.checkedIn ? "opacity-40" : ""}`}
                  />
                  {!a.checkedIn && walletButtons(a.id)}
                </div>
              ))}
              <p className="text-xs tracking-wider text-[var(--usha-muted)]">{code}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              {used && (
                <div className="flex items-center gap-1.5 text-sm font-medium text-green-400">
                  <CheckCircle2 className="h-4 w-4" /> {t("checkedIn")}
                </div>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt="Biljett QR-kod"
                width={240}
                height={240}
                className={`rounded-xl bg-white p-3 ${used ? "opacity-40" : ""}`}
              />
              <p className="text-xs tracking-wider text-[var(--usha-muted)]">{code}</p>
              {!used && walletButtons()}
            </div>
          )}

          {/* Details */}
          <div className="space-y-2 rounded-xl bg-[var(--usha-black)]/40 p-4 text-sm">
            <div className="flex items-center gap-2 text-[var(--usha-muted)]">
              <Calendar size={14} className="text-[var(--usha-gold)]" />
              <span className="text-[var(--usha-white)]">{dateLabel}</span>
            </div>
            <div className="flex items-center gap-2 text-[var(--usha-muted)]">
              <Clock size={14} className="text-[var(--usha-gold)]" />
              <span className="text-[var(--usha-white)]">{timeLabel}</span>
            </div>
            {listing?.event_location && (
              <div className="flex items-center gap-2 text-[var(--usha-muted)]">
                <MapPin size={14} className="text-[var(--usha-gold)]" />
                <span className="text-[var(--usha-white)]">{listing.event_location}</span>
              </div>
            )}
            {creator?.full_name && (
              <p className="pt-1 text-xs text-[var(--usha-muted)]">{t("organizer", { name: creator.full_name })}</p>
            )}
            {isPass && listing?.pass_covers && (
              <p className="pt-1 text-xs text-[var(--usha-muted)]">{t("passCovers", { covers: listing.pass_covers })}</p>
            )}
          </div>

          {!canceled && !used && !swishPending && (
            <p className="text-center text-xs text-[var(--usha-muted)]">
              {t("showAtEntrance")}
            </p>
          )}

          {withdrawn ? (
            <WithdrawalCard
              bookingId={booking.id}
              locale={locale}
              initialName=""
              initialEmail=""
              labels={withdrawalLabels}
              done={{ receivedAt: withdrawn.received_at, refundMethod: withdrawn.refund_method === "stripe" ? "stripe" : "manual" }}
            />
          ) : withdrawal.kind === "open" ? (
            <WithdrawalCard
              bookingId={booking.id}
              locale={locale}
              initialName={attendee ?? ""}
              initialEmail={buyerEmail}
              labels={withdrawalLabels}
            />
          ) : withdrawal.kind === "fixedDate" && !canceled ? (
            <p id="angra" className="text-center text-xs leading-relaxed text-[var(--usha-muted)]">
              {tW("fixedDate")}{" "}
              <a href="/refund-policy" className="text-[var(--usha-gold)] hover:underline">{tW("policyLink")}</a>
            </p>
          ) : withdrawal.kind === "expired" && !canceled ? (
            <p id="angra" className="text-center text-xs text-[var(--usha-muted)]">
              {tW("expired", { date: withdrawal.lastDay })}
            </p>
          ) : null}

          {askVenue && venueName && !canceled && (
            <VenueConsentCard
              bookingId={booking.id}
              venueName={venueName}
              locale={locale}
              initialState={venueConsent}
              labels={{
                question: t("venueConsent.question", { venue: venueName }),
                explain: t("venueConsent.explain", { venue: venueName }),
                yes: t("venueConsent.yes"),
                no: t("venueConsent.no"),
                granted: t("venueConsent.granted", { venue: venueName }),
                withdrawn: t("venueConsent.withdrawn", { venue: venueName }),
                change: t("venueConsent.change"),
                failed: t("venueConsent.failed"),
              }}
            />
          )}

          {!canceled && followedId && guestEmail && (
            <EmailFollowCard
              bookingId={booking.id}
              email={guestEmail}
              followedId={followedId}
              locale={locale}
              initialState={emailFollowState(emailFollow)}
              labels={{
                question: tFollow("ticketQuestion", { name: organizerName }),
                explain: tFollow("ticketExplain", { email: guestEmail }),
                yes: tFollow("yes"),
                no: tFollow("no"),
                active: tFollow("active", { name: organizerName }),
                unsubscribed: tFollow("unsubscribed", { name: organizerName }),
                change: tFollow("change"),
                failed: tFollow("failed"),
              }}
            />
          )}
          {!canceled && followedId && !guestEmail && viewer?.id !== followedId && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4">
              <p className="text-sm">{tFollow("ticketQuestion", { name: organizerName })}</p>
              <FollowButton
                creatorId={followedId}
                initialFollowing={!!viewerFollow}
                followerCount={organizerFollowerCount ?? 0}
                isLoggedIn={!!viewer}
                returnTo={`/biljett/${booking.id}`}
                size="sm"
              />
            </div>
          )}

          {addOns.length > 0 && (
            <div className="rounded-xl border border-[var(--usha-border)] p-3">
              <p className="mb-2 text-center text-xs text-[var(--usha-muted)]">
                {t("addOnHeading")}
              </p>
              <div className="space-y-1.5">
                {addOns.map((tt) => (
                  <a
                    key={tt.id}
                    href={`${appUrl}/event/${listing?.slug || booking.listing_id}?tt=${tt.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[var(--usha-border)] px-3 py-2.5 text-sm transition hover:border-[var(--usha-gold)]/50"
                  >
                    <span className="min-w-0 truncate">{tt.name}</span>
                    <span className="shrink-0 font-medium text-[var(--usha-gold)]">
                      + {tt.price} kr
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {!canceled && (
            <ShareEventButton
              url={`${appUrl}/event/${listing?.slug || booking.listing_id}`}
              title={listing?.title ?? t("eventFallback")}
              text={t("shareText", { title: listing?.title ?? t("shareTitleFallback") })}
              label={t("shareLabel")}
              copiedLabel={tCommon("linkCopied")}
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-4 py-2.5 text-sm font-semibold text-black transition hover:opacity-90"
            />
          )}
        </div>
      </div>
    </main>
  );
}
