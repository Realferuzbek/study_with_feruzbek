"use client";
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

function formatDateShort(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatTimeShort(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
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
  const helperMessage = isBookDisabled
    ? (disabledReason ?? "Select a time range on the calendar.")
    : (helperText ?? null);

  return (
    <section className="flex h-full flex-col gap-3">
      <button
        type="button"
        onClick={onBookSession}
        disabled={isBookDisabled}
        className={cx(
          "h-14 w-full rounded-[20px] text-sm font-semibold transition",
          isBookDisabled
            ? "cursor-not-allowed border border-[var(--studio-border)] bg-[var(--studio-panel)] text-[var(--studio-muted)]"
            : "bg-[var(--studio-accent)] text-white shadow-[0_12px_26px_rgba(91,92,226,0.32)] hover:-translate-y-0.5 hover:shadow-[0_16px_30px_rgba(91,92,226,0.38)]",
        )}
      >
        {primaryLabel ?? "Book session"}
      </button>

      {hasValidSelection && selectedRange ? (
        <p className="text-[11px] font-medium text-[var(--studio-muted)]">
          Selected: {formatDateShort(selectedRange.start)} ·{" "}
          {formatTimeShort(selectedRange.start)} -{" "}
          {formatTimeShort(selectedRange.end)}
        </p>
      ) : null}

      {helperMessage ? (
        <p className="text-xs font-medium text-[var(--studio-muted)]">
          {helperMessage}
        </p>
      ) : null}

      <div className="rounded-[24px] border border-[var(--studio-border)] bg-[var(--studio-card)] p-4 shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
        <div className="flex items-center justify-between">
          <div className="text-[15px] font-semibold text-[var(--studio-text)]">
            Session Settings
          </div>
        </div>

        <div className="mt-3 space-y-4">
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--studio-subtle)]">
              Duration
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--studio-panel)] p-1">
              {DURATION_OPTIONS.map((value) => {
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onDurationChange(value)}
                    className={cx(
                      "h-10 rounded-lg text-sm font-semibold transition",
                      durationMinutes === value
                        ? "bg-[var(--studio-card)] text-[var(--studio-text)] shadow-[0_10px_22px_rgba(15,23,42,0.15)]"
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
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--studio-panel)] p-1">
              {TASK_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isActive = task === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onTaskChange(option.value)}
                    className={cx(
                      "flex h-10 flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-semibold transition",
                      isActive
                        ? "bg-[var(--studio-card)] text-[var(--studio-text)] shadow-[0_10px_22px_rgba(15,23,42,0.15)]"
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
    </section>
  );
}
