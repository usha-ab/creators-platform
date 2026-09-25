"use client";

import TimeSelect from "@/components/time-select";
import { useState, useEffect } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, User, Clock, Calendar, Check, Plus, Trash2, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRole } from "@/components/mobile/role-context";
import { toggleAvailability, getAvailability, addTimeSlot, removeTimeSlot } from "./actions";

const EVENT_COLORS = [
  "border-l-[var(--usha-gold)]",
  "border-l-[var(--usha-accent)]",
  "border-l-emerald-400",
  "border-l-blue-400",
  "border-l-purple-400",
  "border-l-teal-400",
];

interface CalendarBooking {
  id: string;
  scheduled_at: string;
  status: string;
  /** Gästens namn, eller kundkontots namn. Null när bokningen saknar båda. */
  bookerName?: string | null;
  listings: { title: string } | null;
}

interface CalendarContentProps {
  bookings: CalendarBooking[];
  initialAvailableDates?: string[];
  isCreator?: boolean;
}

export function CalendarContent({ bookings, initialAvailableDates = [], isCreator = false }: CalendarContentProps) {
  const t = useTranslations("calendarPage");
  const ta = useTranslations("a11y");
  const DAYS = [
    t("dayMon"), t("dayTue"), t("dayWed"), t("dayThu"), t("dayFri"), t("daySat"), t("daySun"),
  ];
  const MONTHS = [
    t("monthJan"), t("monthFeb"), t("monthMar"), t("monthApr"), t("monthMay"), t("monthJun"),
    t("monthJul"), t("monthAug"), t("monthSep"), t("monthOct"), t("monthNov"), t("monthDec"),
  ];
  const { role } = useRole();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [availableSet, setAvailableSet] = useState<Set<string>>(new Set(initialAvailableDates));
  const [slotsMap, setSlotsMap] = useState<Record<string, { id: string; start_time: string | null; end_time: string | null }[]>>({});
  // Två lägen i stället för ett: "markera" väljer dagar och öppnar tidspanelen,
  // "avmarkera" tar bort tillgängligheten direkt på den dag man trycker på.
  // Borttagning låg tidigare gömd i panelen och hittades inte.
  const [mode, setMode] = useState<"mark" | "unmark" | null>(null);
  const editMode = mode !== null;
  // Flera datum kan redigeras samtidigt: att lägga samma tid på hela veckan
  // var annars ett klick per dag. Ett ensamt valt datum beter sig exakt som
  // förut, så den vanliga vägen blir inte krångligare av att flera är möjliga.
  const [editingDates, setEditingDates] = useState<string[]>([]);

  const showCreatorTools = isCreator || role === "creator" || role === "venue";

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDayOfWeek = (firstDay.getDay() + 6) % 7;

  // Fetch availability when month changes
  useEffect(() => {
    if (!showCreatorTools) return;
    getAvailability(year, month + 1).then(({ dates, slots }) => {
      setAvailableSet(new Set(dates));
      setSlotsMap(slots || {});
    });
  }, [year, month, showCreatorTools]);

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  const days: (number | null)[] = [];
  for (let i = 0; i < startDayOfWeek; i++) days.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) days.push(d);

  const getDateKey = (day: number) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // Transform bookings into date-keyed events
  // Fältet hette tidigare "location" men innehöll status, vilket ritade en
  // kartnål bredvid ordet "Bekräftad".
  const eventsByDate: Record<
    string,
    { title: string; time: string; status: string; booker: string | null; color: string }[]
  > = {};
  bookings.forEach((booking, i) => {
    const date = new Date(booking.scheduled_at);
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const timeStr = date.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
    const event = {
      title: booking.listings?.title || t("bookingFallbackTitle"),
      time: timeStr,
      status: booking.status === "confirmed" ? t("statusConfirmed") : t("statusPending"),
      booker: booking.bookerName ?? null,
      color: EVENT_COLORS[i % EVENT_COLORS.length],
    };
    if (!eventsByDate[dateKey]) eventsByDate[dateKey] = [];
    eventsByDate[dateKey].push(event);
  });

  const hasEvents = (day: number) => !!eventsByDate[getDateKey(day)];

  const selectedEvents = selectedDate ? eventsByDate[selectedDate] || [] : [];

  // Rubriken lovar "kommande", så listan visar bara framtiden. Passerade
  // bokningar finns kvar i rutnätet ovan, som går att bläddra bakåt i.
  const todayKey = new Date().toISOString().slice(0, 10);

  const allUpcoming = Object.entries(eventsByDate)
    .filter(([date]) => date >= todayKey)
    .flatMap(([date, events]) => events.map((e) => ({ ...e, date })))
    .sort((a, b) => a.date.localeCompare(b.date));

  const today = new Date();
  const isToday = (day: number) =>
    day === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  const isPast = (day: number) => {
    const d = new Date(year, month, day);
    d.setHours(23, 59, 59);
    return d < today;
  };

  function handleDayClick(day: number) {
    const dateKey = getDateKey(day);

    if (mode === "unmark" && showCreatorTools && !isPast(day)) {
      if (!availableSet.has(dateKey)) return;
      // Optimistiskt: dagen bleknar direkt, servern får hinna ikapp. Misslyckas
      // den kommer dagen tillbaka när månaden läses om.
      setAvailableSet((prev) => {
        const next = new Set(prev);
        next.delete(dateKey);
        return next;
      });
      void (async () => {
        await toggleAvailability(dateKey);
        const res = await getAvailability(year, month + 1);
        setSlotsMap(res.slots || {});
        setAvailableSet(new Set(res.dates));
      })();
    } else if (mode === "mark" && showCreatorTools && !isPast(day)) {
      // Toggle this date in the selection
      setEditingDates((prev) =>
        prev.includes(dateKey) ? prev.filter((d) => d !== dateKey) : [...prev, dateKey]
      );
    } else {
      setSelectedDate(selectedDate === dateKey ? null : dateKey);
    }
  }

  /**
   * Toggle all-day availability across the selection. With several dates the
   * per-date state may differ, so the first date decides the direction and the
   * rest are brought into line — otherwise the button would flip some days on
   * and others off, which reads as a bug.
   */
  async function handleToggleAllDay(dateKeys: string[]) {
    if (!dateKeys.length) return;
    const turningOn = !availableSet.has(dateKeys[0]);

    for (const dateKey of dateKeys) {
      // Already in the target state — toggling would undo it.
      if (availableSet.has(dateKey) === turningOn) continue;
      await toggleAvailability(dateKey);
    }

    const res = await getAvailability(year, month + 1);
    setSlotsMap(res.slots || {});
    setAvailableSet(new Set(res.dates));
  }

  /**
   * Add the same slot to every selected date. Runs sequentially rather than in
   * parallel: addTimeSlot reads the day's existing slots to reject overlaps, and
   * concurrent writes to the same day would race that check. The refresh happens
   * once at the end instead of per date.
   *
   * A per-date failure (an overlap, say) is reported but does not abort the
   * rest — one bad day should not silently drop the other nine.
   */
  async function handleAddSlot(dateKeys: string[], startTime: string, endTime: string) {
    const failures: string[] = [];

    for (const dateKey of dateKeys) {
      const result = await addTimeSlot(dateKey, startTime, endTime);
      if (result.error) failures.push(`${dateKey.slice(8)}/${dateKey.slice(5, 7)}: ${result.error}`);
    }

    const res = await getAvailability(year, month + 1);
    setSlotsMap(res.slots || {});
    setAvailableSet(new Set(res.dates));

    return failures.length ? failures.join(" · ") : null;
  }

  async function handleRemoveSlot(slotId: string) {
    await removeTimeSlot(slotId);
    const res = await getAvailability(year, month + 1);
    setSlotsMap(res.slots || {});
    setAvailableSet(new Set(res.dates));
  }

  return (
    <div className="space-y-6">
      {/* Availability toggle for creators */}
      {showCreatorTools && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              setEditingDates([]);
              setMode(mode === "mark" ? null : "mark");
            }}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition ${
              mode === "mark"
                ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30"
                : "bg-[var(--usha-card)] text-[var(--usha-muted)] ring-1 ring-[var(--usha-border)] hover:text-[var(--usha-white)]"
            }`}
          >
            <Check size={16} />
            {mode === "mark" ? t("availabilityDone") : t("availabilityMark")}
          </button>
          <button
            onClick={() => {
              setEditingDates([]);
              setMode(mode === "unmark" ? null : "unmark");
            }}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition ${
              mode === "unmark"
                ? "bg-red-500/20 text-red-400 ring-1 ring-red-500/30"
                : "bg-[var(--usha-card)] text-[var(--usha-muted)] ring-1 ring-[var(--usha-border)] hover:text-[var(--usha-white)]"
            }`}
          >
            <X size={16} />
            {mode === "unmark" ? t("availabilityDone") : t("availabilityUnmark")}
          </button>
        </div>
      )}

      {mode === "mark" && (
        <p className="text-xs text-emerald-400/70">
          {t("availabilityHint")} {t("availabilityHintMulti")}
        </p>
      )}
      {mode === "unmark" && (
        <p className="text-xs text-red-400/80">{t("availabilityUnmarkHint")}</p>
      )}

      {/* Calendar */}
      <div className="rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4">
        <div className="mb-4 flex items-center justify-between">
          <button onClick={prevMonth} aria-label={ta("prevMonth")} className="rounded-lg p-2 hover:bg-[var(--usha-card-hover)]">
            <ChevronLeft size={18} className="text-[var(--usha-muted)]" />
          </button>
          <h2 className="text-base font-semibold">
            {MONTHS[month]} {year}
          </h2>
          <button onClick={nextMonth} aria-label={ta("nextMonth")} className="rounded-lg p-2 hover:bg-[var(--usha-card-hover)]">
            <ChevronRight size={18} className="text-[var(--usha-muted)]" />
          </button>
        </div>

        {/* Day headers */}
        <div className="mb-2 grid grid-cols-7 gap-1">
          {DAYS.map((d) => (
            <div key={d} className="text-center text-[10px] font-medium text-[var(--usha-muted)]">
              {d}
            </div>
          ))}
        </div>

        {/* Days grid */}
        <div className="grid grid-cols-7 gap-1">
          {days.map((day, i) => {
            if (day === null) return <div key={`empty-${i}`} />;
            const dateKey = getDateKey(day);
            const isSelected = selectedDate === dateKey;
            const todayDay = isToday(day);
            const eventDay = hasEvents(day);
            const isAvailable = availableSet.has(dateKey);
            const past = isPast(day);
            const isEditing = editMode && editingDates.includes(dateKey);

            return (
              <button
                key={day}
                onClick={() => handleDayClick(day)}
                disabled={editMode && (past || (mode === "unmark" && !isAvailable))}
                className={`relative flex h-10 flex-col items-center justify-center rounded-lg text-sm transition-all ${
                  isEditing
                    ? "bg-emerald-500/30 font-bold text-emerald-200 ring-2 ring-emerald-400"
                    : isSelected && !editMode
                    ? "bg-gradient-to-br from-[var(--usha-gold)] to-[var(--usha-accent)] font-bold text-black"
                    : isAvailable && !isSelected
                      ? "bg-emerald-500/15 font-medium text-emerald-400 ring-1 ring-emerald-500/25"
                      : todayDay
                        ? "bg-[var(--usha-gold)]/10 font-semibold text-[var(--usha-gold)]"
                        : editMode && (past || mode === "unmark")
                          ? "text-[var(--usha-muted)]/30 cursor-not-allowed"
                          : "hover:bg-[var(--usha-card-hover)]"
                }`}
              >
                {day}
                {/* Event dot */}
                {eventDay && !isSelected && (
                  <div className="absolute bottom-1 flex gap-0.5">
                    <div className="h-1 w-1 rounded-full bg-[var(--usha-gold)]" />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Time Slot Editor */}
        {mode === "mark" && editingDates.length > 0 && (
          <TimeSlotEditor
            dateKeys={editingDates}
            slots={editingDates.length === 1 ? slotsMap[editingDates[0]] || [] : []}
            onToggleAllDay={() => handleToggleAllDay(editingDates)}
            onAddSlot={(s, e) => handleAddSlot(editingDates, s, e)}
            onRemoveSlot={handleRemoveSlot}
            onClear={() => setEditingDates([])}
            isAvailable={availableSet.has(editingDates[0])}
          />
        )}

        {/* Legend */}
        <div className="mt-4 flex flex-wrap items-center gap-4 text-[10px] text-[var(--usha-muted)]">
          <span className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-[var(--usha-gold)]" /> {t("legendBooking")}
          </span>
          {showCreatorTools && (
            <span className="flex items-center gap-1">
              <div className="h-2 w-2 rounded-full bg-emerald-400" /> {t("legendAvailable")}
            </span>
          )}
        </div>
      </div>

      {/* Selected date events */}
      {selectedDate && selectedEvents.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-[var(--usha-muted)]">
            {selectedDate.split("-").reverse().join("/")}
          </h3>
          <div className="space-y-3 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
            {selectedEvents.map((event, i) => (
              <Link
                key={i}
                href="/dashboard/bookings"
                className={`block rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4 border-l-4 transition hover:border-[var(--usha-gold)]/30 ${event.color}`}
              >
                <h3 className="text-sm font-semibold">{event.title}</h3>
                <div className="mt-2 flex items-center gap-3 text-xs text-[var(--usha-muted)]">
                  <span className="flex items-center gap-1">
                    <Clock size={10} />
                    {event.time}
                  </span>
                  <span className="flex items-center gap-1">
                    <Check size={10} />
                    {event.status}
                  </span>
                  {event.booker && (
                    <span className="flex items-center gap-1 truncate">
                      <User size={10} className="shrink-0" />
                      {event.booker}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Upcoming events */}
      <section>
        <h2 className="mb-4 text-lg font-bold">{t("upcomingBookings")}</h2>
        <div className="space-y-3 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
          {allUpcoming.length > 0 ? allUpcoming.map((event, i) => (
            <Link
              key={i}
              href="/dashboard/bookings"
              className={`block rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4 border-l-4 transition hover:border-[var(--usha-gold)]/30 ${event.color}`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold">{event.title}</h3>
                  <div className="mt-1 flex items-center gap-3 text-xs text-[var(--usha-muted)]">
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      {event.time}
                    </span>
                    <span className="flex items-center gap-1">
                      <Check size={10} />
                      {event.status}
                    </span>
                    {event.booker && (
                      <span className="flex items-center gap-1 truncate">
                        <User size={10} className="shrink-0" />
                        {event.booker}
                      </span>
                    )}
                  </div>
                </div>
                <span className="rounded-full bg-[var(--usha-gold)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--usha-gold)]">
                  {event.date.split("-").slice(1).reverse().join("/")}
                </span>
              </div>
            </Link>
          )) : (
            <div className="col-span-full flex flex-col items-center justify-center rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] py-12">
              <Calendar size={32} className="mb-3 text-[var(--usha-muted)]" />
              <p className="text-sm text-[var(--usha-muted)]">{t("noUpcomingBookings")}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ─── Time Slot Editor ───

function TimeSlotEditor({
  dateKeys,
  slots,
  onToggleAllDay,
  onAddSlot,
  onRemoveSlot,
  onClear,
  isAvailable,
}: {
  dateKeys: string[];
  slots: { id: string; start_time: string | null; end_time: string | null }[];
  onToggleAllDay: () => void;
  onAddSlot: (startTime: string, endTime: string) => Promise<string | null>;
  onRemoveSlot: (slotId: string) => void;
  onClear: () => void;
  isAvailable: boolean;
}) {
  const t = useTranslations("calendarPage");
  const ta = useTranslations("a11y");
  const [newStart, setNewStart] = useState("09:00");
  const [newEnd, setNewEnd] = useState("17:00");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const multi = dateKeys.length > 1;
  const dateLabel = multi
    ? t("daysSelected", { count: dateKeys.length })
    : new Date(dateKeys[0]).toLocaleDateString("sv-SE", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });

  const isAllDay = slots.length === 1 && !slots[0].start_time && !slots[0].end_time;
  const hasSpecificSlots = slots.some((s) => s.start_time !== null);

  async function handleAdd() {
    setAdding(true);
    setError("");
    const err = await onAddSlot(newStart, newEnd);
    if (err) setError(err);
    setAdding(false);
  }

  return (
    <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h4 className={`text-sm font-semibold ${multi ? "" : "capitalize"}`}>{dateLabel}</h4>{/* capitalize finns för att versalisera veckodagen i ett datum;
            på antalsetiketten gav den "3 Dagar Valda". */}
        {multi && (
          <button
            onClick={onClear}
            className="rounded px-2 py-0.5 text-[10px] font-medium text-[var(--usha-muted)] transition hover:text-[var(--usha-white)]"
          >
            {t("clearSelection")}
          </button>
        )}
      </div>

      {/* All-day toggle. Knappen säger vad den GÖR, inte vilket läge dagen är i:
          "Hela dagen (aktiv)" läste som en statusetikett, så den enda vägen att
          avmarkera en grön dag såg ut att vara ur funktion. */}
      <button
        onClick={onToggleAllDay}
        className={`mb-3 flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
          isAvailable
            ? "bg-red-500/10 text-red-400 hover:bg-red-500/20"
            : "bg-[var(--usha-card)] text-[var(--usha-muted)] hover:text-emerald-400"
        }`}
      >
        {isAvailable ? <X size={12} /> : <Check size={12} />}
        {!isAvailable ? t("markAllDay") : isAllDay ? t("removeAllDay") : t("removeAllTimes")}
      </button>

      {/* Existing slots */}
      {!multi && hasSpecificSlots && (
        <div className="mb-3 space-y-1.5">
          {slots.filter((s) => s.start_time).map((slot) => (
            <div key={slot.id} className="flex items-center justify-between rounded-lg bg-[var(--usha-card)] px-3 py-2">
              <span className="text-xs font-medium text-emerald-400">
                {slot.start_time?.slice(0, 5)} – {slot.end_time?.slice(0, 5)}
              </span>
              <button
                onClick={() => onRemoveSlot(slot.id)}
                aria-label={ta("removeTimeSlot")}
                className="rounded p-1 text-[var(--usha-muted)] hover:text-red-400"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add new slot */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="mb-1 block text-[10px] text-[var(--usha-muted)]">{t("startTime")}</label>
          <TimeSelect compact value={newStart} onChange={setNewStart} />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-[10px] text-[var(--usha-muted)]">{t("endTime")}</label>
          <TimeSelect compact value={newEnd} onChange={setNewEnd} />
        </div>
        <button
          onClick={handleAdd}
          disabled={adding}
          className="flex items-center gap-1 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-400 transition hover:bg-emerald-500/30 disabled:opacity-50"
        >
          {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          {multi ? t("addToDays", { count: dateKeys.length }) : t("add")}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
