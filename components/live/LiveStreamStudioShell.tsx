"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import LiveStudioSidebar from "./LiveStudioSidebar";
import LiveStudioSessionSettings from "./LiveStudioSessionSettings";
import LiveStudioCalendar3Day, {
  type StudioSelectionRange,
  type StudioBooking,
} from "./LiveStudioCalendar3Day";
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
const EMPTY_SESSIONS: StudioBooking[] = [];
const ACTIVE_POLL_INTERVAL_MS = 8_000;
const IDLE_POLL_INTERVAL_MS = 25_000;
const MAX_IDLE_POLL_INTERVAL_MS = 60_000;
const SESSION_STATUS_CLOCK_INTERVAL_MS = 30_000;

type DateRange = {
  from: Date;
  to: Date;
};

type RefreshSessionsResult = "updated" | "unchanged" | "error";
type RefreshSessionsMode = "manual" | "background";
type RefreshSessionsOptions = {
  rangeOverride?: DateRange;
  mode: RefreshSessionsMode;
};

type SessionCacheEntry = {
  sessions: StudioBooking[];
  isLoading: boolean;
  updatedAt: number;
  error?: string | null;
};

type FocusSessionApi = {
  id?: string;
  session_id?: string;
  task?: string | null;
  type?: string | null;
  starts_at?: string;
  start_at?: string;
  ends_at?: string;
  end_at?: string;
  status?: string | null;
  host_id?: string | null;
  host_display_name?: string | null;
  participant_count?: number | null;
  max_participants?: number | null;
  room_id?: string | null;
  is_participant?: boolean | null;
  my_role?: string | null;
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

function buildRangeKey(range: DateRange) {
  return `${range.from.toISOString()}_${range.to.toISOString()}`;
}

function isSameRange(left: DateRange, right: DateRange) {
  return (
    left.from.getTime() === right.from.getTime() &&
    left.to.getTime() === right.to.getTime()
  );
}

function sortSessions(items: StudioBooking[]) {
  return [...items].sort((a, b) => a.start.getTime() - b.start.getTime());
}

function isStudioTask(value: unknown): value is StudioTask {
  return value === "desk" || value === "moving" || value === "anything";
}

function toStudioBooking(session: FocusSessionApi): StudioBooking | null {
  const id = session.id ?? session.session_id;
  if (!id) return null;
  const startRaw = session.starts_at ?? session.start_at;
  const endRaw = session.ends_at ?? session.end_at;
  if (!startRaw || !endRaw) return null;
  const start = new Date(startRaw);
  const end = new Date(endRaw);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return null;
  const taskValue = session.task ?? session.type ?? "desk";
  return {
    id,
    task: isStudioTask(taskValue) ? taskValue : "desk",
    start,
    end,
    hostId: session.host_id ?? null,
    hostDisplayName: session.host_display_name ?? null,
    participantCount: session.participant_count ?? 0,
    maxParticipants: session.max_participants ?? 3,
    isParticipant: session.is_participant ?? false,
    myRole: session.my_role ?? null,
    status: session.status ?? "scheduled",
    roomId: session.room_id ?? null,
  };
}

function canAutoJoin(session: StudioBooking, currentUserId?: string | null) {
  if (session.status !== "scheduled" && session.status !== "active") {
    return false;
  }
  const maxParticipants = session.maxParticipants ?? 3;
  const participantCount = session.participantCount ?? 0;
  const isHost = Boolean(
    session.hostId && currentUserId && session.hostId === currentUserId,
  );
  const isParticipant =
    session.isParticipant === true || session.myRole === "participant";
  if (!isHost && !isParticipant) {
    return false;
  }
  if (participantCount >= maxParticipants && !isHost && !isParticipant) {
    return false;
  }
  const now = Date.now();
  const joinOpenAt = session.start.getTime() - 10 * 60 * 1000;
  const joinCloseAt = session.end.getTime();
  return now >= joinOpenAt && now <= joinCloseAt;
}

function buildSessionSignature(session: StudioBooking) {
  return [
    session.id,
    session.start.getTime(),
    session.end.getTime(),
    session.task,
    session.status ?? "",
    session.hostId ?? "",
    session.hostDisplayName ?? "",
    session.participantCount ?? 0,
    session.maxParticipants ?? 0,
    session.isParticipant ? 1 : 0,
    session.myRole ?? "",
    session.roomId ?? "",
  ].join(":");
}

function buildSessionsSignature(sessions: StudioBooking[]) {
  return sessions.map((session) => buildSessionSignature(session)).join("|");
}

function hasLiveActivityWindow(session: StudioBooking, nowMs: number) {
  if (session.status === "cancelled" || session.status === "completed") {
    return false;
  }
  const startMs = session.start.getTime();
  const endMs = session.end.getTime();
  return (
    (session.status === "active" && nowMs <= endMs + 60_000) ||
    (nowMs >= startMs - 10 * 60_000 && nowMs <= endMs + 60_000)
  );
}

function isUpcomingSession(session: StudioBooking, nowMs: number) {
  if (session.status === "cancelled" || session.status === "completed") {
    return false;
  }
  return session.end.getTime() > nowMs;
}

export default function LiveStreamStudioShell({
  user,
}: LiveStreamStudioShellProps) {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [task, setTask] = useState<StudioTask>("desk");
  const [sessionsCache, setSessionsCache] = useState<
    Record<string, SessionCacheEntry>
  >({});
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [visibleRange, setVisibleRange] = useState<DateRange>(() => {
    const today = startOfDay(new Date());
    return { from: today, to: endOfDay(addDays(today, 2)) };
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const [selectedBookingRange, setSelectedBookingRange] =
    useState<StudioSelectionRange | null>(null);
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);
  const [joiningSessionId, setJoiningSessionId] = useState<string | null>(null);
  const [reservingSessionId, setReservingSessionId] = useState<string | null>(
    null,
  );
  const [cancellingReservationSessionId, setCancellingReservationSessionId] =
    useState<string | null>(null);
  const [pendingCancelSessionId, setPendingCancelSessionId] = useState<
    string | null
  >(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  const isPublic = !user?.id;
  const intent = searchParams.get("intent");
  const intentSessionId = searchParams.get("sessionId");
  const handledIntentRef = useRef<string | null>(null);
  const visibleRangeRef = useRef<DateRange>(visibleRange);
  const rangeRefreshDebounceRef = useRef<number | null>(null);
  const hasLoadedInitialRangeRef = useRef(false);
  const pollTimerRef = useRef<number | null>(null);
  const etagByRangeRef = useRef<Record<string, string>>({});
  const sessionsSignatureByRangeRef = useRef<Record<string, string>>({});
  const unchangedPollCountRef = useRef(0);
  const [isAuthenticated, setIsAuthenticated] = useState(!isPublic);
  const [isPageVisible, setIsPageVisible] = useState(() =>
    typeof document === "undefined"
      ? true
      : document.visibilityState === "visible",
  );
  const [nowTick, setNowTick] = useState(() => Date.now());
  const previousVisibilityRef = useRef(isPageVisible);
  const selectedSessionStatusNoticeRef = useRef<string | null>(null);
  const selectedSessionSnapshotRef = useRef<StudioBooking | null>(null);

  const publicJoinLabel = "Reserve spot";
  const publicJoinHelperText =
    "Sign in to reserve a spot. Reservations close 5 minutes before start.";
  const publicBookLabel = "Continue to book";
  const publicBookHelperText = "You're one step away from booking.";

  const sessionsEndpoint = isPublic
    ? "/api/public/sessions"
    : "/api/focus-sessions";
  const visibleRangeKey = useMemo(
    () => buildRangeKey(visibleRange),
    [visibleRange],
  );

  const sessionsEntry = sessionsCache[visibleRangeKey];
  const sessions = useMemo(
    () => sessionsEntry?.sessions ?? EMPTY_SESSIONS,
    [sessionsEntry?.sessions],
  );
  const isRangeLoading = sessionsEntry?.isLoading ?? false;
  const sessionsError = sessionsEntry?.error ?? null;
  const isInitialLoadPending =
    !sessionsEntry ||
    ((sessionsEntry?.sessions?.length ?? 0) === 0 &&
      (sessionsEntry?.isLoading ?? false));
  const hasValidBookingSelection = Boolean(
    selectedBookingRange &&
      selectedBookingRange.end.getTime() > selectedBookingRange.start.getTime(),
  );
  const isBookCtaDisabled = !isPublic && !hasValidBookingSelection;
  const hasRealtimeSessions = useMemo(() => {
    const nowMs = nowTick;
    return sessions.some((session) => hasLiveActivityWindow(session, nowMs));
  }, [nowTick, sessions]);

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
    const onVisibilityChange = () => {
      setIsPageVisible(document.visibilityState === "visible");
    };
    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(
      () => setNowTick(Date.now()),
      SESSION_STATUS_CLOCK_INTERVAL_MS,
    );
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    setIsAuthenticated(!isPublic);
  }, [isPublic]);

  useEffect(() => {
    if (isPublic) return;
    fetch("/api/csrf", { cache: "no-store" }).catch(() => {});
  }, [isPublic]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    visibleRangeRef.current = visibleRange;
  }, [visibleRange]);

  const redirectToSignin = useCallback(
    (nextIntent: "book" | "join" | "cancel", sessionId?: string | null) => {
      const params = new URLSearchParams({ intent: nextIntent });
      if (sessionId) {
        params.set("sessionId", sessionId);
      }
      const callbackUrl = `/feature/live?${params.toString()}`;
      router.push(`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
    },
    [router],
  );

  const refreshSessions = useCallback(
    async (options?: RefreshSessionsOptions): Promise<RefreshSessionsResult> => {
      const rangeToUse = options?.rangeOverride ?? visibleRangeRef.current;
      const mode = options?.mode ?? "background";
      const isManual = mode === "manual";
      if (!rangeToUse?.from || !rangeToUse?.to) return "error";
      const rangeKey = buildRangeKey(rangeToUse);
      if (isManual) {
        setSessionsCache((prev) => {
          const entry = prev[rangeKey] ?? {
            sessions: [],
            isLoading: false,
            updatedAt: 0,
            error: null,
          };
          return {
            ...prev,
            [rangeKey]: {
              ...entry,
              isLoading: true,
            },
          };
        });
      }
      const params = new URLSearchParams({
        from: rangeToUse.from.toISOString(),
        to: rangeToUse.to.toISOString(),
      });
      try {
        const requestHeaders: HeadersInit = {};
        if (!isPublic) {
          const previousEtag = etagByRangeRef.current[rangeKey];
          if (previousEtag) {
            requestHeaders["If-None-Match"] = previousEtag;
          }
        }
        const res = await fetch(`${sessionsEndpoint}?${params.toString()}`, {
          cache: "no-store",
          headers: requestHeaders,
        });
        if (res.status === 304) {
          return "unchanged";
        }
        if (!res.ok) {
          if (res.status === 401 && !isPublic) {
            setIsAuthenticated(false);
          }
          const text = await res.text().catch(() => "");
          const payload = text
            ? (() => {
                try {
                  return JSON.parse(text);
                } catch {
                  return null;
                }
              })()
            : null;
          const message = payload?.error ?? "Failed to load sessions.";
          console.error("[focus sessions] list failed", res.status, text);
          setSessionsCache((prev) => {
            const entry = prev[rangeKey];
            if (!entry) return prev;
            if (entry.error === message && !isManual) return prev;
            return {
              ...prev,
              [rangeKey]: {
                ...entry,
                error: message,
              },
            };
          });
          return "error";
        }
        const nextEtag = res.headers.get("etag");
        if (nextEtag) {
          etagByRangeRef.current[rangeKey] = nextEtag;
        }
        if (!isPublic) {
          setIsAuthenticated(true);
        }
        const payload = (await res.json()) as { sessions?: FocusSessionApi[] };
        const nextSessions =
          payload?.sessions
            ?.map(toStudioBooking)
            .filter((session): session is StudioBooking => Boolean(session)) ??
          [];
        let didChange = false;
        let didMutateEntry = false;
        setSessionsCache((prev) => {
          const entry = prev[rangeKey] ?? {
            sessions: [],
            isLoading: false,
            updatedAt: 0,
            error: null,
          };
          const hadEntry = Boolean(prev[rangeKey]);
          const optimisticSessions =
            entry.sessions?.filter(
              (session) => session.isOptimistic,
            ) ?? [];
          const mergedSessions = [
            ...nextSessions,
            ...optimisticSessions.filter(
              (optimistic) =>
                !nextSessions.some((session) => session.id === optimistic.id),
            ),
          ];
          const sortedSessions = sortSessions(mergedSessions);
          const previousSignature =
            sessionsSignatureByRangeRef.current[rangeKey] ?? "";
          const nextSignature = buildSessionsSignature(sortedSessions);
          didChange = previousSignature !== nextSignature;
          sessionsSignatureByRangeRef.current[rangeKey] = nextSignature;
          const shouldResetError = entry.error !== null;
          const shouldUpdateEntry = !hadEntry || didChange || shouldResetError;
          if (!shouldUpdateEntry && !isManual) {
            return prev;
          }
          if (!shouldUpdateEntry && isManual) {
            return prev;
          }
          didMutateEntry = true;
          return {
            ...prev,
            [rangeKey]: {
              ...entry,
              sessions: sortedSessions,
              isLoading: isManual ? false : entry.isLoading,
              updatedAt:
                didChange || !hadEntry || shouldResetError
                  ? Date.now()
                  : entry.updatedAt,
              error: null,
            },
          };
        });
        if (!didMutateEntry && !didChange) {
          return "unchanged";
        }
        return didChange ? "updated" : "unchanged";
      } catch (err) {
        console.error(err);
        setSessionsCache((prev) => {
          const entry = prev[rangeKey];
          if (!entry) return prev;
          if (!isManual && entry.error === "Failed to load sessions.") {
            return prev;
          }
          return {
            ...prev,
            [rangeKey]: {
              ...entry,
              error: "Failed to load sessions.",
            },
          };
        });
        return "error";
      } finally {
        if (isManual) {
          setSessionsCache((prev) => {
            const entry = prev[rangeKey];
            if (!entry) return prev;
            return {
              ...prev,
              [rangeKey]: {
                ...entry,
                isLoading: false,
              },
            };
          });
        }
      }
    },
    [isPublic, sessionsEndpoint],
  );

  useEffect(() => {
    if (!hasLoadedInitialRangeRef.current) {
      hasLoadedInitialRangeRef.current = true;
      unchangedPollCountRef.current = 0;
      void refreshSessions({ mode: "manual" });
      return;
    }

    if (rangeRefreshDebounceRef.current !== null) {
      window.clearTimeout(rangeRefreshDebounceRef.current);
      rangeRefreshDebounceRef.current = null;
    }

    rangeRefreshDebounceRef.current = window.setTimeout(() => {
      unchangedPollCountRef.current = 0;
      void refreshSessions({ mode: "manual" });
      rangeRefreshDebounceRef.current = null;
    }, 220);

    return () => {
      if (rangeRefreshDebounceRef.current !== null) {
        window.clearTimeout(rangeRefreshDebounceRef.current);
        rangeRefreshDebounceRef.current = null;
      }
    };
  }, [refreshSessions, visibleRangeKey]);

  useEffect(() => {
    if (isPublic || !isAuthenticated || !isPageVisible) {
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    let cancelled = false;

    const resolveNextDelay = () => {
      if (hasRealtimeSessions) return ACTIVE_POLL_INTERVAL_MS;
      if (unchangedPollCountRef.current >= 3) return MAX_IDLE_POLL_INTERVAL_MS;
      return IDLE_POLL_INTERVAL_MS;
    };

    const schedule = (delayMs: number) => {
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
      }
      pollTimerRef.current = window.setTimeout(() => {
        void runPoll();
      }, delayMs);
    };

    const runPoll = async () => {
      const result = await refreshSessions({ mode: "background" });
      if (cancelled) return;
      if (result === "updated") {
        unchangedPollCountRef.current = 0;
      } else {
        unchangedPollCountRef.current = Math.min(
          unchangedPollCountRef.current + 1,
          8,
        );
      }
      schedule(resolveNextDelay());
    };

    schedule(resolveNextDelay());

    return () => {
      cancelled = true;
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [
    hasRealtimeSessions,
    isAuthenticated,
    isPageVisible,
    isPublic,
    refreshSessions,
    visibleRangeKey,
  ]);

  useEffect(() => {
    const wasVisible = previousVisibilityRef.current;
    previousVisibilityRef.current = isPageVisible;
    if (isPublic || !isAuthenticated || !isPageVisible) return;
    if (wasVisible === isPageVisible) return;
    if (!hasLoadedInitialRangeRef.current) return;
    unchangedPollCountRef.current = 0;
    void refreshSessions({ mode: "background" });
  }, [isAuthenticated, isPageVisible, isPublic, refreshSessions]);

  useEffect(() => {
    if (!selectedSessionId) return;
    const nowMs = nowTick;
    const selectedSession = sessions.find(
      (session) => session.id === selectedSessionId,
    );
    if (selectedSession) {
      selectedSessionSnapshotRef.current = selectedSession;
      const normalizedStatus = (selectedSession.status ?? "scheduled").toLowerCase();
      const isCancelled = normalizedStatus === "cancelled";
      const isEnded =
        normalizedStatus === "completed" ||
        selectedSession.end.getTime() <= nowMs;
      if (isCancelled || isEnded) {
        const message = isCancelled ? "Session cancelled." : "Session ended.";
        const noticeKey = `${selectedSession.id}:${message}`;
        if (selectedSessionStatusNoticeRef.current !== noticeKey) {
          selectedSessionStatusNoticeRef.current = noticeKey;
          setNotice(message);
        }
        setSelectedSessionId(null);
      }
      return;
    }

    const previousSnapshot = selectedSessionSnapshotRef.current;
    if (!previousSnapshot || previousSnapshot.id !== selectedSessionId) {
      setSelectedSessionId(null);
      return;
    }

    const snapshotStatus = (previousSnapshot.status ?? "scheduled").toLowerCase();
    const wasCancelled = snapshotStatus === "cancelled";
    const hasEnded = previousSnapshot.end.getTime() <= nowMs;
    if (wasCancelled || hasEnded) {
      const message = wasCancelled ? "Session cancelled." : "Session ended.";
      const noticeKey = `${previousSnapshot.id}:${message}`;
      if (selectedSessionStatusNoticeRef.current !== noticeKey) {
        selectedSessionStatusNoticeRef.current = noticeKey;
        setNotice(message);
      }
    }
    setSelectedSessionId(null);
  }, [nowTick, selectedSessionId, sessions]);

  useEffect(() => {
    if (!pendingCancelSessionId) return;
    const stillExists = sessions.some(
      (session) => session.id === pendingCancelSessionId,
    );
    if (!stillExists) {
      setPendingCancelSessionId(null);
    }
  }, [pendingCancelSessionId, sessions]);

  useEffect(() => {
    if (!reservingSessionId) return;
    const stillExists = sessions.some((session) => session.id === reservingSessionId);
    if (!stillExists) {
      setReservingSessionId(null);
    }
  }, [reservingSessionId, sessions]);

  useEffect(() => {
    if (!cancellingReservationSessionId) return;
    const stillExists = sessions.some(
      (session) => session.id === cancellingReservationSessionId,
    );
    if (!stillExists) {
      setCancellingReservationSessionId(null);
    }
  }, [cancellingReservationSessionId, sessions]);

  const handleBookClick = useCallback(() => {
    if (!user?.id) {
      redirectToSignin("book");
      return;
    }
    setNotice("Drag on the calendar to book your session.");
    setFocusSignal((prev) => prev + 1);
  }, [redirectToSignin, user?.id]);

  const handleVisibleRangeChange = useCallback((range: DateRange) => {
    setVisibleRange((prev) => (isSameRange(prev, range) ? prev : range));
  }, []);

  const handleRetrySessions = useCallback(() => {
    unchangedPollCountRef.current = 0;
    void refreshSessions({ mode: "manual" });
  }, [refreshSessions]);

  const handleJoinSession = useCallback(
    async (session: StudioBooking) => {
      if (!session?.id) return;
      if (!user?.id) {
        redirectToSignin("join", session.id);
        return;
      }
      if (joiningSessionId && joiningSessionId !== session.id) return;
      setJoiningSessionId(session.id);
      try {
        const res = await csrfFetch(`/api/focus-sessions/${session.id}/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const text = await res.text().catch(() => "");
        if (!res.ok) {
          const payload = text
            ? (() => {
                try {
                  return JSON.parse(text);
                } catch {
                  return null;
                }
              })()
            : null;
          const message = payload?.error ?? "Unable to join session.";
          console.error("[focus sessions] join failed", res.status, text);
          setNotice(message);
          return;
        }
        const payload = text
          ? (() => {
              try {
                return JSON.parse(text);
              } catch {
                return null;
              }
            })()
          : null;
        const token = payload?.token;
        if (!token) {
          console.error(
            "[focus sessions] join token missing",
            res.status,
            text,
          );
          setNotice("Unable to join session.");
          return;
        }
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(
            `focus-session-token:${session.id}`,
            token,
          );
        }
        router.push(`/feature/live/session/${session.id}`);
      } catch (err) {
        console.error(err);
        setNotice("Unable to join session.");
      } finally {
        setJoiningSessionId(null);
      }
    },
    [joiningSessionId, redirectToSignin, router, user?.id],
  );

  const handleReserveSession = useCallback(
    async (session: StudioBooking) => {
      if (!session?.id) return;
      if (!user?.id) {
        redirectToSignin("join", session.id);
        return;
      }
      if (reservingSessionId && reservingSessionId !== session.id) return;
      setReservingSessionId(session.id);
      setNotice("Reserving spot...");
      try {
        const res = await csrfFetch(`/api/focus-sessions/${session.id}/reserve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const text = await res.text().catch(() => "");
        if (!res.ok) {
          const payload = text
            ? (() => {
                try {
                  return JSON.parse(text);
                } catch {
                  return null;
                }
              })()
            : null;
          const message = payload?.error ?? "Unable to reserve spot.";
          console.error("[focus sessions] reserve failed", res.status, text);
          setNotice(message);
          return;
        }
        const payload = text
          ? (() => {
              try {
                return JSON.parse(text);
              } catch {
                return null;
              }
            })()
          : null;
        if (payload?.status === "already_participant") {
          setNotice("You're already reserved for this session.");
        } else {
          setNotice("Spot reserved.");
        }
        unchangedPollCountRef.current = 0;
        void refreshSessions({ mode: "background" });
      } catch (err) {
        console.error(err);
        setNotice("Unable to reserve spot.");
      } finally {
        setReservingSessionId(null);
      }
    },
    [redirectToSignin, refreshSessions, reservingSessionId, user?.id],
  );

  const handleCancelReservation = useCallback(
    async (session: StudioBooking) => {
      if (!session?.id) return;
      if (!user?.id) {
        redirectToSignin("join", session.id);
        return;
      }
      if (
        cancellingReservationSessionId &&
        cancellingReservationSessionId !== session.id
      ) {
        return;
      }
      setCancellingReservationSessionId(session.id);
      setNotice("Cancelling reservation...");
      try {
        const res = await csrfFetch(`/api/focus-sessions/${session.id}/reserve`, {
          method: "DELETE",
        });
        const text = await res.text().catch(() => "");
        if (!res.ok) {
          const payload = text
            ? (() => {
                try {
                  return JSON.parse(text);
                } catch {
                  return null;
                }
              })()
            : null;
          const message = payload?.error ?? "Unable to cancel reservation.";
          console.error(
            "[focus sessions] cancel reservation failed",
            res.status,
            text,
          );
          setNotice(message);
          return;
        }
        const payload = text
          ? (() => {
              try {
                return JSON.parse(text);
              } catch {
                return null;
              }
            })()
          : null;
        if (payload?.status === "not_reserved") {
          setNotice("Reservation already cleared.");
        } else {
          setNotice("Reservation cancelled.");
        }
        unchangedPollCountRef.current = 0;
        void refreshSessions({ mode: "background" });
      } catch (err) {
        console.error(err);
        setNotice("Unable to cancel reservation.");
      } finally {
        setCancellingReservationSessionId(null);
      }
    },
    [cancellingReservationSessionId, redirectToSignin, refreshSessions, user?.id],
  );

  useEffect(() => {
    if (!intent) return;
    const key = `${intent}:${intentSessionId ?? ""}`;
    if (handledIntentRef.current === key) return;

    if (intent === "book") {
      if (user?.id) {
        handleBookClick();
      }
      handledIntentRef.current = key;
      return;
    }

    if ((intent === "join" || intent === "cancel") && !intentSessionId) {
      handledIntentRef.current = key;
      return;
    }

    const targetSession = sessions.find(
      (session) => session.id === intentSessionId,
    );
    if (!targetSession) return;

    setSelectedSessionId(targetSession.id);

    if (intent === "join") {
      if (user?.id && canAutoJoin(targetSession, user?.id ?? null)) {
        handleJoinSession(targetSession);
      }
    } else if (intent === "cancel" && user?.id) {
      setPendingCancelSessionId(targetSession.id);
    }

    handledIntentRef.current = key;
  }, [
    handleBookClick,
    handleJoinSession,
    intent,
    intentSessionId,
    sessions,
    user?.id,
  ]);

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
      if (!user?.id) {
        redirectToSignin("book");
        return;
      }
      setSelectedBookingRange({ start: next.start, end: next.end });
      const rawDuration = Math.round(
        (next.end.getTime() - next.start.getTime()) / 60000,
      );
      const resolvedDuration = ALLOWED_DURATIONS.has(rawDuration)
        ? rawDuration
        : durationMinutes;
      const start = next.start;
      setNotice("Booking session...");

      try {
        const res = await csrfFetch("/api/focus-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: DEFAULT_TITLE,
            task: next.task,
            durationMinutes: resolvedDuration,
            startsAt: start.toISOString(),
          }),
        });
        if (res.status === 409) {
          const text = await res.text().catch(() => "");
          console.error("[focus sessions] booking conflict", res.status, text);
          setNotice("You already have a session booked.");
          return;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          const payload = text
            ? (() => {
                try {
                  return JSON.parse(text);
                } catch {
                  return null;
                }
              })()
            : null;
          const message = payload?.error ?? "Unable to book session.";
          console.error("[focus sessions] booking failed", res.status, text);
          setNotice(message);
          return;
        }
        const payload = (await res.json()) as { id?: string };
        const payloadId = payload?.id ?? null;
        if (payloadId) {
          setSelectedSessionId(payloadId);
        }
        setNotice("Session booked.");
        unchangedPollCountRef.current = 0;
        void refreshSessions({ mode: "background" });
      } catch (err) {
        console.error(err);
        setNotice("Unable to book session.");
      }
    },
    [durationMinutes, redirectToSignin, refreshSessions, user?.id],
  );

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );

  const upcomingUserSessions = useMemo(() => {
    if (isPublic || !user?.id) return [];
    const nowMs = nowTick;
    return sessions
      .filter(
        (session) =>
          isUpcomingSession(session, nowMs) &&
          (session.hostId === user.id || session.isParticipant === true),
      )
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [isPublic, nowTick, sessions, user?.id]);

  const nextUpcomingUserSession = upcomingUserSessions[0] ?? null;

  const publicUpcomingSessions = useMemo(() => {
    if (!isPublic) return [];
    const nowMs = nowTick;
    return sessions
      .filter((session) => isUpcomingSession(session, nowMs))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [isPublic, nowTick, sessions]);

  const upcomingSessionForPanel = isPublic
    ? null
    : nextUpcomingUserSession;

  const handleCancelSession = useCallback(
    async (sessionId: string) => {
      if (!user?.id) {
        redirectToSignin("cancel", sessionId);
        return;
      }
      setNotice("Cancelling session...");
      try {
        const res = await csrfFetch(`/api/focus-sessions/${sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "cancelled" }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          const payload = text
            ? (() => {
                try {
                  return JSON.parse(text);
                } catch {
                  return null;
                }
              })()
            : null;
          const message = payload?.error ?? "Unable to cancel session.";
          console.error("[focus sessions] cancel failed", res.status, text);
          setNotice(message);
          return;
        }
        setNotice("Session cancelled.");
        if (selectedSessionId === sessionId) {
          setSelectedSessionId(null);
        }
        unchangedPollCountRef.current = 0;
        void refreshSessions({ mode: "background" });
      } catch (err) {
        console.error(err);
        setNotice("Unable to cancel session.");
      } finally {
        setPendingCancelSessionId((prev) => (prev === sessionId ? null : prev));
      }
    },
    [redirectToSignin, refreshSessions, selectedSessionId, user?.id],
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
            className="grid gap-4 transition-[grid-template-columns] duration-300 lg:grid-cols-[320px_minmax(0,1fr)_var(--live-right-width)] xl:grid-cols-[320px_minmax(0,1fr)_var(--live-right-width-xl)]"
            style={
              {
                "--live-right-width": isRightPanelCollapsed ? "88px" : "360px",
                "--live-right-width-xl": isRightPanelCollapsed
                  ? "88px"
                  : "360px",
              } as CSSProperties
            }
          >
            <LiveStudioSessionSettings
              durationMinutes={durationMinutes}
              onDurationChange={setDurationMinutes}
              task={task}
              onTaskChange={setTask}
              onBookSession={handleBookClick}
              selectedRange={selectedBookingRange}
              isBookDisabled={isBookCtaDisabled}
              disabledReason={
                isBookCtaDisabled
                  ? "Select a time range on the calendar."
                  : null
              }
              primaryLabel={isPublic ? publicBookLabel : undefined}
              helperText={isPublic ? publicBookHelperText : undefined}
            />

            <LiveStudioCalendar3Day
              bookings={sessions}
              selectedBookingId={selectedSessionId}
              onSelectBooking={setSelectedSessionId}
              onCreateBooking={handleCreateBooking}
              onSelectionChange={setSelectedBookingRange}
              onRangeChange={handleVisibleRangeChange}
              notice={notice}
              error={sessionsError}
              onRetry={handleRetrySessions}
              isLoading={isRangeLoading}
              showSkeleton={isInitialLoadPending}
              isReadOnly={isPublic}
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
              upcomingSession={upcomingSessionForPanel}
              upcomingSessions={
                isPublic ? publicUpcomingSessions : upcomingUserSessions
              }
              onSelectUpcomingSession={setSelectedSessionId}
              isPublic={isPublic}
              publicCtaLabel={publicJoinLabel}
              publicHelperText={publicJoinHelperText}
              onPublicAction={(nextIntent, sessionId) =>
                redirectToSignin(nextIntent, sessionId)
              }
              pendingCancelSessionId={pendingCancelSessionId}
              onConfirmCancel={(sessionId) => handleCancelSession(sessionId)}
              onDismissCancel={() => setPendingCancelSessionId(null)}
              onCancelSession={handleCancelSession}
              onReserveSession={handleReserveSession}
              onCancelReservation={handleCancelReservation}
              onJoinSession={handleJoinSession}
              joiningSessionId={joiningSessionId}
              reservingSessionId={reservingSessionId}
              cancellingReservationSessionId={cancellingReservationSessionId}
              userId={user?.id ?? null}
              collapsed={isRightPanelCollapsed}
              onCollapseChange={setIsRightPanelCollapsed}
              isLoading={isInitialLoadPending}
              error={sessionsError}
              onRetry={handleRetrySessions}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
