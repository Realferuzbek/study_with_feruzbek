"use client";

import { useMemo } from "react";
import {
  DURATION_OPTIONS,
  TASK_OPTIONS,
  type StudioTask,
} from "./liveStudioOptions";

type LiveStudioSessionSettingsProps = {
  durationMinutes: number;
  onDurationChange: (value: number) => void;
  task: StudioTask;
  onTaskChange: (value: StudioTask) => void;
  selectedRange?: {
    start: Date;
    end: Date;
  } | null;
  isBookDisabled?: boolean;
  disabledReason?: string | null;
  onBookSession?: () => void;
  primaryLabel?: string;
  helperText?: string | null;
};

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatDateTimeLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatUtcOffset(date: Date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return minutes === 0
    ? `${sign}${String(hours).padStart(2, "0")}`
    : `${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export default function LiveStudioSessionSettings({
  durationMinutes,
  onDurationChange,
  task,
  onTaskChange,
  selectedRange = null,
  isBookDisabled = false,
  disabledReason = null,
  onBookSession,
  primaryLabel,
  helperText,
}: LiveStudioSessionSettingsProps) {
  const hasValidSelection = Boolean(
    selectedRange &&
      selectedRange.end.getTime() > selectedRange.start.getTime(),
  );

  const timezoneLabel = useMemo(() => {
    const baseDate = selectedRange?.start ?? new Date();
    const zoneName = new Intl.DateTimeFormat("en-US", {
      timeZoneName: "short",
    })
      .formatToParts(baseDate)
      .find((part) => part.type === "timeZoneName")?.value;
    const ianaZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return `${zoneName ?? ianaZone} (UTC${formatUtcOffset(baseDate)})`;
  }, [selectedRange?.start]);

  const helperMessage = isBookDisabled
    ? (disabledReason ?? "Select a time range on the calendar.")
    : (helperText ??
      (hasValidSelection
        ? "This time range is selected. Drag on the calendar to place a new slot."
        : null));
  const selectedTaskLabel =
    TASK_OPTIONS.find((option) => option.value === task)?.label ?? "Session";

  return (
    <section className="flex h-full flex-col rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-card)] p-4">
      <div>
        <h2 className="text-[15px] font-semibold text-[var(--studio-text)]">
          Booking
        </h2>
        <p className="mt-1 text-xs text-[var(--studio-muted)]">
          Pick a time range, then confirm duration and task.
        </p>
      </div>

      <div className="mt-4 rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-panel)] p-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--studio-subtle)]">
          Selected Time Range
        </div>
        <dl className="mt-3 space-y-2">
          <div className="grid grid-cols-[48px_1fr] items-start gap-2">
            <dt className="text-xs font-semibold text-[var(--studio-muted)]">
              Start
            </dt>
            <dd
              className={cx(
                "text-sm font-medium",
                hasValidSelection
                  ? "text-[var(--studio-text)]"
                  : "text-[var(--studio-muted)]",
              )}
            >
              {hasValidSelection && selectedRange
                ? formatDateTimeLabel(selectedRange.start)
                : "--"}
            </dd>
          </div>
          <div className="grid grid-cols-[48px_1fr] items-start gap-2">
            <dt className="text-xs font-semibold text-[var(--studio-muted)]">
              End
            </dt>
            <dd
              className={cx(
                "text-sm font-medium",
                hasValidSelection
                  ? "text-[var(--studio-text)]"
                  : "text-[var(--studio-muted)]",
              )}
            >
              {hasValidSelection && selectedRange
                ? formatDateTimeLabel(selectedRange.end)
                : "--"}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-[11px] font-medium text-[var(--studio-muted)]">
          Local timezone: {timezoneLabel}
        </p>
        <p className="mt-1 text-[11px] font-medium text-[var(--studio-muted)]">
          Will book: {durationMinutes} min · {selectedTaskLabel}
        </p>
      </div>

      <div className="mt-4 rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-panel)] p-3">
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[var(--studio-subtle)]">
            Session Settings
          </div>
        </div>

        <div className="mt-3 space-y-4">
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--studio-subtle)]">
              Duration
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--studio-card)] p-1">
              {DURATION_OPTIONS.map((value) => {
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onDurationChange(value)}
                    className={cx(
                      "h-10 rounded-xl text-sm font-semibold transition",
                      durationMinutes === value
                        ? "bg-[var(--studio-panel)] text-[var(--studio-text)] shadow-[0_10px_22px_rgba(15,23,42,0.15)]"
                        : "text-[var(--studio-muted)] hover:text-[var(--studio-text)]",
                    )}
                  >
                    <span className="block text-sm leading-tight">{value}</span>
                    <span className="text-[10px] font-medium">min</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--studio-subtle)]">
              My Task
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--studio-card)] p-1">
              {TASK_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isActive = task === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onTaskChange(option.value)}
                    className={cx(
                      "flex h-10 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition",
                      isActive
                        ? "bg-[var(--studio-panel)] text-[var(--studio-text)] shadow-[0_10px_22px_rgba(15,23,42,0.15)]"
                        : "text-[var(--studio-muted)] hover:text-[var(--studio-text)]",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="leading-tight">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-auto pt-4">
        <button
          type="button"
          onClick={onBookSession}
          disabled={isBookDisabled}
          className={cx(
            "h-11 w-full rounded-xl text-sm font-semibold transition",
            isBookDisabled
              ? "cursor-not-allowed border border-[var(--studio-border)] bg-[var(--studio-panel)] text-[var(--studio-muted)]"
              : "bg-[var(--studio-accent)] text-white shadow-[0_12px_26px_rgba(91,92,226,0.32)] hover:-translate-y-0.5 hover:shadow-[0_16px_30px_rgba(91,92,226,0.38)]",
          )}
        >
          {primaryLabel ?? "Book session"}
        </button>
        {helperMessage ? (
          <p
            className={cx(
              "mt-2 text-xs font-medium",
              isBookDisabled
                ? "text-[var(--studio-muted)]"
                : "text-[var(--studio-muted)]",
            )}
          >
            {helperMessage}
          </p>
        ) : null}
      </div>
    </section>
  );
}
