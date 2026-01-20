"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import LiveStudioSidebar from "./LiveStudioSidebar";
import LiveStudioSessionSettings from "./LiveStudioSessionSettings";
import LiveStudioCalendar3Day, { type StudioBooking } from "./LiveStudioCalendar3Day";
import LiveStudioRightPanel from "./LiveStudioRightPanel";
import type { StudioTask } from "./liveStudioOptions";

type LiveStreamStudioShellProps = {
  user?: {
    id?: string;
    name?: string | null;
    displayName?: string | null;
    email?: string | null;
    avatarUrl?: string | null;
  };
};

type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "studymate-live-studio-theme";

export default function LiveStreamStudioShell({ user }: LiveStreamStudioShellProps) {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [task, setTask] = useState<StudioTask>("desk");
  const [booking, setBooking] = useState<StudioBooking | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      setTheme(stored);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const themeVars = useMemo(
    () =>
      theme === "dark"
        ? {
            "--studio-bg": "#0b111b",
            "--studio-panel": "#111827",
            "--studio-card": "#0f172a",
            "--studio-border": "#1f2937",
            "--studio-text": "#e5e7eb",
            "--studio-muted": "#94a3b8",
            "--studio-subtle": "#64748b",
            "--studio-grid": "#1f2a3d",
            "--studio-grid-strong": "#2b3a54",
            "--studio-accent": "#6d6eff",
            "--studio-accent-soft": "#1c2342",
            "--studio-accent-ink": "#c7d2fe",
            "--studio-sidebar": "#4a4fd1",
            "--studio-booking-bg": "#1b2343",
            "--studio-booking-border": "#33416a",
            "--studio-booking-text": "#e0e7ff",
            "--studio-booking-muted": "#b6c0ff",
          }
        : {
            "--studio-bg": "#eef2f8",
            "--studio-panel": "#f1f4f9",
            "--studio-card": "#ffffff",
            "--studio-border": "#dde3ef",
            "--studio-text": "#111827",
            "--studio-muted": "#6b7280",
            "--studio-subtle": "#94a3b8",
            "--studio-grid": "#edf1f7",
            "--studio-grid-strong": "#d7deec",
            "--studio-accent": "#5b5ce2",
            "--studio-accent-soft": "#eef0ff",
            "--studio-accent-ink": "#2b2f86",
            "--studio-sidebar": "#5b5ce2",
            "--studio-booking-bg": "#e7edff",
            "--studio-booking-border": "#c7d2fe",
            "--studio-booking-text": "#1e1b4b",
            "--studio-booking-muted": "#475569",
          },
    [theme],
  );

  function handleCreateBooking(next: StudioBooking) {
    if (booking) {
      setNotice("You already have a session booked.");
      return false;
    }
    setBooking(next);
    setNotice("Session booked.");
    return true;
  }

  function handleBookClick() {
    if (booking) {
      setNotice("You already have a session booked.");
      return;
    }
    setNotice("Drag on the calendar to book your session.");
    setFocusSignal((prev) => prev + 1);
  }

  return (
    <div
      className="min-h-[100dvh] bg-[var(--studio-bg)] text-[var(--studio-text)]"
      style={themeVars as CSSProperties}
    >
      <div className="flex min-h-[100dvh] flex-col md:flex-row">
        <LiveStudioSidebar
          user={{
            name: user?.displayName ?? user?.name ?? null,
            email: user?.email ?? null,
            avatarUrl: user?.avatarUrl ?? null,
          }}
        />

        <main className="flex-1 px-4 py-6 md:px-6 md:py-8">
          <div
            className="grid gap-5 transition-[grid-template-columns] duration-300 lg:grid-cols-[280px_minmax(0,1fr)_var(--live-right-width)] xl:grid-cols-[300px_minmax(0,1fr)_var(--live-right-width-xl)]"
            style={
              {
                "--live-right-width": isRightPanelCollapsed ? "64px" : "280px",
                "--live-right-width-xl": isRightPanelCollapsed ? "64px" : "300px",
              } as CSSProperties
            }
          >
            <LiveStudioSessionSettings
              durationMinutes={durationMinutes}
              onDurationChange={setDurationMinutes}
              task={task}
              onTaskChange={setTask}
              onBookSession={handleBookClick}
            />

            <LiveStudioCalendar3Day
              booking={booking}
              onCreateBooking={handleCreateBooking}
              onBlockedBooking={() =>
                setNotice("You already have a session booked.")
              }
              notice={notice}
              user={{
                name: user?.displayName ?? user?.name ?? null,
                email: user?.email ?? null,
                avatarUrl: user?.avatarUrl ?? null,
              }}
              settings={{ durationMinutes, task }}
              focusSignal={focusSignal}
            />

            <LiveStudioRightPanel
              user={{
                name: user?.name ?? null,
                displayName: user?.displayName ?? null,
                email: user?.email ?? null,
                avatarUrl: user?.avatarUrl ?? null,
              }}
              theme={theme}
              onToggleTheme={() =>
                setTheme((prev) => (prev === "light" ? "dark" : "light"))
              }
              booking={booking}
              collapsed={isRightPanelCollapsed}
              onCollapseChange={setIsRightPanelCollapsed}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
