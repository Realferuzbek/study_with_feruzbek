"use client";

import Image from "next/image";
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
};

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
}: LiveStudioRightPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);

  const greetingName =
    user?.displayName ?? user?.name ?? user?.email ?? null;
  const greeting = greetingName ? `Good Morning, ${greetingName}!` : "Welcome!";
  const initials = initialsFromUser(user?.name, user?.email);

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

  return (
    <aside className="rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-card)] shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
      <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-[var(--studio-panel)] shadow-sm">
            {user?.avatarUrl ? (
              <Image
                src={user.avatarUrl}
                alt="Profile avatar"
                width={48}
                height={48}
                className="h-12 w-12 object-cover"
              />
            ) : (
              <span className="text-sm font-semibold text-[var(--studio-text)]">
                {initials}
              </span>
            )}
          </div>
          <div>
            <p className="text-base font-semibold text-[var(--studio-text)]">
              {greeting}
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
            onClick={() => setCollapsed((prev) => !prev)}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)] text-[var(--studio-muted)] transition hover:text-[var(--studio-text)]"
            aria-label="Collapse panel"
          >
            <ChevronsRight
              className={`h-4 w-4 transition ${
                collapsed ? "rotate-180" : ""
              }`}
            />
          </button>
        </div>
      </div>

      {!collapsed ? (
        <div className="border-t border-[var(--studio-border)] px-4 py-4">
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
      ) : null}
    </aside>
  );
}
