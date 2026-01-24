"use client";

import AvatarBadge from "@/components/AvatarBadge";
import { CalendarDays, ChevronRight, ChevronsRight, Moon, Sun } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import type { StudioBooking } from "./LiveStudioCalendar3Day";
import { TASK_OPTIONS } from "./liveStudioOptions";

type LiveStudioRightPanelProps = {
  user?: {
    name?: string | null;
    displayName?: string | null;
    email?: string | null;
    avatarUrl?: string | null;
  };
  userId?: string | null;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  selectedSession: StudioBooking | null;
  upcomingSession: StudioBooking | null;
  onCancelSession: (sessionId: string) => void;
  onJoinSession: (session: StudioBooking) => void;
  joiningSessionId?: string | null;
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
  userId,
  theme,
  onToggleTheme,
  selectedSession,
  upcomingSession,
  onCancelSession,
  onJoinSession,
  joiningSessionId,
  collapsed,
  onCollapseChange,
}: LiveStudioRightPanelProps) {
  const [showSchedule, setShowSchedule] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const greetingName =
    user?.displayName ?? user?.name ?? user?.email ?? null;
  const greetingPrimary = "Hello,";
  const greetingSecondary = greetingName ? `${greetingName}!` : "there!";

  const focusedSession = selectedSession ?? upcomingSession;

  const scheduleLabel = useMemo(() => {
    if (!focusedSession) return null;
    const dateLabel = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(focusedSession.start);
    const timeLabel = `${formatTimeCompact(
      focusedSession.start,
    )} - ${formatTimeCompact(
      focusedSession.end,
    )}`;
    return { dateLabel, timeLabel };
  }, [focusedSession]);

  const taskLabel = useMemo(() => {
    if (!focusedSession) return "Session";
    return (
      TASK_OPTIONS.find((option) => option.value === focusedSession.task)
        ?.label ?? "Session"
    );
  }, [focusedSession]);

  const joinWindow = useMemo(() => {
    if (!focusedSession) return null;
    const joinOpenAt = new Date(focusedSession.start.getTime() - 10 * 60 * 1000);
    const joinCloseAt = new Date(
      focusedSession.end.getTime() + 5 * 60 * 1000,
    );
    return { joinOpenAt, joinCloseAt };
  }, [focusedSession]);

  const isHost = Boolean(
    focusedSession?.hostId && userId && focusedSession.hostId === userId,
  );

  const joinState = useMemo(() => {
    if (!focusedSession || !joinWindow) return null;
    if (focusedSession.status === "cancelled") {
      return { label: "Session cancelled", disabled: true, state: "cancelled" };
    }
    if (focusedSession.status === "completed") {
      return { label: "Session ended", disabled: true, state: "ended" };
    }
    const maxParticipants = focusedSession.maxParticipants ?? 3;
    const participantCount = focusedSession.participantCount ?? 0;
    if (participantCount >= maxParticipants) {
      return { label: "Session full", disabled: true, state: "full" };
    }
    if (now < joinWindow.joinOpenAt) {
      return {
        label: `Join opens at ${formatTimeCompact(joinWindow.joinOpenAt)}`,
        disabled: true,
        state: "closed",
      };
    }
    if (now > joinWindow.joinCloseAt) {
      return { label: "Session ended", disabled: true, state: "ended" };
    }
    return { label: "Join session", disabled: false, state: "open" };
  }, [focusedSession, joinWindow, now]);

  const canCancel =
    isHost &&
    focusedSession?.status === "scheduled" &&
    now.getTime() < (focusedSession?.start?.getTime() ?? 0);

  const isJoining = Boolean(
    focusedSession?.id && joiningSessionId === focusedSession.id,
  );

  if (collapsed) {
    return (
      <aside className="rounded-[24px] border border-[var(--studio-border)] bg-[var(--studio-card)] shadow-[0_18px_45px_rgba(15,23,42,0.08)] transition-all duration-300">
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
    <aside className="rounded-[24px] border border-[var(--studio-border)] bg-[var(--studio-card)] shadow-[0_18px_45px_rgba(15,23,42,0.08)] transition-all duration-300">
      <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4">
        <div className="flex items-start gap-3">
          <AvatarBadge
            avatarUrl={user?.avatarUrl}
            name={user?.name}
            email={user?.email}
            size={36}
            alt="Profile avatar"
          />
          <div className="leading-snug">
            <p className="text-[14px] font-semibold text-[var(--studio-text)]">
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
            {focusedSession && scheduleLabel ? (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--studio-subtle)]">
                  {scheduleLabel.dateLabel}
                </span>
                <span className="font-semibold">{scheduleLabel.timeLabel}</span>
                <span className="text-xs text-[var(--studio-muted)]">
                  Task: {taskLabel}
                </span>
                <span className="text-xs text-[var(--studio-muted)]">
                  {focusedSession.participantCount ?? 0}/
                  {focusedSession.maxParticipants ?? 3} participants
                </span>
              </div>
            ) : (
              <p className="text-sm text-[var(--studio-muted)]">
                No sessions booked yet.
              </p>
            )}
          </div>
        ) : null}
      </div>

      <div className="border-t border-[var(--studio-border)] px-5 py-4">
        <div className="rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)] px-3 py-3">
          {focusedSession ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--studio-subtle)]">
                  Selected Session
                </span>
                <span className="text-sm font-semibold text-[var(--studio-text)]">
                  {scheduleLabel?.timeLabel ?? "Session"}
                </span>
                <span className="text-xs text-[var(--studio-muted)]">
                  {scheduleLabel?.dateLabel}
                </span>
                <span className="text-xs text-[var(--studio-muted)]">
                  Task: {taskLabel}
                </span>
                <span className="text-xs text-[var(--studio-muted)]">
                  {focusedSession.participantCount ?? 0}/
                  {focusedSession.maxParticipants ?? 3} participants
                </span>
              </div>

              {joinState?.state === "cancelled" ||
              joinState?.state === "ended" ? (
                <div className="rounded-xl border border-[var(--studio-border)] bg-[var(--studio-card)] px-3 py-2 text-center text-sm font-semibold text-[var(--studio-muted)]">
                  {joinState?.label ?? "Session unavailable"}
                </div>
              ) : (
                <button
                  type="button"
                  disabled={(joinState?.disabled ?? true) || isJoining}
                  onClick={() => {
                    if (joinState?.disabled || !focusedSession) return;
                    onJoinSession(focusedSession);
                  }}
                  className={`h-10 w-full rounded-xl text-sm font-semibold transition ${
                    joinState?.disabled || isJoining
                      ? "cursor-not-allowed border border-[var(--studio-border)] bg-[var(--studio-card)] text-[var(--studio-muted)]"
                      : "bg-[var(--studio-accent)] text-white shadow-[0_12px_26px_rgba(91,92,226,0.32)] hover:-translate-y-0.5"
                  }`}
                >
                  {isJoining ? "Joining..." : joinState?.label ?? "Join session"}
                </button>
              )}

              {canCancel ? (
                <button
                  type="button"
                  onClick={() => onCancelSession(focusedSession.id)}
                  className="h-10 w-full rounded-xl border border-rose-500/40 bg-rose-500/10 text-sm font-semibold text-rose-500 transition hover:-translate-y-0.5"
                >
                  Cancel session
                </button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-[var(--studio-muted)]">
              Select a session to join.
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
