import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Calendar, Clock, Users, CreditCard } from "lucide-react";
import {
  ConfirmButton,
  CancelButton,
  CompleteButton,
  FreeToggleButton,
} from "./booking-actions";
import { RescheduleButton } from "./reschedule-button";
import { NoBookings } from "@/components/ui/empty-state";
import { ReviewForm } from "@/components/review-form";
import { BookingsViewToggle } from "./bookings-view-toggle";
import { PayB2BButton } from "./pay-b2b-button";
import { RedeemSessionButton, DanceCounter } from "./redeem-session-button";
import { RedeemMinutesButton, MinutesCounter } from "./redeem-minutes-button";
import { calculateDiscountedPrice } from "@/lib/stripe/commission";

const STATUS_LABELS: Record<string, { labelKey: string; className: string }> = {
  pending: { labelKey: "statusPending", className: "bg-yellow-500/10 text-yellow-400" },
  confirmed: { labelKey: "statusConfirmed", className: "bg-green-500/10 text-green-400" },
  completed: { labelKey: "statusCompleted", className: "bg-blue-500/10 text-blue-400" },
  canceled: { labelKey: "statusCanceled", className: "bg-red-500/10 text-red-400" },
};

export default async function BookingsPage() {
  const t = await getTranslations("bookingsPage");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Incoming bookings (as creator)
  const { data: incoming } = await supabase
    .from("bookings")
    .select(
      "id, status, scheduled_at, notes, created_at, listing_id, customer_id, guest_count, special_requests, amount_paid, stripe_payment_id, is_free, sessions_total, sessions_redeemed, minutes_total, minutes_redeemed, agreed_price"
    )
    .eq("creator_id", user.id)
    .order("scheduled_at", { ascending: true });

  // Outgoing bookings (as customer)
  const { data: outgoing } = await supabase
    .from("bookings")
    .select(
      "id, status, scheduled_at, notes, created_at, listing_id, creator_id, guest_count, special_requests, stripe_payment_id, amount_paid, sessions_total, sessions_redeemed, minutes_total, minutes_redeemed, agreed_price"
    )
    .eq("customer_id", user.id)
    .order("scheduled_at", { ascending: true });

  // Gather related listing and profile data
  const listingIds = Array.from(
    new Set([
      ...(incoming?.map((b) => b.listing_id) ?? []),
      ...(outgoing?.map((b) => b.listing_id) ?? []),
    ])
  );
  const profileIds = Array.from(
    new Set([
      ...(incoming?.map((b) => b.customer_id) ?? []),
      ...(outgoing?.map((b) => b.creator_id) ?? []),
    ])
  );

  const [{ data: listings }, { data: profiles }] = await Promise.all([
    listingIds.length > 0
      ? supabase
          .from("listings")
          .select("id, title, listing_type, price")
          .in("id", listingIds)
      : { data: [] as { id: string; title: string; listing_type: string | null; price: number | null }[] },
    profileIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", profileIds)
      : { data: [] as { id: string; full_name: string | null }[] },
  ]);

  const listingMap: Record<string, string> = Object.fromEntries(
    (listings ?? []).map((l) => [l.id, l.title])
  );
  const listingMetaMap: Record<string, { listing_type: string | null; price: number | null }> = Object.fromEntries(
    (listings ?? []).map((l) => [l.id, {
      listing_type: (l as { listing_type?: string | null }).listing_type ?? null,
      price: (l as { price?: number | null }).price ?? null,
    }])
  );
  const profileMap = Object.fromEntries(
    (profiles ?? []).map((p) => [p.id, p.full_name || t("fallbackPersonName")])
  );

  // Fetch existing reviews for outgoing completed bookings
  const completedBookingIds = (outgoing ?? [])
    .filter((b) => b.status === "completed")
    .map((b) => b.id);
  let reviewedBookingIds = new Set<string>();
  if (completedBookingIds.length > 0) {
    const { data: existingReviews } = await supabase
      .from("reviews")
      .select("booking_id")
      .in("booking_id", completedBookingIds);
    reviewedBookingIds = new Set((existingReviews ?? []).map((r) => r.booking_id));
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("sv-SE", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Queue positions (as customer)
  const { data: queueEntries } = await supabase
    .from("booking_queue")
    .select("id, listing_id, position, created_at")
    .eq("user_id", user.id)
    .eq("auto_booked", false)
    .order("position", { ascending: true });

  // Fetch listing titles for queue entries
  const queueListingIds = (queueEntries ?? []).map((q) => q.listing_id).filter(
    (id) => !listingIds.includes(id)
  );
  if (queueListingIds.length > 0) {
    const { data: queueListings } = await supabase
      .from("listings")
      .select("id, title")
      .in("id", queueListingIds);
    for (const l of queueListings ?? []) {
      listingMap[l.id] = l.title;
    }
  }

  // Check if user is a creator and fetch availability
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, tier")
    .eq("id", user.id)
    .single();
  const userTier = profile?.tier ?? null;

  const userIsCreator = profile?.role === "creator" || profile?.role === "venue" || profile?.role === "creator" || profile?.role === "venue";

  let availableDates: string[] = [];
  if (userIsCreator) {
    const now = new Date();
    const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const lastDayNum = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const endOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(lastDayNum).padStart(2, "0")}`;
    const { data: availabilityData } = await supabase
      .from("creator_availability")
      .select("available_date")
      .eq("user_id", user.id)
      .gte("available_date", startOfMonth)
      .lte("available_date", endOfMonth);
    availableDates = (availabilityData || []).map((r) => r.available_date);
  }

  const hasIncoming = incoming && incoming.length > 0;
  const hasOutgoing = outgoing && outgoing.length > 0;
  const hasQueue = queueEntries && queueEntries.length > 0;

  // Build calendar data from all bookings
  const calendarBookings = [
    ...(incoming ?? []).map((b) => ({
      id: b.id,
      title: listingMap[b.listing_id] || t("fallbackServiceTitle"),
      status: b.status,
      scheduledAt: b.scheduled_at,
      personName: profileMap[b.customer_id] || t("fallbackPersonName"),
      type: "incoming" as const,
    })),
    ...(outgoing ?? []).map((b) => ({
      id: b.id,
      title: listingMap[b.listing_id] || t("fallbackServiceTitle"),
      status: b.status,
      scheduledAt: b.scheduled_at,
      personName: profileMap[b.creator_id] || t("fallbackPersonName"),
      type: "outgoing" as const,
    })),
  ];

  const listContent = (
    <>
      {/* Incoming bookings (as creator) */}
      <section className="mb-10">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
          <Calendar size={18} className="text-[var(--usha-gold)]" />
          {t("incomingHeading")}
        </h2>
        {!hasIncoming ? (
          <NoBookings />
        ) : (
          <div className="space-y-3">
            {incoming.map((booking) => {
              const status = STATUS_LABELS[booking.status] ?? STATUS_LABELS.pending;
              return (
                <div
                  key={booking.id}
                  className="flex flex-col gap-3 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="font-semibold">
                        {listingMap[booking.listing_id] || t("fallbackServiceTitle")}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}
                      >
                        {t(status.labelKey)}
                      </span>
                      {booking.amount_paid && booking.amount_paid > 0 && (
                        <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">
                          <CreditCard size={10} />
                          {t("paidBadge")}
                        </span>
                      )}
                      {(booking as { sessions_total?: number | null }).sessions_total != null &&
                        (booking as { sessions_total?: number | null }).sessions_total! > 0 && (
                          <DanceCounter
                            redeemed={(booking as { sessions_redeemed?: number | null }).sessions_redeemed ?? 0}
                            total={(booking as { sessions_total?: number | null }).sessions_total!}
                          />
                        )}
                      {(booking as { minutes_total?: number | null }).minutes_total != null &&
                        (booking as { minutes_total?: number | null }).minutes_total! > 0 && (
                          <MinutesCounter
                            redeemed={(booking as { minutes_redeemed?: number | null }).minutes_redeemed ?? 0}
                            total={(booking as { minutes_total?: number | null }).minutes_total!}
                          />
                        )}
                      {(booking as { agreed_price?: number | null }).agreed_price != null && (
                        <span className="rounded-full bg-[var(--usha-accent)]/10 px-2 py-0.5 text-xs font-medium text-[var(--usha-accent)]">
                          {t("compensation", { amount: (booking as { agreed_price?: number | null }).agreed_price ?? 0 })}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--usha-muted)]">
                      <span>{t("customerLabel", { name: profileMap[booking.customer_id] || t("fallbackPersonName") })}</span>
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {formatDate(booking.scheduled_at)}
                      </span>
                      {booking.guest_count > 1 && (
                        <span className="flex items-center gap-1">
                          <Users size={12} />
                          {t("guestCount", { count: booking.guest_count })}
                        </span>
                      )}
                    </div>
                    {booking.notes && (
                      <p className="mt-2 text-sm text-[var(--usha-muted)] italic">
                        &ldquo;{booking.notes}&rdquo;
                      </p>
                    )}
                    {booking.special_requests && (
                      <p className="mt-1 text-sm text-[var(--usha-gold)]/80 italic">
                        {t("specialRequests", { requests: booking.special_requests })}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {booking.status === "pending" && (
                      <>
                        <ConfirmButton bookingId={booking.id} />
                        <CancelButton
                          bookingId={booking.id}
                          isPaid={!!booking.amount_paid && booking.amount_paid > 0}
                          paidAmount={booking.amount_paid ?? null}
                        />
                      </>
                    )}
                    {booking.status === "confirmed" && (
                      <>
                        {(booking as { sessions_total?: number | null }).sessions_total != null &&
                          (booking as { sessions_total?: number | null }).sessions_total! > 0 && (
                            <RedeemSessionButton
                              bookingId={booking.id}
                              redeemed={(booking as { sessions_redeemed?: number | null }).sessions_redeemed ?? 0}
                              total={(booking as { sessions_total?: number | null }).sessions_total!}
                            />
                          )}
                        {(booking as { minutes_total?: number | null }).minutes_total != null &&
                          (booking as { minutes_total?: number | null }).minutes_total! > 0 && (
                            <RedeemMinutesButton
                              bookingId={booking.id}
                              redeemed={(booking as { minutes_redeemed?: number | null }).minutes_redeemed ?? 0}
                              total={(booking as { minutes_total?: number | null }).minutes_total!}
                            />
                          )}
                        <RescheduleButton bookingId={booking.id} currentDate={booking.scheduled_at} />
                        {/* Comp a paid service/b2b booking (free intro etc.) — hides
                            the customer's "Betala" button. Only while unpaid. */}
                        {!(booking as { stripe_payment_id?: string | null }).stripe_payment_id &&
                          (listingMetaMap[booking.listing_id]?.price ?? 0) > 0 &&
                          ["service", "b2b_offering"].includes(
                            listingMetaMap[booking.listing_id]?.listing_type ?? ""
                          ) && (
                            <FreeToggleButton
                              bookingId={booking.id}
                              isFree={!!(booking as { is_free?: boolean | null }).is_free}
                            />
                          )}
                        <CompleteButton bookingId={booking.id} />
                        <CancelButton
                          bookingId={booking.id}
                          isPaid={!!booking.amount_paid && booking.amount_paid > 0}
                          paidAmount={booking.amount_paid ?? null}
                        />
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Outgoing bookings (as customer) */}
      <section>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
          <Calendar size={18} className="text-[var(--usha-accent)]" />
          {t("myBookingsHeading")}
        </h2>
        {!hasOutgoing ? (
          <NoBookings />
        ) : (
          <div className="space-y-3">
            {outgoing.map((booking) => {
              const status = STATUS_LABELS[booking.status] ?? STATUS_LABELS.pending;
              return (
                <div
                  key={booking.id}
                  className="flex flex-col gap-3 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="font-semibold">
                        {listingMap[booking.listing_id] || t("fallbackServiceTitle")}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}
                      >
                        {t(status.labelKey)}
                      </span>
                      {(booking as { sessions_total?: number | null }).sessions_total != null &&
                        (booking as { sessions_total?: number | null }).sessions_total! > 0 && (
                          <DanceCounter
                            redeemed={(booking as { sessions_redeemed?: number | null }).sessions_redeemed ?? 0}
                            total={(booking as { sessions_total?: number | null }).sessions_total!}
                          />
                        )}
                      {(booking as { minutes_total?: number | null }).minutes_total != null &&
                        (booking as { minutes_total?: number | null }).minutes_total! > 0 && (
                          <MinutesCounter
                            redeemed={(booking as { minutes_redeemed?: number | null }).minutes_redeemed ?? 0}
                            total={(booking as { minutes_total?: number | null }).minutes_total!}
                          />
                        )}
                      {(booking as { agreed_price?: number | null }).agreed_price != null && (
                        <span className="rounded-full bg-[var(--usha-accent)]/10 px-2 py-0.5 text-xs font-medium text-[var(--usha-accent)]">
                          {t("compensation", { amount: (booking as { agreed_price?: number | null }).agreed_price ?? 0 })}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--usha-muted)]">
                      <span>{t("creatorLabel", { name: profileMap[booking.creator_id] || t("fallbackPersonName") })}</span>
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {formatDate(booking.scheduled_at)}
                      </span>
                    </div>
                    {booking.notes && (
                      <p className="mt-2 text-sm text-[var(--usha-muted)] italic">
                        &ldquo;{booking.notes}&rdquo;
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {booking.status === "confirmed" &&
                      ["b2b_offering", "service"].includes(
                        listingMetaMap[booking.listing_id]?.listing_type ?? ""
                      ) &&
                      !(booking as { stripe_payment_id?: string | null }).stripe_payment_id &&
                      (listingMetaMap[booking.listing_id]?.price ?? 0) > 0 && (
                        <PayB2BButton
                          bookingId={booking.id}
                          price={
                            (booking as { agreed_price?: number | null }).agreed_price ??
                            calculateDiscountedPrice(
                              listingMetaMap[booking.listing_id]?.price ?? 0,
                              userTier
                            )
                          }
                        />
                      )}
                    {(booking.status === "pending" ||
                      booking.status === "confirmed") && (
                      <>
                        <RescheduleButton bookingId={booking.id} currentDate={booking.scheduled_at} />
                        <CancelButton
                          bookingId={booking.id}
                          isPaid={!!(booking as { stripe_payment_id?: string | null }).stripe_payment_id}
                          paidAmount={(booking as { amount_paid?: number | null }).amount_paid ?? null}
                        />
                      </>
                    )}
                    {booking.status === "completed" &&
                      !reviewedBookingIds.has(booking.id) && (
                        <ReviewForm bookingId={booking.id} />
                      )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Queue positions */}
      {hasQueue && (
        <section className="mt-10">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
            <Users size={18} className="text-[var(--usha-gold)]" />
            {t("myQueueHeading")}
          </h2>
          <div className="space-y-3">
            {queueEntries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-4 rounded-xl border border-[var(--usha-gold)]/20 bg-[var(--usha-gold)]/5 p-5"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--usha-gold)]/10">
                  <span className="text-sm font-bold text-[var(--usha-gold)]">
                    #{entry.position}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <span className="font-semibold">
                    {listingMap[entry.listing_id] || t("fallbackServiceTitle")}
                  </span>
                  <p className="text-xs text-[var(--usha-muted)]">
                    {t("queueAutoBookNote")}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-[var(--usha-gold)]/10 px-3 py-1 text-xs font-medium text-[var(--usha-gold)]">
                  {t("queuePosition", { position: entry.position })}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );

  return (
    <>
      <div className="mb-8">
        <Link
          href="/dashboard"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--usha-muted)] transition-colors hover:text-[var(--usha-white)]"
        >
          <ArrowLeft size={14} />
          {t("back")}
        </Link>
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-[var(--usha-muted)]">
          {t("subtitle")}
        </p>
      </div>

      <BookingsViewToggle bookings={calendarBookings} listView={listContent} isCreator={userIsCreator} initialAvailableDates={availableDates} />
    </>
  );
}
