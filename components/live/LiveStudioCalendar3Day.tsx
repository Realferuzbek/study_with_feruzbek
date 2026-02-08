"use client";

import Image from "next/image";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { TASK_OPTIONS, type StudioTask } from "./liveStudioOptions";

export type StudioBookingStatus =
  | "scheduled"
  | "active"
  | "cancelled"
  | "completed";

export type StudioBooking = {
  id: string;
  start: Date;
  end: Date;
  task: StudioTask;
  hostId?: string | null;
  hostDisplayName?: string | null;
  roomId?: string | null;
  participantCount?: number;
  maxParticipants?: number;
  isParticipant?: boolean;
  myRole?: string | null;
  status?: StudioBookingStatus | string;
  isOptimistic?: boolean;
};

export type StudioSelectionRange = {
  start: Date;
  end: Date;
};

type LiveStudioCalendar3DayProps = {
  bookings: StudioBooking[];
  onCreateBooking?: (booking: StudioBooking) => void;
  onSelectionChange?: (selection: StudioSelectionRange | null) => void;
  onSelectBooking?: (bookingId: string) => void;
  selectedBookingId?: string | null;
  onRangeChange?: (range: { from: Date; to: Date }) => void;
  notice?: string | null;
  error?: string | null;
  onRetry?: () => void;
  isLoading?: boolean;
  showSkeleton?: boolean;
  isReadOnly?: boolean;
  user?: {
    id?: string | null;
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
const SLOT_HEIGHT = 24;
const TIME_GUTTER_WIDTH = 60;
const TIME_GUTTER_PADDING = 10;
const DAY_SEPARATOR_THICKNESS = 1;
const HOUR_LABEL_OFFSET = -2;
const QUARTER_LABEL_OFFSET = -1;
const COMPACT_BOOKING_HEIGHT_PX = 88;

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

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
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

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
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

function initialsFromLabel(label?: string | null, fallback = "U") {
  if (label) {
    const parts = label.trim().split(/\s+/);
    const letters = parts.slice(0, 2).map((part) => part[0]?.toUpperCase());
    const resolved = letters.join("");
    if (resolved) return resolved;
  }
  return fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export default function LiveStudioCalendar3Day({
  bookings,
  onCreateBooking,
  onSelectionChange,
  onSelectBooking,
  selectedBookingId,
  onRangeChange,
  notice,
  error,
  onRetry,
  isLoading = false,
  showSkeleton = false,
  isReadOnly = false,
  user,
  settings,
  focusSignal,
}: LiveStudioCalendar3DayProps) {
  const totalSlots = ((END_HOUR - START_HOUR) * 60) / SLOT_MINUTES;
  const totalHeight = totalSlots * SLOT_HEIGHT;
  const defaultSlots = Math.max(1, Math.round(settings.durationMinutes / 15));

  const [startDate, setStartDate] = useState(() => startOfDay(new Date()));
  const [now, setNow] = useState(() => new Date());
  const [dragging, setDragging] = useState<DragState | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const columnRefs = useRef<Array<HTMLDivElement | null>>([]);
  const onRangeChangeRef = useRef(onRangeChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const lastRangeChangeRef = useRef<{ fromMs: number; toMs: number } | null>(
    null,
  );

  const days = useMemo(
    () => [0, 1, 2].map((offset) => addDays(startDate, offset)),
    [startDate],
  );

  const bookingsByDay = useMemo(() => {
    const grouped: StudioBooking[][] = [[], [], []];
    bookings.forEach((bookingItem) => {
      const bookingDay = startOfDay(bookingItem.start);
      const diffMs = bookingDay.getTime() - startDate.getTime();
      const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
      if (diffDays >= 0 && diffDays < 3) {
        grouped[diffDays].push(bookingItem);
      }
    });
    grouped.forEach((items) =>
      items.sort((a, b) => a.start.getTime() - b.start.getTime()),
    );
    return grouped;
  }, [bookings, startDate]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    onRangeChangeRef.current = onRangeChange;
  }, [onRangeChange]);

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    const nextTo = endOfDay(addDays(startDate, 2));
    const nextRange = {
      fromMs: startDate.getTime(),
      toMs: nextTo.getTime(),
    };
    const previousRange = lastRangeChangeRef.current;
    if (
      previousRange &&
      previousRange.fromMs === nextRange.fromMs &&
      previousRange.toMs === nextRange.toMs
    ) {
      return;
    }
    lastRangeChangeRef.current = nextRange;
    onRangeChangeRef.current?.({
      from: startDate,
      to: nextTo,
    });
  }, [startDate]);

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
      if (state.hasMoved) {
        startSlot = Math.min(state.startSlot, state.currentSlot);
      }
      let endSlot = startSlot + defaultSlots - 1;

      if (endSlot > totalSlots - 1) {
        endSlot = totalSlots - 1;
        startSlot = Math.max(0, endSlot - defaultSlots + 1);
      }

      return { startSlot, endSlot };
    },
    [defaultSlots, totalSlots],
  );

  const slotToDate = useCallback((day: Date, slot: number) => {
    const minutes = slot * SLOT_MINUTES;
    const next = new Date(day);
    next.setHours(START_HOUR + Math.floor(minutes / 60), minutes % 60, 0, 0);
    return next;
  }, []);

  const emitSelection = useCallback(
    (day: Date, range: { startSlot: number; endSlot: number }) => {
      onSelectionChangeRef.current?.({
        start: slotToDate(day, range.startSlot),
        end: slotToDate(day, range.endSlot + 1),
      });
    },
    [slotToDate],
  );

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

  function handleMouseDown(
    dayIndex: number,
    event: ReactMouseEvent<HTMLDivElement>,
  ) {
    if (isReadOnly) return;
    if (event.button !== 0) return;
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
      emitSelection(day, range);
      onCreateBooking?.({
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
    emitSelection,
    getSlotFromClientY,
    onCreateBooking,
    resolveRange,
    settings.durationMinutes,
    settings.task,
    slotToDate,
  ]);

  useEffect(() => {
    if (!dragging) return;
    const day = days[dragging.dayIndex];
    if (!day) return;
    emitSelection(day, resolveRange(dragging));
  }, [days, dragging, emitSelection, resolveRange]);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowTop = (nowMinutes / SLOT_MINUTES) * SLOT_HEIGHT;
  const isTodayVisible = days.some(
    (day) => day.getTime() === startOfDay(new Date()).getTime(),
  );

  const previewRange = dragging ? resolveRange(dragging) : null;
  const previewDayIndex = dragging?.dayIndex ?? null;
  const today = startOfDay(now);

  const calendarVars = useMemo(
    () =>
      ({
        "--studio-slot-height": `${SLOT_HEIGHT}px`,
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

  const shouldShowSkeleton = showSkeleton && bookings.length === 0;

  if (shouldShowSkeleton) {
    return (
      <section className="rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-card)] p-4">
        <div className="animate-pulse">
          <div className="flex items-center justify-between gap-3">
            <div className="h-10 w-40 rounded-xl bg-[var(--studio-panel)]" />
            <div className="flex items-center gap-2">
              <div className="h-10 w-24 rounded-xl bg-[var(--studio-panel)]" />
              <div className="h-10 w-28 rounded-xl bg-[var(--studio-panel)]" />
              <div className="h-10 w-28 rounded-xl bg-[var(--studio-panel)]" />
            </div>
          </div>
          <div className="mt-4 h-[70vh] min-h-[520px] rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)]" />
        </div>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-card)] p-4 box-border [&_*]:box-border"
      style={calendarVars}
    >
      <div className="overflow-hidden rounded-xl border border-[var(--studio-border)] bg-[var(--studio-card)]">
        <div className="flex flex-col gap-2 border-b border-[var(--studio-border)] bg-[var(--studio-panel)] px-4 py-4">
          <div className="grid grid-cols-[var(--studio-time-gutter-width)_1fr] items-center gap-3">
            <div aria-hidden />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)] px-3 text-sm font-semibold text-[var(--studio-text)]"
              >
                {formatMonthYear(startDate)}
                <ChevronDown className="h-4 w-4 text-[var(--studio-muted)]" />
              </button>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)] px-3 text-sm font-semibold text-[var(--studio-text)]"
                >
                  3 days
                  <ChevronDown className="h-4 w-4 text-[var(--studio-muted)]" />
                </button>

                <div className="flex items-center overflow-hidden rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)]">
                  <button
                    type="button"
                    onClick={() => handleShift(-3)}
                    className="flex h-10 w-10 items-center justify-center text-[var(--studio-muted)] hover:text-[var(--studio-text)]"
                    aria-label="Previous days"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setStartDate(startOfDay(new Date()))}
                    className="inline-flex h-10 items-center px-4 text-sm font-semibold text-[var(--studio-text)]"
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => handleShift(3)}
                    className="flex h-10 w-10 items-center justify-center text-[var(--studio-muted)] hover:text-[var(--studio-text)]"
                    aria-label="Next days"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={onRetry}
                  disabled={!onRetry || isLoading}
                  className={cx(
                    "inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition",
                    !onRetry || isLoading
                      ? "cursor-not-allowed border-[var(--studio-border)] bg-[var(--studio-card)] text-[var(--studio-muted)]"
                      : "border-[var(--studio-border)] bg-[var(--studio-card)] text-[var(--studio-text)] hover:-translate-y-0.5",
                  )}
                  aria-label="Refresh sessions"
                >
                  <RefreshCw
                    className={cx("h-4 w-4", isLoading && "animate-spin")}
                  />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {notice ? (
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[var(--studio-border)] bg-[var(--studio-panel)] px-3 py-1 text-xs font-semibold text-[var(--studio-muted)]">
                {notice}
              </div>
            ) : null}
            {error && !isLoading ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-500">
                <span>{error}</span>
                {onRetry ? (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="rounded-full border border-rose-500/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]"
                  >
                    Retry
                  </button>
                ) : null}
              </div>
            ) : null}
            {isLoading ? (
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[var(--studio-border)] bg-[var(--studio-panel)] px-3 py-1 text-[11px] font-semibold text-[var(--studio-muted)]">
                Refreshing...
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-[var(--studio-time-gutter-width)_1fr] border-b border-[var(--studio-border)] bg-[var(--studio-panel)] text-[12px] text-[var(--studio-muted)]">
          <div
            className="border-r border-[var(--studio-grid-strong)] py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{
              paddingLeft: "var(--studio-time-gutter-padding)",
              paddingRight: "var(--studio-time-gutter-padding)",
            }}
          >
            UTC{getTimezoneLabel()}
          </div>
          <div className="grid grid-cols-3">
            {days.map((day, index) => {
              const isToday = isSameDay(day, today);
              return (
                <div
                  key={day.toISOString()}
                  className="px-3 py-2.5 text-[13px] font-semibold text-[var(--studio-text)]"
                  style={index === 0 ? undefined : daySeparatorStyle}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--studio-muted)]">
                    {formatWeekday(day)}
                  </span>
                  <span
                    className={cx(
                      "ml-2 inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-[12px] font-semibold",
                      isToday
                        ? "bg-[var(--studio-accent)] text-white"
                        : "bg-[var(--studio-card)] text-[var(--studio-text)]",
                    )}
                  >
                    {day.getDate()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div
          ref={scrollRef}
          className="relative grid max-h-[70vh] grid-cols-[var(--studio-time-gutter-width)_1fr] overflow-y-auto bg-[var(--studio-card)]"
        >
          <div
            className="relative border-r border-[var(--studio-grid-strong)] bg-[var(--studio-panel)]"
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
                  className="flex items-start justify-end text-right text-[11px]"
                  style={{
                    height: SLOT_HEIGHT,
                    paddingLeft: "var(--studio-time-gutter-padding)",
                    paddingRight: "var(--studio-time-gutter-padding)",
                  }}
                >
                  <span
                    className={
                      isHour
                        ? "text-[12px] font-semibold leading-none text-[var(--studio-text)]"
                        : "text-[10px] leading-none text-[var(--studio-muted)]"
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
          </div>

          <div
            className="relative grid grid-cols-3"
            style={{ height: totalHeight }}
          >
            <div className="pointer-events-none absolute inset-0 z-0">
              <div
                className="absolute inset-0 grid"
                style={{
                  gridTemplateRows: `repeat(${totalSlots}, var(--studio-slot-height))`,
                }}
              >
                {Array.from({ length: totalSlots }).map((_, slot) => {
                  const isHour = (slot * SLOT_MINUTES) % 60 === 0;
                  return (
                    <div
                      key={slot}
                      className={
                        isHour
                          ? "border-t border-solid border-[var(--studio-grid-strong)]"
                          : "border-t border-solid border-[var(--studio-grid)]"
                      }
                    />
                  );
                })}
              </div>

              <div className="absolute inset-0 grid grid-cols-3">
                {days.map((day, index) => (
                  <div
                    key={`${day.toISOString()}-divider`}
                    className={cx(
                      "border-[var(--studio-grid-strong)]",
                      index === 0 ? "border-l-0" : "border-l",
                    )}
                  />
                ))}
              </div>
            </div>

            {days.map((day, dayIndex) => (
              <div
                key={day.toISOString()}
                ref={(node) => {
                  columnRefs.current[dayIndex] = node;
                }}
                onMouseDown={(event) => handleMouseDown(dayIndex, event)}
                className={cx(
                  "relative z-10 select-none bg-[var(--studio-card)] transition-colors",
                  !isReadOnly && "hover:bg-[var(--studio-panel)]",
                )}
              >
                {bookingsByDay[dayIndex]?.map((bookingItem) => (
                  <CalendarBlock
                    key={bookingItem.id}
                    start={bookingItem.start}
                    end={bookingItem.end}
                    user={user}
                    task={bookingItem.task}
                    slotHeight={SLOT_HEIGHT}
                    totalSlots={totalSlots}
                    participantCount={bookingItem.participantCount}
                    maxParticipants={bookingItem.maxParticipants}
                    isParticipant={bookingItem.isParticipant}
                    myRole={bookingItem.myRole}
                    status={bookingItem.status}
                    isOptimistic={bookingItem.isOptimistic}
                    isHost={Boolean(
                      bookingItem.hostId &&
                        user?.id &&
                        bookingItem.hostId === user.id,
                    )}
                    hostDisplayName={bookingItem.hostDisplayName ?? null}
                    isSelected={selectedBookingId === bookingItem.id}
                    onSelect={() => {
                      onSelectBooking?.(bookingItem.id);
                      onSelectionChangeRef.current?.({
                        start: bookingItem.start,
                        end: bookingItem.end,
                      });
                    }}
                  />
                ))}

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
          </div>

          {isTodayVisible ? (
            <div
              className="pointer-events-none absolute inset-x-0 z-30 grid grid-cols-[var(--studio-time-gutter-width)_1fr]"
              style={{ top: nowTop }}
            >
              <div className="relative border-t border-rose-500/80">
                <span className="absolute -top-[9px] right-2 rounded-full bg-[var(--studio-card)] px-2 py-0.5 text-[10px] font-semibold text-rose-500 shadow-sm">
                  {formatTimeCompact(now)}
                </span>
              </div>
              <div className="border-t border-rose-500" />
            </div>
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
  status?: StudioBookingStatus | string;
  isOptimistic?: boolean;
  hostDisplayName?: string | null;
  user?: {
    id?: string | null;
    name?: string | null;
    email?: string | null;
    avatarUrl?: string | null;
  };
  slotHeight: number;
  totalSlots: number;
  isDraft?: boolean;
  isHost?: boolean;
  isSelected?: boolean;
  participantCount?: number;
  maxParticipants?: number;
  isParticipant?: boolean;
  myRole?: string | null;
  onSelect?: () => void;
};

function CalendarBlock({
  start,
  end,
  task,
  status,
  isOptimistic = false,
  user,
  hostDisplayName,
  slotHeight,
  totalSlots,
  isDraft = false,
  isHost = false,
  isSelected = false,
  participantCount,
  maxParticipants,
  isParticipant = false,
  myRole = null,
  onSelect,
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
  const hostLabel =
    (hostDisplayName ?? user?.name ?? user?.email ?? "").trim() || "Focus Host";
  const hostLine = isHost ? "Host: you" : `Hosted by ${hostLabel}`;
  const initials = initialsFromLabel(hostLabel, "FS");
  const isCompact = height < COMPACT_BOOKING_HEIGHT_PX;
  const showHostBadge = isHost || myRole === "host";
  const showReservedBadge = isParticipant && myRole === "participant";

  const isCancelled = status === "cancelled";
  const isCompleted = status === "completed";
  const statusLabel = isCancelled ? "Cancelled" : isCompleted ? "Ended" : null;
  const timeLabel = `${formatTimeCompact(start)} - ${formatTimeCompact(end)}`;

  if (isDraft) {
    return (
      <div
        className="pointer-events-none absolute left-2 right-2 z-20 overflow-hidden rounded-xl border-2 border-[var(--studio-accent)] bg-[var(--studio-accent-soft)] shadow-[0_14px_30px_rgba(91,92,226,0.2)]"
        style={{ top, height }}
      >
        <div className="h-full w-full bg-[linear-gradient(135deg,transparent_0%,rgba(255,255,255,0.28)_50%,transparent_100%)]" />
        <div className="absolute left-2 right-2 top-1.5 truncate rounded-md bg-[var(--studio-card)] px-2 py-0.5 text-[10px] font-semibold text-[var(--studio-accent-ink)]">
          Selecting {timeLabel}
        </div>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.();
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          onSelect?.();
        }
      }}
      className={cx(
        "absolute left-2 right-2 cursor-pointer overflow-hidden rounded-2xl border border-[var(--studio-booking-border)] bg-[var(--studio-booking-bg)] px-2 py-2 text-xs text-[var(--studio-booking-text)] shadow-[0_12px_26px_rgba(15,23,42,0.12)] transition-all duration-150",
        "hover:-translate-y-0.5 hover:shadow-[0_16px_30px_rgba(15,23,42,0.2)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--studio-card)]",
        isSelected &&
          "border-[var(--studio-accent)] ring-2 ring-[var(--studio-accent)] ring-offset-1 ring-offset-[var(--studio-card)] shadow-[0_16px_30px_rgba(91,92,226,0.28)]",
        isCancelled && "opacity-55",
      )}
      style={{ top, height }}
    >
      {isCompact ? (
        <div className="flex h-full min-h-0 flex-col justify-between gap-0.5 overflow-hidden">
          <div className="min-w-0">
            <span className="block truncate font-semibold text-[var(--studio-booking-text)]">
              {taskOption?.label ?? "Session"}
            </span>
            <span className="block truncate text-[10px] text-[var(--studio-booking-muted)]">
              {timeLabel}
            </span>
          </div>
          <div className="mt-auto flex min-w-0 items-center gap-1 overflow-hidden">
            {showHostBadge ? (
              <span className="inline-flex shrink-0 items-center rounded-full border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-sky-600">
                Host
              </span>
            ) : null}
            {showReservedBadge ? (
              <span className="inline-flex shrink-0 items-center rounded-full border border-[var(--studio-accent)] bg-[var(--studio-card)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--studio-accent-ink)]">
                Reserved
              </span>
            ) : null}
            {statusLabel ? (
              <span className="inline-flex shrink-0 items-center rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-rose-500">
                {statusLabel}
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col gap-1 overflow-hidden">
          <div className="flex min-w-0 items-start gap-2">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--studio-card)] shadow-sm">
              {isHost && user?.avatarUrl ? (
                <Image
                  src={user.avatarUrl}
                  alt="Booked session avatar"
                  width={24}
                  height={24}
                  className="h-6 w-6 rounded-full object-cover"
                />
              ) : (
                <span className="text-[9px] font-semibold">{initials}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-[var(--studio-booking-text)]">
                {taskOption?.label ?? "Session"}
              </span>
              <span className="block truncate text-[10px] text-[var(--studio-booking-muted)]">
                {timeLabel}
              </span>
              <span className="block truncate text-[10px] text-[var(--studio-booking-muted)]">
                {hostLine}
              </span>
            </div>
          </div>
          {typeof participantCount === "number" &&
          typeof maxParticipants === "number" ? (
            <div className="truncate text-[10px] font-semibold text-[var(--studio-booking-muted)]">
              {participantCount}/{maxParticipants} participants
            </div>
          ) : null}
          <div className="mt-auto flex min-w-0 items-center gap-1 overflow-hidden">
            {showHostBadge ? (
              <span className="inline-flex shrink-0 items-center rounded-full border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-sky-600">
                Host
              </span>
            ) : null}
            {showReservedBadge ? (
              <span className="inline-flex shrink-0 items-center rounded-full border border-[var(--studio-accent)] bg-[var(--studio-card)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--studio-accent-ink)]">
                Reserved
              </span>
            ) : null}
            {statusLabel ? (
              <span className="inline-flex shrink-0 items-center rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-rose-500">
                {statusLabel}
              </span>
            ) : null}
            {isOptimistic ? (
              <span className="inline-flex shrink-0 items-center rounded-full border border-[var(--studio-accent)] bg-[var(--studio-card)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--studio-accent)]">
                Booking...
              </span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
