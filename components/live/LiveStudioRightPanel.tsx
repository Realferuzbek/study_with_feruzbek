"use client";

import AvatarBadge from "@/components/AvatarBadge";
import {
  CalendarDays,
  ChevronRight,
  ChevronsRight,
  Moon,
  Sun,
} from "lucide-react";
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
  upcomingSessions?: StudioBooking[];
  isPublic?: boolean;
  publicCtaLabel?: string;
  publicHelperText?: string | null;
  onPublicAction?: (intent: "join" | "cancel", sessionId: string) => void;
  pendingCancelSessionId?: string | null;
  onConfirmCancel?: (sessionId: string) => void;
  onDismissCancel?: () => void;
  onCancelSession: (sessionId: string) => void;
  onJoinSession: (session: StudioBooking) => void;
  joiningSessionId?: string | null;
  collapsed: boolean;
  onCollapseChange: (next: boolean) => void;
  isLoading?: boolean;
};

function formatTimeCompact(date: Date) {
  const hour = date.getHours();
  const hour12 = hour % 12 || 12;
  const suffix = hour >= 12 ? "p" : "a";
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hour12}:${minutes}${suffix}`;
}

function formatDateLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

export default function LiveStudioRightPanel({
  user,
  userId,
  theme,
  onToggleTheme,
  selectedSession,
  upcomingSession,
  upcomingSessions = [],
  isPublic = false,
  publicCtaLabel = "Continue",
  publicHelperText = null,
  onPublicAction,
  pendingCancelSessionId = null,
  onConfirmCancel,
  onDismissCancel,
  onCancelSession,
  onJoinSession,
  joiningSessionId,
  collapsed,
  onCollapseChange,
  isLoading = false,
}: LiveStudioRightPanelProps) {
  const [showSchedule, setShowSchedule] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const greetingName = user?.displayName ?? user?.name ?? user?.email ?? null;
  const greetingPrimary = "Hello,";
  const greetingSecondary = greetingName ? `${greetingName}!` : "there!";

  const focusedSession = selectedSession ?? upcomingSession;

  const scheduleLabel = useMemo(() => {
    if (!focusedSession) return null;
    const dateLabel = formatDateLabel(focusedSession.start);
    const timeLabel = `${formatTimeCompact(
      focusedSession.start,
    )} - ${formatTimeCompact(focusedSession.end)}`;
    return { dateLabel, timeLabel };
  }, [focusedSession]);

  const taskLabel = useMemo(() => {
    if (!focusedSession) return "Session";
    return (
      TASK_OPTIONS.find((option) => option.value === focusedSession.task)
        ?.label ?? "Session"
    );
  }, [focusedSession]);

  const hostLabel = useMemo(() => {
    if (!focusedSession) return null;
    if (focusedSession.hostDisplayName) return focusedSession.hostDisplayName;
    if (focusedSession.hostId && userId && focusedSession.hostId === userId) {
      return user?.displayName ?? user?.name ?? null;
    }
    return null;
  }, [focusedSession, user?.displayName, user?.name, userId]);

  const joinWindow = useMemo(() => {
    if (!focusedSession) return null;
    const joinOpenAt = new Date(
      focusedSession.start.getTime() - 10 * 60 * 1000,
    );
    const joinCloseAt = new Date(focusedSession.end.getTime());
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
    if (focusedSession.status && focusedSession.status !== "scheduled") {
      return {
        label: "Session unavailable",
        disabled: true,
        state: "unavailable",
      };
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

  const isConfirmingCancel = Boolean(
    focusedSession?.id && pendingCancelSessionId === focusedSession.id,
  );

  const shouldShowSkeleton =
    isLoading && !focusedSession && upcomingSessions.length === 0;

  if (shouldShowSkeleton) {
    return (
      <aside className="min-h-[50vh] rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-card)] p-4">
        <div className="animate-pulse space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="h-10 w-40 rounded-xl bg-[var(--studio-panel)]" />
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-xl bg-[var(--studio-panel)]" />
              <div className="h-10 w-10 rounded-xl bg-[var(--studio-panel)]" />
            </div>
          </div>
          <div className="h-10 rounded-xl bg-[var(--studio-panel)]" />
          <div className="h-[50vh] min-h-[360px] rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)]" />
        </div>
      </aside>
    );
  }

  if (collapsed) {
    return (
      <aside className="rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-card)] p-4 transition-all duration-300">
        <div className="flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={() => onCollapseChange(false)}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)] text-[var(--studio-muted)] transition hover:text-[var(--studio-text)]"
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
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)] text-[var(--studio-muted)] transition hover:text-[var(--studio-text)]"
            aria-label="Open schedule"
          >
            <CalendarDays className="h-4 w-4" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="min-h-[50vh] rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-card)] p-4 transition-all duration-300">
      <div className="flex items-start justify-between gap-4 pb-4">
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
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)] text-[var(--studio-muted)] transition hover:text-[var(--studio-text)]"
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
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)] text-[var(--studio-muted)] transition hover:text-[var(--studio-text)]"
            aria-label="Collapse panel"
          >
            <ChevronsRight className="h-4 w-4 transition" />
          </button>
        </div>
      </div>

      <div className="border-t border-[var(--studio-border)] py-4">
        <button
          type="button"
          onClick={() => setShowSchedule((prev) => !prev)}
          className="flex h-10 w-full items-center justify-between rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)] px-3 text-sm font-semibold text-[var(--studio-text)] transition hover:-translate-y-0.5"
        >
          <span className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-[var(--studio-muted)]" />
            {isPublic ? "Upcoming Sessions" : "My Schedule"}
          </span>
          <ChevronRight className="h-4 w-4 text-[var(--studio-muted)]" />
        </button>

        {showSchedule ? (
          <div className="mt-3 rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)] px-3 py-3 text-sm text-[var(--studio-text)]">
            {isPublic ? (
              upcomingSessions.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {upcomingSessions.map((session) => {
                    const listTaskLabel =
                      TASK_OPTIONS.find(
                        (option) => option.value === session.task,
                      )?.label ?? "Session";
                    const listHostLabel =
                      session.hostDisplayName ?? "Focus Host";
                    return (
                      <div
                        key={session.id}
                        className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-card)] px-3 py-2"
                      >
                        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--studio-subtle)]">
                          {formatDateLabel(session.start)}
                        </span>
                        <div className="mt-1 font-semibold">
                          {formatTimeCompact(session.start)} -{" "}
                          {formatTimeCompact(session.end)}
                        </div>
                        <div className="text-xs text-[var(--studio-muted)]">
                          Task: {listTaskLabel}
                        </div>
                        <div className="text-xs text-[var(--studio-muted)]">
                          Host: {listHostLabel}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-[var(--studio-muted)]">
                  No upcoming sessions yet.
                </p>
              )
            ) : focusedSession && scheduleLabel ? (
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

      <div className="border-t border-[var(--studio-border)] pt-4">
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
                {hostLabel ? (
                  <span className="text-xs text-[var(--studio-muted)]">
                    Host: {hostLabel}
                  </span>
                ) : null}
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
              ) : isPublic ? (
                joinState?.state === "open" ? (
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onPublicAction?.("join", focusedSession.id)
                      }
                      className="h-11 w-full rounded-xl bg-[var(--studio-accent)] text-sm font-semibold text-white shadow-[0_12px_26px_rgba(91,92,226,0.32)] transition hover:-translate-y-0.5"
                    >
                      {publicCtaLabel}
                    </button>
                    {publicHelperText ? (
                      <p className="text-xs font-medium text-[var(--studio-muted)]">
                        {publicHelperText}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-xl border border-[var(--studio-border)] bg-[var(--studio-card)] px-3 py-2 text-center text-sm font-semibold text-[var(--studio-muted)]">
                    {joinState?.label ?? "Session unavailable"}
                  </div>
                )
              ) : isConfirmingCancel ? (
                <div className="rounded-xl border border-[var(--studio-border)] bg-[var(--studio-card)] px-3 py-3 text-sm text-[var(--studio-text)]">
                  <p className="font-semibold">Cancel this session?</p>
                  <p className="mt-1 text-xs text-[var(--studio-muted)]">
                    This frees the slot for others.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onConfirmCancel?.(focusedSession.id)}
                      className="h-10 rounded-xl border border-rose-500/40 bg-rose-500/10 text-xs font-semibold text-rose-500 transition hover:-translate-y-0.5"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => onDismissCancel?.()}
                      className="h-10 rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)] text-xs font-semibold text-[var(--studio-text)] transition hover:-translate-y-0.5"
                    >
                      Keep
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={(joinState?.disabled ?? true) || isJoining}
                  onClick={() => {
                    if (joinState?.disabled || !focusedSession) return;
                    onJoinSession(focusedSession);
                  }}
                  className={`h-11 w-full rounded-xl text-sm font-semibold transition ${
                    joinState?.disabled || isJoining
                      ? "cursor-not-allowed border border-[var(--studio-border)] bg-[var(--studio-card)] text-[var(--studio-muted)]"
                      : "bg-[var(--studio-accent)] text-white shadow-[0_12px_26px_rgba(91,92,226,0.32)] hover:-translate-y-0.5"
                  }`}
                >
                  {isJoining
                    ? "Joining..."
                    : (joinState?.label ?? "Join session")}
                </button>
              )}

              {!isPublic && canCancel && !isConfirmingCancel ? (
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
              {isPublic
                ? "Select a session to see details."
                : "Select a session to join."}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
