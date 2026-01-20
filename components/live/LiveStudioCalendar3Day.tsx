"use client";

import Image from "next/image";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { TASK_OPTIONS, type StudioTask } from "./liveStudioOptions";

export type StudioBooking = {
  id: string;
  start: Date;
  end: Date;
  task: StudioTask;
};

type LiveStudioCalendar3DayProps = {
  booking: StudioBooking | null;
  onCreateBooking: (booking: StudioBooking) => boolean;
  onBlockedBooking?: () => void;
  notice?: string | null;
  user?: {
    name?: string | null;
    email?: string | null;
    avatarUrl?: string | null;
  };
  settings: {
    durationMinutes: number;
    task: StudioTask;
  };
  focusSignal?: number;
};

const SLOT_MINUTES = 15;
const START_HOUR = 0;
const END_HOUR = 24;
const SLOT_HEIGHT = 22;
const MAX_DURATION_MINUTES = 120;
const HOUR_LINE_THICKNESS = 1.5;
const QUARTER_LINE_THICKNESS = 1;
const TIME_GUTTER_WIDTH = 68;
const TIME_GUTTER_PADDING = 12;
const DAY_SEPARATOR_THICKNESS = 1;
const HOUR_LABEL_OFFSET = -2;
const QUARTER_LABEL_OFFSET = -1;

type DragState = {
  dayIndex: number;
  startSlot: number;
  currentSlot: number;
  hasMoved: boolean;
};

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatMonthYear(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatWeekday(date: Date) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
}

function formatHourLabel(hour: number) {
  const hour12 = hour % 12 || 12;
  const suffix = hour >= 12 ? "pm" : "am";
  return `${hour12}${suffix}`;
}

function formatTimeCompact(date: Date) {
  const hour = date.getHours();
  const hour12 = hour % 12 || 12;
  const suffix = hour >= 12 ? "p" : "a";
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hour12}:${minutes}${suffix}`;
}

function getTimezoneLabel() {
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  if (minutes === 0) {
    return `${sign}${String(hours).padStart(2, "0")}`;
  }
  return `${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0",
  )}`;
}

function initialsFromUser(name?: string | null, email?: string | null) {
  if (name) {
    const parts = name.trim().split(/\s+/);
    const letters = parts.slice(0, 2).map((part) => part[0]?.toUpperCase());
    return letters.join("") || "U";
  }
  if (email) {
    return email.trim().slice(0, 1).toUpperCase() || "U";
  }
  return "U";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export default function LiveStudioCalendar3Day({
  booking,
  onCreateBooking,
  onBlockedBooking,
  notice,
  user,
  settings,
  focusSignal,
}: LiveStudioCalendar3DayProps) {
  const totalSlots = ((END_HOUR - START_HOUR) * 60) / SLOT_MINUTES;
  const totalHeight = totalSlots * SLOT_HEIGHT;
  const maxSlots = MAX_DURATION_MINUTES / SLOT_MINUTES;
  const defaultSlots = Math.max(1, Math.round(settings.durationMinutes / 15));

  const [startDate, setStartDate] = useState(() => startOfDay(new Date()));
  const [now, setNow] = useState(() => new Date());
  const [dragging, setDragging] = useState<DragState | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const columnRefs = useRef<Array<HTMLDivElement | null>>([]);

  const days = useMemo(
    () => [0, 1, 2].map((offset) => addDays(startDate, offset)),
    [startDate],
  );

  const bookingDayIndex = useMemo(() => {
    if (!booking) return null;
    const bookingDay = startOfDay(booking.start);
    const diffMs = bookingDay.getTime() - startDate.getTime();
    const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
    return diffDays >= 0 && diffDays < 3 ? diffDays : null;
  }, [booking, startDate]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const current = new Date();
    const minutes = current.getHours() * 60 + current.getMinutes();
    const scrollTop = clamp(
      (minutes / SLOT_MINUTES) * SLOT_HEIGHT - 200,
      0,
      totalHeight,
    );
    scrollEl.scrollTo({ top: scrollTop, behavior: "smooth" });
  }, [focusSignal, totalHeight]);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const current = new Date();
    const minutes = current.getHours() * 60 + current.getMinutes();
    const scrollTop = clamp(
      (minutes / SLOT_MINUTES) * SLOT_HEIGHT - 200,
      0,
      totalHeight,
    );
    scrollEl.scrollTop = scrollTop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleShift(daysToShift: number) {
    setStartDate((prev) => addDays(prev, daysToShift));
  }

  const resolveRange = useCallback(
    (state: DragState) => {
      let startSlot = state.startSlot;
      let endSlot = state.currentSlot;

      if (!state.hasMoved) {
        endSlot = startSlot + defaultSlots - 1;
      } else {
        startSlot = Math.min(state.startSlot, state.currentSlot);
        endSlot = Math.max(state.startSlot, state.currentSlot);
      }

      if (endSlot - startSlot + 1 > maxSlots) {
        endSlot = startSlot + maxSlots - 1;
      }

      if (endSlot > totalSlots - 1) {
        endSlot = totalSlots - 1;
        startSlot = Math.max(0, endSlot - maxSlots + 1);
      }

      return { startSlot, endSlot };
    },
    [defaultSlots, maxSlots, totalSlots],
  );

  const slotToDate = useCallback((day: Date, slot: number) => {
    const minutes = slot * SLOT_MINUTES;
    const next = new Date(day);
    next.setHours(START_HOUR + Math.floor(minutes / 60), minutes % 60, 0, 0);
    return next;
  }, []);

  const getSlotFromClientY = useCallback(
    (clientY: number, dayIndex: number) => {
      const column = columnRefs.current[dayIndex];
      if (!column) return null;
      const rect = column.getBoundingClientRect();
      const y = clamp(clientY - rect.top, 0, totalHeight - 1);
      return Math.floor(y / SLOT_HEIGHT);
    },
    [totalHeight],
  );

  function handleMouseDown(dayIndex: number, event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if (booking) {
      onBlockedBooking?.();
      return;
    }
    const slot = getSlotFromClientY(event.clientY, dayIndex);
    if (slot === null) return;
    event.preventDefault();
    setDragging({
      dayIndex,
      startSlot: slot,
      currentSlot: slot,
      hasMoved: false,
    });
  }

  useEffect(() => {
    if (!dragging) return;
    const dragSnapshot = dragging;

    function handleMove(event: MouseEvent) {
      const slot = getSlotFromClientY(event.clientY, dragSnapshot.dayIndex);
      if (slot === null) return;
      setDragging((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          currentSlot: slot,
          hasMoved: prev.hasMoved || slot !== prev.startSlot,
        };
      });
    }

    function handleUp() {
      const range = resolveRange(dragSnapshot);
      const day = days[dragSnapshot.dayIndex];
      const start = slotToDate(day, range.startSlot);
      const end = slotToDate(day, range.endSlot + 1);
      onCreateBooking({
        id: `booking-${start.getTime()}`,
        start,
        end,
        task: settings.task,
      });
      setDragging(null);
    }

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [
    days,
    dragging,
    getSlotFromClientY,
    onCreateBooking,
    resolveRange,
    settings.durationMinutes,
    settings.task,
    slotToDate,
  ]);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowTop = (nowMinutes / SLOT_MINUTES) * SLOT_HEIGHT;
  const isTodayVisible = days.some(
    (day) => day.getTime() === startOfDay(new Date()).getTime(),
  );

  const previewRange = dragging ? resolveRange(dragging) : null;
  const previewDayIndex = dragging?.dayIndex ?? null;

  const calendarVars = useMemo(
    () =>
      ({
        "--studio-slot-height": `${SLOT_HEIGHT}px`,
        "--studio-hour-line": `${HOUR_LINE_THICKNESS}px`,
        "--studio-quarter-line": `${QUARTER_LINE_THICKNESS}px`,
        "--studio-time-gutter-width": `${TIME_GUTTER_WIDTH}px`,
        "--studio-time-gutter-padding": `${TIME_GUTTER_PADDING}px`,
        "--studio-day-separator-width": `${DAY_SEPARATOR_THICKNESS}px`,
      }) as CSSProperties,
    [],
  );

  const daySeparatorStyle: CSSProperties = {
    borderLeftWidth: "var(--studio-day-separator-width)",
    borderLeftColor: "var(--studio-grid-strong)",
    borderLeftStyle: "solid",
  };


  return (
    <section
      className="rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-card)] shadow-[0_20px_60px_rgba(15,23,42,0.08)]"
      style={calendarVars}
    >
      <div className="flex flex-col gap-3 border-b border-[var(--studio-border)] px-4 pb-4 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)] px-3 py-2 text-sm font-semibold text-[var(--studio-text)]"
          >
            {formatMonthYear(startDate)}
            <ChevronDown className="h-4 w-4 text-[var(--studio-muted)]" />
          </button>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)] px-3 py-2 text-sm font-semibold text-[var(--studio-text)]"
            >
              3 days
              <ChevronDown className="h-4 w-4 text-[var(--studio-muted)]" />
            </button>

            <div className="flex items-center overflow-hidden rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)]">
              <button
                type="button"
                onClick={() => handleShift(-3)}
                className="flex h-9 w-9 items-center justify-center text-[var(--studio-muted)] hover:text-[var(--studio-text)]"
                aria-label="Previous days"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setStartDate(startOfDay(new Date()))}
                className="px-4 text-sm font-semibold text-[var(--studio-text)]"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => handleShift(3)}
                className="flex h-9 w-9 items-center justify-center text-[var(--studio-muted)] hover:text-[var(--studio-text)]"
                aria-label="Next days"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {notice ? (
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-500">
            {notice}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-[var(--studio-time-gutter-width)_1fr] border-b border-[var(--studio-border)] bg-[var(--studio-card)] text-[13px] text-[var(--studio-muted)]">
        <div
          className="py-3 text-[11px] font-semibold"
          style={{
            paddingLeft: "var(--studio-time-gutter-padding)",
            paddingRight: "var(--studio-time-gutter-padding)",
          }}
        >
          {getTimezoneLabel()}
        </div>
        <div className="grid grid-cols-3">
          {days.map((day) => (
            <div
              key={day.toISOString()}
              className="px-4 py-3 text-sm font-semibold text-[var(--studio-text)]"
              style={daySeparatorStyle}
            >
              <span className="text-[var(--studio-muted)]">
                {formatWeekday(day)}
              </span>{" "}
              {day.getDate()}
            </div>
          ))}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="grid max-h-[70vh] grid-cols-[var(--studio-time-gutter-width)_1fr] overflow-y-auto"
      >
        <div
          className="relative bg-[var(--studio-panel)]"
          style={{ height: totalHeight }}
        >
          {Array.from({ length: totalSlots }).map((_, slot) => {
            const hour = Math.floor((slot * SLOT_MINUTES) / 60);
            const minutes = (slot * SLOT_MINUTES) % 60;
            const isHour = minutes === 0;
            const label = isHour ? formatHourLabel(hour) : `:${minutes}`;
            return (
              <div
                key={slot}
                className="flex items-start text-[11px]"
                style={{
                  height: SLOT_HEIGHT,
                  paddingLeft: "var(--studio-time-gutter-padding)",
                }}
              >
                <span
                  className={
                    isHour
                      ? "text-[12px] font-semibold leading-none text-[var(--studio-text)]"
                      : "text-[10px] leading-none text-[var(--studio-subtle)]"
                  }
                  style={{
                    transform: `translateY(${
                      isHour ? HOUR_LABEL_OFFSET : QUARTER_LABEL_OFFSET
                    }px)`,
                  }}
                >
                  {label}
                </span>
              </div>
            );
          })}

          {isTodayVisible ? (
            <div
              className="absolute flex items-center gap-2"
              style={{
                top: nowTop - 8,
                left: "var(--studio-time-gutter-padding)",
              }}
            >
              <span className="rounded-full bg-[var(--studio-card)] px-2 py-0.5 text-[10px] font-semibold text-rose-500 shadow-sm">
                {formatTimeCompact(now)}
              </span>
            </div>
          ) : null}
        </div>

        <div className="relative grid grid-cols-3">
          {days.map((day, dayIndex) => (
            <div
              key={day.toISOString()}
              ref={(node) => {
                columnRefs.current[dayIndex] = node;
              }}
              onMouseDown={(event) => handleMouseDown(dayIndex, event)}
              className="relative select-none bg-[var(--studio-card)]"
              style={{
                height: totalHeight,
                backgroundImage:
                  "linear-gradient(to bottom, var(--studio-grid-strong) 0, var(--studio-grid-strong) var(--studio-hour-line), transparent var(--studio-hour-line), transparent 100%), linear-gradient(to bottom, var(--studio-grid) 0, var(--studio-grid) var(--studio-quarter-line), transparent var(--studio-quarter-line), transparent 100%)",
                backgroundSize:
                  "100% calc(var(--studio-slot-height) * 4), 100% var(--studio-slot-height)",
                ...daySeparatorStyle,
              }}
            >
              {booking && bookingDayIndex === dayIndex ? (
                <CalendarBlock
                  start={booking.start}
                  end={booking.end}
                  user={user}
                  task={booking.task}
                  slotHeight={SLOT_HEIGHT}
                  totalSlots={totalSlots}
                />
              ) : null}

              {previewRange && previewDayIndex === dayIndex ? (
                <CalendarBlock
                  start={slotToDate(day, previewRange.startSlot)}
                  end={slotToDate(day, previewRange.endSlot + 1)}
                  user={user}
                  task={settings.task}
                  slotHeight={SLOT_HEIGHT}
                  totalSlots={totalSlots}
                  isDraft
                />
              ) : null}
            </div>
          ))}

          {isTodayVisible ? (
            <div
              className="pointer-events-none absolute left-0 right-0 h-px bg-rose-500"
              style={{ top: nowTop }}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

type CalendarBlockProps = {
  start: Date;
  end: Date;
  task: StudioTask;
  user?: {
    name?: string | null;
    email?: string | null;
    avatarUrl?: string | null;
  };
  slotHeight: number;
  totalSlots: number;
  isDraft?: boolean;
};

function CalendarBlock({
  start,
  end,
  task,
  user,
  slotHeight,
  totalSlots,
  isDraft = false,
}: CalendarBlockProps) {
  const taskOption = TASK_OPTIONS.find((option) => option.value === task);
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const durationMinutes = Math.max(
    SLOT_MINUTES,
    Math.round((end.getTime() - start.getTime()) / 60000),
  );
  const startSlot = Math.round(startMinutes / SLOT_MINUTES);
  const durationSlots = Math.min(
    totalSlots,
    Math.max(1, Math.round(durationMinutes / SLOT_MINUTES)),
  );
  const height = Math.max(slotHeight, durationSlots * slotHeight);
  const top = startSlot * slotHeight;
  const initials = initialsFromUser(user?.name, user?.email);

  return (
    <div
      className="pointer-events-none absolute left-2 right-2 rounded-2xl border border-[var(--studio-booking-border)] bg-[var(--studio-booking-bg)] px-2 py-2 text-xs text-[var(--studio-booking-text)] shadow-[0_12px_26px_rgba(15,23,42,0.12)]"
      style={{ top, height }}
    >
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-[var(--studio-card)] shadow-sm">
          {user?.avatarUrl ? (
            <Image
              src={user.avatarUrl}
              alt="Booked session avatar"
              width={28}
              height={28}
              className="h-7 w-7 rounded-full object-cover"
            />
          ) : (
            <span className="text-[10px] font-semibold">{initials}</span>
          )}
        </div>
        <div className="flex flex-col">
          <span className="font-semibold text-[var(--studio-booking-text)]">
            {taskOption?.label ?? "Session"}
          </span>
          <span className="text-[10px] text-[var(--studio-booking-muted)]">
            {formatTimeCompact(start)} - {formatTimeCompact(end)}
          </span>
        </div>
      </div>
      {isDraft ? (
        <div className="mt-1 text-[10px] font-semibold text-[var(--studio-accent)]">
          Draft session
        </div>
      ) : null}
    </div>
  );
}
