"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Users, CheckCircle2, Repeat, UserPlus, Download, Radio, Percent, UserX, Banknote, Gauge } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSubscription } from "@/lib/subscription/context";

interface Attendee {
  name: string;
  email: string | null;
  eventsCount: number;
  checkedIn: boolean;
  returning: boolean;
  bookingId: string;
}
interface Stats {
  event: { id: string; title: string; capacity: number | null; eventDate: string | null };
  bookings: number;
  attendees: number;
  checkedIn: number;
  returning: number;
  new: number;
  eventEnded: boolean;
  noShows: number | null;
  checkInRate: number | null;
  revenue: number;
  fillRate: number | null;
  list: Attendee[];
}

function csvEscape(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export default function EventStatsPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("eventStats");
  const { tier } = useSubscription();
  const [data, setData] = useState<Stats | null>(null);
  // Vem vi just nu checkar in. Knappen låses medan anropet pågår så att ett
  // dubbelklick inte blir två anrop.
  const [checkingIn, setCheckingIn] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${id}/stats`);
      if (!res.ok) {
        setError(t("errorFetch"));
        return;
      }
      setData(await res.json());
      setError(null);
    } catch {
      setError(t("errorConnection"));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  /**
   * Checka in någon i efterhand, från listan.
   *
   * Går mot samma endpoint som skannern i dörren, med samma behörighetskontroll
   * — ingen ny väg in i incheckningen, bara en andra knapp till den som redan
   * finns. Efter svaret hämtas statistiken om, så att både raden och siffrorna
   * längst upp stämmer.
   */
  const checkInManually = useCallback(
    async (bookingId: string) => {
      setCheckingIn(bookingId);
      try {
        const res = await fetch("/api/tickets/checkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId }),
        });
        if (res.ok) await fetchData();
        else setError(t("errorCheckIn"));
      } catch {
        setError(t("errorConnection"));
      } finally {
        setCheckingIn(null);
      }
    },
    [fetchData, t]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function exportCsv() {
    if (!data) return;
    const rows = [
      [t("csvName"), t("csvEmail"), t("csvStatus"), t("csvEventsCount"), t("csvType")],
      ...data.list.map((a) => [
        a.name,
        a.email ?? "",
        a.checkedIn ? t("csvStatusAttended") : t("csvStatusBooked"),
        String(a.eventsCount),
        a.returning ? t("typeReturning") : t("typeNew"),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => csvEscape(c)).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${t("csvFilePrefix")}-${(data.event.title || "event").replace(/[^\w-]+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (tier === "gratis") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
        <Radio size={48} className="mb-4 text-[var(--usha-gold)]" />
        <h2 className="mb-2 text-xl font-bold">{t("premiumFeatureTitle")}</h2>
        <Link href="/dashboard/billing" className="mt-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-6 py-3 text-sm font-bold text-black">
          {t("upgrade")}
        </Link>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--usha-gold)] border-t-transparent" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
        <p className="text-[var(--usha-muted)]">{error || t("notFound")}</p>
        <Link href="/app/events" className="mt-4 text-sm text-[var(--usha-gold)]">{t("toEvents")}</Link>
      </div>
    );
  }

  const cards = [
    { icon: Users, label: t("cardAttendees"), value: String(data.attendees) },
    { icon: CheckCircle2, label: t("cardCheckedIn"), value: String(data.checkedIn) },
    // Check-in-rate and no-show are only meaningful after the event has ended —
    // before then they'd read "0%" / a full house of "no-shows" for buyers who
    // simply haven't arrived yet.
    ...(data.checkInRate != null
      ? [{ icon: Percent, label: t("cardCheckInRate"), value: `${data.checkInRate}%` }]
      : []),
    ...(data.noShows != null
      ? [{ icon: UserX, label: t("cardNoShow"), value: String(data.noShows) }]
      : []),
    { icon: Repeat, label: t("cardReturning"), value: String(data.returning) },
    { icon: UserPlus, label: t("cardNew"), value: String(data.new) },
    { icon: Banknote, label: t("cardRevenue"), value: t("revenueValue", { amount: Math.round(data.revenue / 100).toLocaleString("sv-SE") }) },
    ...(data.fillRate != null
      ? [{ icon: Gauge, label: t("cardFillRate"), value: `${data.fillRate}%` }]
      : []),
  ];

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 space-y-6">
      <div>
        <Link href={`/app/events/${id}/edit`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-[var(--usha-muted)] transition-colors hover:text-[var(--usha-white)]">
          <ArrowLeft size={14} /> {t("back")}
        </Link>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        {/* Datumet, inte bara titeln. En serie har åtta kvällar med identisk
            titel; utan datum går det inte att se vilken av dem siffrorna
            gäller, och en tom statistik för 7 sep lästes som fel när live-vyn
            för 21 sep visade en såld biljett. API:et skickade datumet redan. */}
        <p className="mt-1 text-sm text-[var(--usha-muted)]">
          {data.event.title}
          {data.event.eventDate && (
            <>
              {" · "}
              {new Date(data.event.eventDate + "T00:00").toLocaleDateString("sv-SE", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </>
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4 text-center">
            <c.icon size={18} className="mx-auto mb-1 text-[var(--usha-gold)]" />
            <p className="text-xl font-bold">{c.value}</p>
            <p className="text-[10px] text-[var(--usha-muted)]">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--usha-border)] px-4 py-3">
          <h3 className="text-sm font-semibold">{t("attendeesHeader", { count: data.list.length })}</h3>
          {data.list.length > 0 && (
            <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--usha-border)] px-3 py-1.5 text-xs font-medium transition hover:border-[var(--usha-gold)]/50">
              <Download size={13} /> CSV
            </button>
          )}
        </div>
        {data.list.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[var(--usha-muted)]">{t("emptyAttendees")}</p>
        ) : (
          <div className="divide-y divide-[var(--usha-border)]">
            {data.list.map((a, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${a.checkedIn ? "bg-green-500/20 text-green-400" : "bg-[var(--usha-border)] text-[var(--usha-muted)]"}`}>
                  {a.checkedIn ? <CheckCircle2 size={16} /> : (a.name.charAt(0) || "?").toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--usha-white)]">{a.name}</p>
                  {a.email && <p className="truncate text-[11px] text-[var(--usha-muted)]">{a.email}</p>}
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-medium ${a.returning ? "bg-[var(--usha-gold)]/15 text-[var(--usha-gold)]" : "bg-[var(--usha-border)] text-[var(--usha-muted)]"}`}>
                  {a.returning ? t("returningBadge", { count: a.eventsCount }) : t("typeNew")}
                </span>
                {!a.checkedIn && (
                  <button
                    type="button"
                    onClick={() => checkInManually(a.bookingId)}
                    disabled={checkingIn === a.bookingId}
                    className="shrink-0 rounded-lg border border-[var(--usha-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--usha-muted)] transition hover:border-green-500/50 hover:text-green-400 disabled:opacity-40"
                  >
                    {checkingIn === a.bookingId ? t("checkingIn") : t("markAttended")}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
