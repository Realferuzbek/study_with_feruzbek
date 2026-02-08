"use client";

import AvatarBadge from "@/components/AvatarBadge";
import {
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  ChevronsRight,
  Check,
  Copy,
  Moon,
  Sun,
} from "lucide-react";
import { useMemo, useState, useEffect, useCallback } from "react";
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
  onSelectUpcomingSession?: (sessionId: string) => void;
  onPublicAction?: (intent: "join" | "cancel", sessionId: string) => void;
  pendingCancelSessionId?: string | null;
  onConfirmCancel?: (sessionId: string) => void;
  onDismissCancel?: () => void;
  onCancelSession: (sessionId: string) => void;
  onReserveSession: (session: StudioBooking) => void;
  onCancelReservation: (session: StudioBooking) => void;
  onJoinSession: (session: StudioBooking) => void;
  joiningSessionId?: string | null;
  reservingSessionId?: string | null;
  cancellingReservationSessionId?: string | null;
  collapsed: boolean;
  onCollapseChange: (next: boolean) => void;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
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

function getSessionStatusMeta(status?: string | null) {
  const normalized = (status ?? "scheduled").toLowerCase();
  if (normalized === "active") {
    return {
      label: "Active",
      className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
    };
  }
  if (normalized === "completed") {
    return {
      label: "Completed",
      className: "border-slate-500/40 bg-slate-500/10 text-slate-600",
    };
  }
  if (normalized === "cancelled") {
    return {
      label: "Cancelled",
      className: "border-rose-500/40 bg-rose-500/10 text-rose-600",
    };
  }
  return {
    label: "Scheduled",
    className: "border-sky-500/40 bg-sky-500/10 text-sky-600",
  };
}

type PanelActionState = {
  label: string;
  disabled: boolean;
  state:
    | "open"
    | "closed"
    | "full"
    | "cancelled"
    | "ended"
    | "reserve_required"
    | "unavailable";
};

export default function LiveStudioRightPanel({
  user,
  userId,
  theme,
  onToggleTheme,
  selectedSession,
  upcomingSession,
  upcomingSessions = [],
  isPublic = false,
  publicCtaLabel: _publicCtaLabel = "Reserve spot",
  publicHelperText = null,
  onSelectUpcomingSession,
  onPublicAction,
  pendingCancelSessionId = null,
  onConfirmCancel,
  onDismissCancel,
  onCancelSession,
  onReserveSession,
  onCancelReservation,
  onJoinSession,
  joiningSessionId,
  reservingSessionId = null,
  cancellingReservationSessionId = null,
  collapsed,
  onCollapseChange,
  isLoading = false,
  error = null,
  onRetry,
}: LiveStudioRightPanelProps) {
  const [showSchedule, setShowSchedule] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [copiedToast, setCopiedToast] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  useEffect(() => {
    if (!copiedToast) return;
    const timer = window.setTimeout(() => setCopiedToast(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copiedToast]);

  const greetingName = user?.displayName ?? user?.name ?? user?.email ?? null;
  const greetingPrimary = "Hello,";
  const greetingSecondary = greetingName ? `${greetingName}!` : "there!";

  const focusedSession = selectedSession ?? upcomingSession;
  const hasSelectedSession = Boolean(selectedSession);

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
  const isParticipant = Boolean(
    focusedSession?.isParticipant || focusedSession?.myRole === "participant",
  );
  const normalizedStatus = (focusedSession?.status ?? "scheduled").toLowerCase();
  const isJoinableStatus =
    normalizedStatus === "scheduled" || normalizedStatus === "active";

  const joinState = useMemo<PanelActionState | null>(() => {
    if (!focusedSession || !joinWindow) return null;
    const status = (focusedSession.status ?? "scheduled").toLowerCase();
    if (status === "cancelled") {
      return { label: "Session cancelled", disabled: true, state: "cancelled" };
    }
    if (status === "completed") {
      return { label: "Session ended", disabled: true, state: "ended" };
    }
    if (status !== "scheduled" && status !== "active") {
      return {
        label: "Session unavailable",
        disabled: true,
        state: "unavailable",
      };
    }
    const maxParticipants = focusedSession.maxParticipants ?? 3;
    const participantCount = focusedSession.participantCount ?? 0;
    if (participantCount >= maxParticipants && !isHost && !isParticipant) {
      return { label: "Session full", disabled: true, state: "full" };
    }
    if (!isPublic && !isHost && !isParticipant) {
      return {
        label: "Reserve a spot first",
        disabled: true,
        state: "reserve_required",
      };
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
    return {
      label: status === "active" ? "Rejoin session" : "Join session",
      disabled: false,
      state: "open",
    };
  }, [focusedSession, isHost, isParticipant, isPublic, joinWindow, now]);

  const canCancel =
    isHost &&
    focusedSession?.status === "scheduled" &&
    now.getTime() < (focusedSession?.start?.getTime() ?? 0);

  const isJoining = Boolean(
    focusedSession?.id && joiningSessionId === focusedSession.id,
  );
  const isReserving = Boolean(
    focusedSession?.id && reservingSessionId === focusedSession.id,
  );
  const isCancellingReservation = Boolean(
    focusedSession?.id &&
      cancellingReservationSessionId === focusedSession.id,
  );

  const isConfirmingCancel = Boolean(
    focusedSession?.id && pendingCancelSessionId === focusedSession.id,
  );

  const shouldShowSkeleton =
    isLoading && !focusedSession && upcomingSessions.length === 0;

  const statusMeta = getSessionStatusMeta(focusedSession?.status ?? null);
  const primaryJoinLabel = useMemo(() => {
    if (!focusedSession) return "Join session";
    const status = (focusedSession.status ?? "scheduled").toLowerCase();
    if (isHost && status === "scheduled") return "Start session";
    if (status === "active") return "Rejoin session";
    return "Join session";
  }, [focusedSession, isHost]);

  const reservationCutoff = useMemo(() => {
    if (!focusedSession) return null;
    return new Date(focusedSession.start.getTime() - 5 * 60 * 1000);
  }, [focusedSession]);
  const isPastReservationCutoff =
    Boolean(reservationCutoff) &&
    now.getTime() >= (reservationCutoff?.getTime() ?? 0);
  const isAtCapacity =
    (focusedSession?.participantCount ?? 0) >=
    (focusedSession?.maxParticipants ?? 3);
  const canReserveSpot =
    !isPublic &&
    Boolean(focusedSession) &&
    !isHost &&
    !isParticipant &&
    isJoinableStatus &&
    !isAtCapacity &&
    !isPastReservationCutoff;
  const canCancelReservation =
    !isPublic &&
    focusedSession?.myRole === "participant" &&
    !isHost &&
    isJoinableStatus &&
    Boolean(reservationCutoff) &&
    !isPastReservationCutoff;
  const reservationChangesClosed =
    !isPublic &&
    !isHost &&
    isJoinableStatus &&
    isPastReservationCutoff;
  const publicReserveState = useMemo<PanelActionState | null>(() => {
    if (!isPublic || !focusedSession) return null;
    const status = (focusedSession.status ?? "scheduled").toLowerCase();
    if (status === "cancelled") {
      return { label: "Reserve spot", disabled: true, state: "cancelled" };
    }
    if (status === "completed" || now.getTime() > focusedSession.end.getTime()) {
      return { label: "Reserve spot", disabled: true, state: "ended" };
    }
    if (status !== "scheduled" && status !== "active") {
      return { label: "Reserve spot", disabled: true, state: "unavailable" };
    }
    if (isAtCapacity) {
      return { label: "Reserve spot", disabled: true, state: "full" };
    }
    if (isPastReservationCutoff) {
      return { label: "Reserve spot", disabled: true, state: "closed" };
    }
    return { label: "Reserve spot", disabled: false, state: "open" };
  }, [focusedSession, isAtCapacity, isPastReservationCutoff, isPublic, now]);
  const primaryActionLabel = isPublic ? _publicCtaLabel : primaryJoinLabel;
  const isPrimaryActionDisabled = isPublic
    ? (publicReserveState?.disabled ?? true)
    : (joinState?.disabled ?? true) || isJoining;
  const primaryActionHint = useMemo(() => {
    if (isPublic) {
      if (publicReserveState?.state === "cancelled") return "Session cancelled.";
      if (publicReserveState?.state === "ended") return "Session ended.";
      if (publicReserveState?.state === "full") return "Session is full.";
      if (publicReserveState?.state === "closed") {
        return "Reservations close 5 minutes before start.";
      }
      if (publicReserveState?.state === "unavailable") {
        return "Session unavailable.";
      }
      return publicHelperText;
    }
    if (joinState?.state !== "open") {
      return joinState?.label ?? "Session unavailable.";
    }
    return null;
  }, [isPublic, joinState, publicHelperText, publicReserveState]);
  const shouldShowReservedBadge =
    !isPublic && focusedSession?.myRole === "participant" && !isHost;

  const sharePath = focusedSession?.id
    ? `/feature/live?intent=join&sessionId=${encodeURIComponent(focusedSession.id)}`
    : null;
  const shareUrl = sharePath
    ? origin
      ? `${origin}${sharePath}`
      : sharePath
    : null;

  const handleCopyLink = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedToast(true);
    } catch {
      setCopiedToast(false);
    }
  }, [shareUrl]);

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
      <aside className="rounded-[24px] border border-[var(--studio-border)] bg-[var(--studio-card)] p-3 shadow-[0_18px_45px_rgba(15,23,42,0.08)] transition-all duration-300">
        <div className="flex flex-col items-center gap-3">
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
            size={40}
            alt="Profile avatar"
            fallbackMode={!userId ? "brand" : "initial"}
          />

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
    <aside className="min-h-[50vh] rounded-[24px] border border-[var(--studio-border)] bg-[var(--studio-card)] p-4 shadow-[0_18px_45px_rgba(15,23,42,0.08)] transition-all duration-300">
      <div className="flex items-start justify-between gap-4 pb-4">
        <div className="flex items-start gap-3">
          <AvatarBadge
            avatarUrl={user?.avatarUrl}
            name={user?.name}
            email={user?.email}
            size={36}
            alt="Profile avatar"
            fallbackMode={!userId ? "brand" : "initial"}
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
            Upcoming Sessions
          </span>
          <ChevronRight className="h-4 w-4 text-[var(--studio-muted)]" />
        </button>

        {showSchedule ? (
          <div className="mt-3 rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)] px-3 py-3 text-sm text-[var(--studio-text)]">
            {upcomingSessions.length > 0 ? (
              <div className="flex flex-col gap-3">
                {upcomingSessions.map((session) => {
                  const listTaskLabel =
                    TASK_OPTIONS.find((option) => option.value === session.task)
                      ?.label ?? "Session";
                  const listHostLabel = session.hostDisplayName ?? "Focus Host";
                  const isListSelected = focusedSession?.id === session.id;
                  const canSelectUpcoming = Boolean(onSelectUpcomingSession);
                  return (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => onSelectUpcomingSession?.(session.id)}
                      disabled={!canSelectUpcoming}
                      className={`rounded-lg border px-3 py-2 text-left transition ${
                        isListSelected
                          ? "border-[var(--studio-accent)] bg-[var(--studio-accent-soft)]"
                          : "border-[var(--studio-border)] bg-[var(--studio-card)]"
                      } ${
                        canSelectUpcoming
                          ? "hover:-translate-y-0.5"
                          : "cursor-default"
                      }`}
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
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-[var(--studio-muted)]">
                {isPublic ? "No upcoming sessions yet." : "No sessions booked yet."}
              </p>
            )}
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-rose-600" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-rose-700">
                Unable to refresh session details
              </p>
              <p className="mt-0.5 text-xs text-rose-700/90">{error}</p>
            </div>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="h-9 rounded-lg border border-rose-500/40 bg-white/70 px-3 text-xs font-semibold text-rose-700"
              >
                Retry
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="border-t border-[var(--studio-border)] pt-4">
        <div className="rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)] px-3 py-3">
          {focusedSession ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--studio-subtle)]">
                    {hasSelectedSession ? "Selected Session" : "Next Session"}
                  </span>
                  <span className="text-sm font-semibold text-[var(--studio-text)]">
                    {scheduleLabel?.timeLabel ?? "Session"}
                  </span>
                  <span className="text-xs text-[var(--studio-muted)]">
                    {scheduleLabel?.dateLabel}
                  </span>
                </div>
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusMeta.className}`}
                >
                  {statusMeta.label}
                </span>
              </div>

              <div className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-card)] px-3 py-2">
                <p className="text-xs text-[var(--studio-muted)]">
                  Task:{" "}
                  <span className="font-semibold text-[var(--studio-text)]">
                    {taskLabel}
                  </span>
                </p>
                <p className="mt-1 text-xs text-[var(--studio-muted)]">
                  Host:{" "}
                  <span className="font-semibold text-[var(--studio-text)]">
                    {hostLabel ?? "Focus Host"}
                  </span>
                </p>
                <p className="mt-1 text-xs text-[var(--studio-muted)]">
                  Participants:{" "}
                  <span className="font-semibold text-[var(--studio-text)]">
                    {focusedSession.participantCount ?? 0}/
                    {focusedSession.maxParticipants ?? 3}
                  </span>
                </p>
              </div>

              <div className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-card)] px-3 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--studio-subtle)]">
                  {isPublic ? "Reserve" : "Join"}
                </p>
                {isConfirmingCancel ? (
                  <div className="mt-2 rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)] px-3 py-3 text-sm text-[var(--studio-text)]">
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
                        className="h-10 rounded-xl border border-[var(--studio-border)] bg-[var(--studio-card)] text-xs font-semibold text-[var(--studio-text)] transition hover:-translate-y-0.5"
                      >
                        Keep
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={isPrimaryActionDisabled}
                        onClick={() => {
                          if (!focusedSession || isPrimaryActionDisabled) return;
                          if (isPublic) {
                            onPublicAction?.("join", focusedSession.id);
                            return;
                          }
                          onJoinSession(focusedSession);
                        }}
                        className={`h-11 rounded-xl text-sm font-semibold transition ${
                          isPrimaryActionDisabled
                            ? "cursor-not-allowed border border-[var(--studio-border)] bg-[var(--studio-panel)] text-[var(--studio-muted)]"
                            : "bg-[var(--studio-accent)] text-white shadow-[0_12px_26px_rgba(91,92,226,0.32)] hover:-translate-y-0.5"
                        }`}
                      >
                        {isJoining && !isPublic ? "Joining..." : primaryActionLabel}
                      </button>
                      <button
                        type="button"
                        onClick={handleCopyLink}
                        disabled={!shareUrl}
                        className={`h-11 rounded-xl border text-sm font-semibold transition ${
                          shareUrl
                            ? "border-[var(--studio-border)] bg-[var(--studio-panel)] text-[var(--studio-text)] hover:-translate-y-0.5"
                            : "cursor-not-allowed border-[var(--studio-border)] bg-[var(--studio-panel)] text-[var(--studio-muted)]"
                        }`}
                      >
                        <span className="inline-flex items-center gap-2">
                          <Copy className="h-4 w-4" />
                          Copy link
                        </span>
                      </button>
                    </div>

                    <p className="mt-2 truncate rounded-lg border border-[var(--studio-border)] bg-[var(--studio-panel)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--studio-muted)]">
                      {shareUrl ?? "Link unavailable for this session."}
                    </p>

                    {copiedToast ? (
                      <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                        <Check className="h-3.5 w-3.5" />
                        Copied
                      </p>
                    ) : null}

                    {primaryActionHint ? (
                      <p className="mt-2 text-xs font-medium text-[var(--studio-muted)]">
                        {primaryActionHint}
                      </p>
                    ) : null}

                    {!isPublic && focusedSession && !isHost ? (
                      focusedSession.myRole === "participant" ? (
                        <button
                          type="button"
                          onClick={() => onCancelReservation(focusedSession)}
                          disabled={!canCancelReservation || isCancellingReservation}
                          className={`mt-3 h-10 w-full rounded-xl border text-sm font-semibold transition ${
                            !canCancelReservation || isCancellingReservation
                              ? "cursor-not-allowed border-[var(--studio-border)] bg-[var(--studio-panel)] text-[var(--studio-muted)]"
                              : "border-amber-500/40 bg-amber-500/10 text-amber-600 hover:-translate-y-0.5"
                          }`}
                        >
                          {isCancellingReservation
                            ? "Cancelling..."
                            : "Cancel reservation"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onReserveSession(focusedSession)}
                          disabled={!canReserveSpot || isReserving}
                          className={`mt-3 h-10 w-full rounded-xl border text-sm font-semibold transition ${
                            !canReserveSpot || isReserving
                              ? "cursor-not-allowed border-[var(--studio-border)] bg-[var(--studio-panel)] text-[var(--studio-muted)]"
                              : "border-[var(--studio-accent)] bg-[var(--studio-accent-soft)] text-[var(--studio-accent-ink)] hover:-translate-y-0.5"
                          }`}
                        >
                          {isReserving ? "Reserving..." : "Reserve spot"}
                        </button>
                      )
                    ) : null}

                    {shouldShowReservedBadge ? (
                      <p className="mt-2 inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600">
                        Reserved
                      </p>
                    ) : null}

                    {reservationChangesClosed ? (
                      <p className="mt-2 text-xs font-medium text-[var(--studio-muted)]">
                        Reservations close 5 minutes before start.
                      </p>
                    ) : null}

                    {!isPublic &&
                    focusedSession &&
                    !isHost &&
                    focusedSession.myRole !== "participant" &&
                    isAtCapacity ? (
                      <p className="mt-2 text-xs font-medium text-[var(--studio-muted)]">
                        Session is full.
                      </p>
                    ) : null}

                  </>
                )}
              </div>

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
            <div className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-card)] px-3 py-3">
              <p className="text-sm font-semibold text-[var(--studio-text)]">
                No session selected
              </p>
              <p className="mt-1 text-xs text-[var(--studio-muted)]">
                Select a public session to see details.
              </p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
