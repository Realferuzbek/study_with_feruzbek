"use client";

import { Info } from "lucide-react";
import { DURATION_OPTIONS, TASK_OPTIONS, type StudioTask } from "./liveStudioOptions";

type LiveStudioSessionSettingsProps = {
  durationMinutes: number;
  onDurationChange: (value: number) => void;
  task: StudioTask;
  onTaskChange: (value: StudioTask) => void;
  onBookSession?: () => void;
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
}: LiveStudioSessionSettingsProps) {
  return (
    <section className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onBookSession}
        className="h-12 w-full rounded-2xl bg-[var(--studio-accent)] text-sm font-semibold text-white shadow-[0_14px_28px_rgba(91,92,226,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_34px_rgba(91,92,226,0.4)]"
      >
        Book session
      </button>

      <div className="rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-card)] p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-[var(--studio-text)]">
            Session Settings
          </div>
          <Info className="h-4 w-4 text-[var(--studio-muted)]" />
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.28em] text-[var(--studio-subtle)]">
              Duration
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-2xl bg-[var(--studio-panel)] p-1">
              {DURATION_OPTIONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onDurationChange(value)}
                  className={cx(
                    "rounded-xl py-2 text-sm font-semibold transition",
                    durationMinutes === value
                      ? "bg-[var(--studio-card)] text-[var(--studio-text)] shadow-[0_10px_22px_rgba(15,23,42,0.15)]"
                      : "text-[var(--studio-muted)] hover:text-[var(--studio-text)]",
                  )}
                >
                  <span className="block text-base">{value}</span>
                  <span className="text-xs font-medium">min</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.28em] text-[var(--studio-subtle)]">
              My Task
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-2xl bg-[var(--studio-panel)] p-1">
              {TASK_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isActive = task === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onTaskChange(option.value)}
                    className={cx(
                      "flex flex-col items-center justify-center gap-1 rounded-xl py-2 text-xs font-semibold transition",
                      isActive
                        ? "bg-[var(--studio-card)] text-[var(--studio-text)] shadow-[0_10px_22px_rgba(15,23,42,0.15)]"
                        : "text-[var(--studio-muted)] hover:text-[var(--studio-text)]",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{option.label}</span>
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
