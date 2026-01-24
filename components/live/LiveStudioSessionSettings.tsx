"use client";

import { DURATION_OPTIONS, TASK_OPTIONS, type StudioTask } from "./liveStudioOptions";

type LiveStudioSessionSettingsProps = {
  durationMinutes: number;
  onDurationChange: (value: number) => void;
  task: StudioTask;
  onTaskChange: (value: StudioTask) => void;
  onBookSession?: () => void;
  primaryLabel?: string;
  helperText?: string | null;
};

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export default function LiveStudioSessionSettings({
  durationMinutes,
  onDurationChange,
  task,
  onTaskChange,
  onBookSession,
  primaryLabel,
  helperText,
}: LiveStudioSessionSettingsProps) {
  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onBookSession}
        className="h-11 w-full rounded-[20px] bg-[var(--studio-accent)] text-sm font-semibold text-white shadow-[0_12px_26px_rgba(91,92,226,0.32)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_30px_rgba(91,92,226,0.38)]"
      >
        {primaryLabel ?? "Book session"}
      </button>
      {helperText ? (
        <p className="text-xs font-medium text-[var(--studio-muted)]">
          {helperText}
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
                      "rounded-lg py-2 text-sm font-semibold transition",
                      durationMinutes === value
                        ? "bg-[var(--studio-card)] text-[var(--studio-text)] shadow-[0_10px_22px_rgba(15,23,42,0.15)]"
                        : "text-[var(--studio-muted)] hover:text-[var(--studio-text)]",
                    )}
                  >
                    <span className="block text-base leading-tight">
                      {value}
                    </span>
                    <span className="text-[11px] font-medium">min</span>
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
                      "flex flex-col items-center justify-center gap-1 rounded-lg py-2 text-[11px] font-semibold transition",
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
