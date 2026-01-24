"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import LiveStudioSidebar from "./LiveStudioSidebar";
import LiveStudioSessionSettings from "./LiveStudioSessionSettings";
import LiveStudioCalendar3Day, { type StudioBooking } from "./LiveStudioCalendar3Day";
import LiveStudioRightPanel from "./LiveStudioRightPanel";
import type { StudioTask } from "./liveStudioOptions";
import { csrfFetch } from "@/lib/csrf-client";

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
const DEFAULT_TITLE = "Focus Session";
const ALLOWED_DURATIONS = new Set([30, 60, 120]);

type DateRange = {
  from: Date;
  to: Date;
};

type FocusSessionApi = {
  id: string;
  task?: string | null;
  starts_at: string;
  ends_at: string;
  status?: string | null;
  host_id: string;
  participant_count?: number | null;
  max_participants?: number | null;
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

function isStudioTask(value: unknown): value is StudioTask {
  return value === "desk" || value === "moving" || value === "anything";
}

function toStudioBooking(session: FocusSessionApi): StudioBooking | null {
  const start = new Date(session.starts_at);
  const end = new Date(session.ends_at);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return null;
  return {
    id: session.id,
    task: isStudioTask(session.task) ? session.task : "desk",
    start,
    end,
    hostId: session.host_id,
    participantCount: session.participant_count ?? 0,
    maxParticipants: session.max_participants ?? 3,
    status: session.status ?? "scheduled",
  };
}

export default function LiveStreamStudioShell({ user }: LiveStreamStudioShellProps) {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [task, setTask] = useState<StudioTask>("desk");
  const [sessions, setSessions] = useState<StudioBooking[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [visibleRange, setVisibleRange] = useState<DateRange>(() => {
    const today = startOfDay(new Date());
    return { from: today, to: endOfDay(addDays(today, 2)) };
  });
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
    fetch("/api/csrf", { cache: "no-store" }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const refreshSessions = useCallback(
    async (rangeOverride?: DateRange) => {
      const rangeToUse = rangeOverride ?? visibleRange;
      if (!rangeToUse?.from || !rangeToUse?.to) return;
      const params = new URLSearchParams({
        from: rangeToUse.from.toISOString(),
        to: rangeToUse.to.toISOString(),
      });
      try {
        const res = await fetch(`/api/focus-sessions?${params.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          const message = payload?.error ?? "Failed to load sessions.";
          setNotice(message);
          return;
        }
        const payload = (await res.json()) as { sessions?: FocusSessionApi[] };
        const nextSessions =
          payload?.sessions
            ?.map(toStudioBooking)
            .filter((session): session is StudioBooking => Boolean(session)) ??
          [];
        setSessions(nextSessions);
      } catch (err) {
        console.error(err);
        setNotice("Failed to load sessions.");
      }
    },
    [visibleRange],
  );

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    if (!selectedSessionId) return;
    const stillExists = sessions.some((session) => session.id === selectedSessionId);
    if (!stillExists) {
      setSelectedSessionId(null);
    }
  }, [selectedSessionId, sessions]);

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

  const handleCreateBooking = useCallback(
    async (next: StudioBooking) => {
      const rawDuration = Math.round(
        (next.end.getTime() - next.start.getTime()) / 60000,
      );
      const resolvedDuration = ALLOWED_DURATIONS.has(rawDuration)
        ? rawDuration
        : durationMinutes;
      try {
        const res = await csrfFetch("/api/focus-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: DEFAULT_TITLE,
            task: next.task,
            durationMinutes: resolvedDuration,
            startsAt: next.start.toISOString(),
          }),
        });
        if (res.status === 409) {
          setNotice("You already have a session booked.");
          return;
        }
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          const message = payload?.error ?? "Unable to book session.";
          setNotice(message);
          return;
        }
        const payload = (await res.json()) as { id?: string };
        if (payload?.id) {
          setSelectedSessionId(payload.id);
        }
        setNotice("Session booked.");
        await refreshSessions();
      } catch (err) {
        console.error(err);
        setNotice("Unable to book session.");
      }
    },
    [durationMinutes, refreshSessions],
  );

  function handleBookClick() {
    setNotice("Drag on the calendar to book your session.");
    setFocusSignal((prev) => prev + 1);
  }

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );

  const nextUserSession = useMemo(() => {
    if (!user?.id) return null;
    const now = new Date();
    return (
      sessions
        .filter(
          (session) =>
            session.hostId === user.id && session.end.getTime() >= now.getTime(),
        )
        .sort((a, b) => a.start.getTime() - b.start.getTime())[0] ?? null
    );
  }, [sessions, user?.id]);

  const handleCancelSession = useCallback(
    async (sessionId: string) => {
      try {
        const res = await csrfFetch(`/api/focus-sessions/${sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "cancelled" }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          const message = payload?.error ?? "Unable to cancel session.";
          setNotice(message);
          return;
        }
        setNotice("Session cancelled.");
        if (selectedSessionId === sessionId) {
          setSelectedSessionId(null);
        }
        await refreshSessions();
      } catch (err) {
        console.error(err);
        setNotice("Unable to cancel session.");
      }
    },
    [refreshSessions, selectedSessionId],
  );

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
              bookings={sessions}
              selectedBookingId={selectedSessionId}
              onSelectBooking={setSelectedSessionId}
              onCreateBooking={handleCreateBooking}
              onRangeChange={(range) => setVisibleRange(range)}
              notice={notice}
              user={{
                id: user?.id ?? null,
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
              selectedSession={selectedSession}
              upcomingSession={nextUserSession}
              onCancelSession={handleCancelSession}
              userId={user?.id ?? null}
              collapsed={isRightPanelCollapsed}
              onCollapseChange={setIsRightPanelCollapsed}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
