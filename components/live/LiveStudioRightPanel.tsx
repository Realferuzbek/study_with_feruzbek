"use client";

import AvatarBadge from "@/components/AvatarBadge";
import { CalendarDays, ChevronRight, ChevronsRight, Moon, Sun } from "lucide-react";
import { useMemo, useState } from "react";
import type { StudioBooking } from "./LiveStudioCalendar3Day";

type LiveStudioRightPanelProps = {
  user?: {
    name?: string | null;
    displayName?: string | null;
    email?: string | null;
    avatarUrl?: string | null;
  };
  theme: "light" | "dark";
  onToggleTheme: () => void;
  booking: StudioBooking | null;
  collapsed: boolean;
  onCollapseChange: (next: boolean) => void;
};

function formatTimeCompact(date: Date) {
  const hour = date.getHours();
  const hour12 = hour % 12 || 12;
  const suffix = hour >= 12 ? "p" : "a";
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hour12}:${minutes}${suffix}`;
}

export default function LiveStudioRightPanel({
  user,
  theme,
  onToggleTheme,
  booking,
  collapsed,
  onCollapseChange,
}: LiveStudioRightPanelProps) {
  const [showSchedule, setShowSchedule] = useState(false);

  const greetingName =
    user?.displayName ?? user?.name ?? user?.email ?? null;
  const greetingPrimary = "Hello,";
  const greetingSecondary = greetingName ? `${greetingName}!` : "there!";

  const scheduleLabel = useMemo(() => {
    if (!booking) return null;
    const dateLabel = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(booking.start);
    const timeLabel = `${formatTimeCompact(booking.start)} - ${formatTimeCompact(
      booking.end,
    )}`;
    return { dateLabel, timeLabel };
  }, [booking]);

  if (collapsed) {
    return (
      <aside className="rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-card)] shadow-[0_20px_50px_rgba(15,23,42,0.08)] transition-all duration-300">
        <div className="flex flex-col items-center gap-4 px-3 py-4">
          <button
            type="button"
            onClick={() => onCollapseChange(false)}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)] text-[var(--studio-muted)] transition hover:text-[var(--studio-text)]"
            aria-label="Expand panel"
          >
            <ChevronsRight className="h-4 w-4 rotate-180" />
          </button>

          <AvatarBadge
            avatarUrl={user?.avatarUrl}
            name={user?.name}
            email={user?.email}
            size={36}
            alt="Profile avatar"
          />

          <button
            type="button"
            onClick={() => {
              setShowSchedule(true);
              onCollapseChange(false);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)] text-[var(--studio-muted)] transition hover:text-[var(--studio-text)]"
            aria-label="Open schedule"
          >
            <CalendarDays className="h-4 w-4" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-card)] shadow-[0_20px_50px_rgba(15,23,42,0.08)] transition-all duration-300">
      <div className="flex items-start justify-between gap-4 px-5 pb-4 pt-5">
        <div className="flex items-start gap-3">
          <AvatarBadge
            avatarUrl={user?.avatarUrl}
            name={user?.name}
            email={user?.email}
            size={40}
            alt="Profile avatar"
            className="shadow-none ring-1 ring-[var(--studio-border)]"
          />
          <div className="leading-tight">
            <p className="text-[15px] font-semibold text-[var(--studio-text)]">
              {greetingPrimary}
            </p>
            <p className="text-[18px] font-semibold text-[var(--studio-text)]">
              {greetingSecondary}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleTheme}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)] text-[var(--studio-muted)] transition hover:text-[var(--studio-text)]"
            aria-label="Toggle theme"
          >
            {theme === "light" ? (
              <Moon className="h-4 w-4" />
            ) : (
              <Sun className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onCollapseChange(true)}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)] text-[var(--studio-muted)] transition hover:text-[var(--studio-text)]"
            aria-label="Collapse panel"
          >
            <ChevronsRight className="h-4 w-4 transition" />
          </button>
        </div>
      </div>

      <div className="border-t border-[var(--studio-border)] px-5 py-4">
        <button
          type="button"
          onClick={() => setShowSchedule((prev) => !prev)}
          className="flex w-full items-center justify-between rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)] px-3 py-2 text-sm font-semibold text-[var(--studio-text)] transition hover:-translate-y-0.5"
        >
          <span className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-[var(--studio-muted)]" />
            My Schedule
          </span>
          <ChevronRight className="h-4 w-4 text-[var(--studio-muted)]" />
        </button>

        {showSchedule ? (
          <div className="mt-3 rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)] px-3 py-3 text-sm text-[var(--studio-text)]">
            {booking && scheduleLabel ? (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--studio-subtle)]">
                  {scheduleLabel.dateLabel}
                </span>
                <span className="font-semibold">{scheduleLabel.timeLabel}</span>
              </div>
            ) : (
              <p className="text-sm text-[var(--studio-muted)]">
                No sessions booked yet.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
