"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  selectCameraStreamByPeerID,
  selectIsConnectedToRoom,
  selectIsLocalAudioEnabled,
  selectIsLocalScreenShared,
  selectIsLocalVideoEnabled,
  selectLocalPeer,
  selectPeers,
  selectScreenSharesByPeerId,
  useHMSActions,
  useHMSStore,
  useVideo,
  type HMSPeer,
} from "@100mslive/react-sdk";
import {
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  PictureInPicture2,
  Video,
  VideoOff,
} from "lucide-react";
import { csrfFetch } from "@/lib/csrf-client";

type FocusSessionTiming = {
  startAt?: string | null;
  endAt?: string | null;
  status?: string | null;
};

type FocusmateSessionRoomProps = {
  sessionId: string;
  user: {
    id: string;
    displayName?: string | null;
    name?: string | null;
    email?: string | null;
  };
  session?: FocusSessionTiming;
};

type VideoTileProps = {
  peerId: string;
  label: string;
  isLocal: boolean;
  className?: string;
};

type ControlAction = "mic" | "cam" | "screen" | "pip";
type FeedbackTone = "info" | "error";
type ControlPendingState = Record<ControlAction, boolean>;

type SessionWindow = {
  joinOpenAtMs: number;
  endAtMs: number;
  status: string | null;
};

const JOIN_TIMEOUT_MS = 45_000;
const JOIN_CONNECTING_HINT_DELAY_MS = 12_000;
const RECONNECT_MAX_RETRIES = 3;
const RECONNECT_BACKOFF_MS = [1_000, 2_500, 5_000];
const JOIN_TIMEOUT_ERROR_CODE = "focus_session_join_timeout";
const JOIN_TIMEOUT_MESSAGE =
  "Connection timed out while joining. This may be caused by blocked WebSocket/CSP/network traffic. Check DevTools for connect-src or WebSocket errors.";
const JOIN_CONNECTING_HINT_MESSAGE =
  "Still connecting. This can take up to 45 seconds on slower networks.";
const JOIN_OFFLINE_MESSAGE =
  "You appear to be offline. Reconnect and try joining again.";
const RECONNECT_FAILED_MESSAGE =
  "Connection dropped and automatic reconnect failed. Try again.";

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readIsOffline() {
  if (typeof navigator === "undefined") return false;
  return navigator.onLine === false;
}

function createJoinTimeoutError() {
  const error = new Error("Focus session join timed out") as Error & {
    code?: string;
  };
  error.name = "JoinTimeoutError";
  error.code = JOIN_TIMEOUT_ERROR_CODE;
  return error;
}

function isJoinTimeoutError(error: unknown) {
  if (error instanceof Error) {
    const withCode = error as Error & { code?: string };
    return (
      withCode.code === JOIN_TIMEOUT_ERROR_CODE ||
      withCode.name === "JoinTimeoutError"
    );
  }
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  return (
    record.code === JOIN_TIMEOUT_ERROR_CODE ||
    record.name === "JoinTimeoutError"
  );
}

async function runWithJoinTimeout(task: Promise<void>) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(createJoinTimeoutError());
        }, JOIN_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function parseTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return date;
}

function normalizeStatus(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function readErrorBlob(error: unknown) {
  if (error instanceof Error) {
    return `${error.name} ${error.message}`.toLowerCase();
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const fields = [record.name, record.code, record.message, record.details]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
    return fields.toLowerCase();
  }
  if (typeof error === "string") return error.toLowerCase();
  return "";
}

function mapControlError(action: ControlAction, error: unknown) {
  const blob = readErrorBlob(error);
  const isPermissionIssue =
    blob.includes("notallowederror") ||
    blob.includes("permission denied") ||
    blob.includes("permission blocked");
  const isMissingDevice =
    blob.includes("notfounderror") ||
    blob.includes("requested device not found") ||
    blob.includes("device not found") ||
    blob.includes("no device");
  const isCancelled =
    blob.includes("aborterror") ||
    blob.includes("cancel") ||
    blob.includes("dismissed");

  if (action === "mic") {
    if (isPermissionIssue) return "Microphone permission blocked.";
    if (isMissingDevice) return "No microphone found.";
    return "Unable to update microphone.";
  }

  if (action === "cam") {
    if (isPermissionIssue) return "Camera permission blocked.";
    if (isMissingDevice) return "No camera found.";
    return "Unable to update camera.";
  }

  if (action === "screen") {
    if (isCancelled) return "Screen share canceled.";
    if (isPermissionIssue) return "Screen share permission blocked.";
    return "Unable to update screen share.";
  }

  return "Picture-in-Picture unavailable.";
}

function isJoinableStatus(status: string | null) {
  return status === "scheduled" || status === "active" || status === null;
}

function getJoinTokenKey(sessionId: string) {
  return `focus-session-token:${sessionId}`;
}

function getLeftSessionKey(sessionId: string) {
  return `left_session:${sessionId}`;
}

function VideoTile({ peerId, label, isLocal, className }: VideoTileProps) {
  const cameraTrack = useHMSStore(selectCameraStreamByPeerID(peerId));
  const screenShare = useHMSStore(selectScreenSharesByPeerId(peerId));
  const screenTrackId = screenShare?.video?.id;
  const cameraTrackId = cameraTrack?.id;
  const mainTrackId = screenTrackId ?? cameraTrackId;
  const overlayTrackId = screenTrackId && cameraTrackId ? cameraTrackId : null;
  const { videoRef: mainVideoRef } = useVideo({ trackId: mainTrackId });
  const { videoRef: overlayVideoRef } = useVideo({
    trackId: overlayTrackId ?? undefined,
  });

  return (
    <div
      className={`relative overflow-hidden rounded-[28px] border border-white/10 bg-black/80 shadow-[0_20px_60px_rgba(0,0,0,0.45)] ${
        className ?? ""
      }`}
    >
      {mainTrackId ? (
        <video
          ref={mainVideoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={`h-full w-full object-cover ${
            isLocal ? "scale-x-[-1]" : ""
          }`}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-black/70 text-sm text-white/60">
          Camera off
        </div>
      )}
      {overlayTrackId ? (
        <div className="absolute bottom-3 right-3 z-10 h-[28%] w-[28%] min-h-[72px] min-w-[120px] overflow-hidden rounded-xl border border-white/15 bg-black/85 shadow-[0_8px_24px_rgba(0,0,0,0.55)]">
          <video
            ref={overlayVideoRef}
            autoPlay
            playsInline
            muted={isLocal}
            className={`h-full w-full object-cover ${
              isLocal ? "scale-x-[-1]" : ""
            }`}
          />
        </div>
      ) : null}
      <div className="absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur">
        {label}
      </div>
    </div>
  );
}

type PipOverlayProps = {
  trackId?: string;
  label: string;
  active: boolean;
  onVideoElement: (node: HTMLVideoElement | null) => void;
};

function PipOverlay({ trackId, label, active, onVideoElement }: PipOverlayProps) {
  const { videoRef } = useVideo({ trackId });

  const setRefs = React.useCallback(
    (node: HTMLVideoElement | null) => {
      if (node) {
        videoRef(node);
      }
      onVideoElement(node);
    },
    [onVideoElement, videoRef],
  );

  return (
    <div
      className={`fixed bottom-6 right-6 z-40 h-[124px] w-[220px] overflow-hidden rounded-[18px] border border-white/10 bg-black/80 shadow-[0_20px_50px_rgba(0,0,0,0.5)] transition duration-200 md:h-[135px] md:w-[240px] ${
        active ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      {trackId ? (
        <video
          ref={setRefs}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[11px] text-white/60">
          Camera off
        </div>
      )}
      <div className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white/80 backdrop-blur">
        {label}
      </div>
    </div>
  );
}

function formatLabel(peer?: HMSPeer | null) {
  if (!peer) return "Guest";
  const name = peer.name?.trim() || "Guest";
  return peer.isLocal ? `${name} (You)` : name;
}

export default function FocusmateSessionRoom({
  sessionId,
  user,
  session,
}: FocusmateSessionRoomProps) {
  const router = useRouter();
  const hmsActions = useHMSActions();
  const isConnected = useHMSStore(selectIsConnectedToRoom);
  const peers = useHMSStore(selectPeers);
  const localPeer = useHMSStore(selectLocalPeer);
  const isMicOn = useHMSStore(selectIsLocalAudioEnabled);
  const isCamOn = useHMSStore(selectIsLocalVideoEnabled);
  const isShareOn = useHMSStore(selectIsLocalScreenShared);

  const [joining, setJoining] = React.useState(false);
  const [joinError, setJoinError] = React.useState<string | null>(null);
  const [joinAttemptNonce, setJoinAttemptNonce] = React.useState(0);
  const [showJoinConnectingHint, setShowJoinConnectingHint] =
    React.useState(false);
  const [isReconnecting, setIsReconnecting] = React.useState(false);
  const [isOffline, setIsOffline] = React.useState(readIsOffline);
  const [retryingJoin, setRetryingJoin] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{
    message: string;
    tone: FeedbackTone;
  } | null>(null);
  const [pipOverlayOn, setPipOverlayOn] = React.useState(false);
  const [pipVideoEl, setPipVideoEl] = React.useState<HTMLVideoElement | null>(
    null,
  );
  const [isPipActive, setIsPipActive] = React.useState(false);
  const [sessionClosedByHistory, setSessionClosedByHistory] =
    React.useState(false);
  const [endingDueToTime, setEndingDueToTime] = React.useState(false);
  const [pendingControls, setPendingControls] =
    React.useState<ControlPendingState>({
      mic: false,
      cam: false,
      screen: false,
      pip: false,
    });

  const joinAttemptHandledRef = React.useRef<number | null>(null);
  const sessionEndingHandledRef = React.useRef(false);
  const wasConnectedRef = React.useRef(false);
  const reconnectInFlightRef = React.useRef(false);

  const displayName = user.displayName || user.name || user.email || "Guest";
  const joinTokenStorageKey = React.useMemo(
    () => getJoinTokenKey(sessionId),
    [sessionId],
  );
  const leftSessionStorageKey = React.useMemo(
    () => getLeftSessionKey(sessionId),
    [sessionId],
  );
  const sessionWindow = React.useMemo<SessionWindow | null>(() => {
    const startAt = parseTimestamp(session?.startAt ?? null);
    const endAt = parseTimestamp(session?.endAt ?? null);
    if (!startAt || !endAt) return null;
    return {
      joinOpenAtMs: startAt.getTime() - 10 * 60 * 1000,
      endAtMs: endAt.getTime(),
      status: normalizeStatus(session?.status ?? null),
    };
  }, [session?.endAt, session?.startAt, session?.status]);
  const isWithinJoinWindow = React.useMemo(() => {
    if (!sessionWindow) return false;
    if (!isJoinableStatus(sessionWindow.status)) return false;
    const now = Date.now();
    return now >= sessionWindow.joinOpenAtMs && now <= sessionWindow.endAtMs;
  }, [sessionWindow]);

  const showFeedback = React.useCallback(
    (message: string, tone: FeedbackTone = "info") => {
      setFeedback({ message, tone });
    },
    [],
  );

  const setControlPending = React.useCallback(
    (action: ControlAction, pending: boolean) => {
      setPendingControls((prev) => {
        if (prev[action] === pending) return prev;
        return { ...prev, [action]: pending };
      });
    },
    [],
  );

  React.useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 2600);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const syncOfflineState = () => {
      const offline = readIsOffline();
      setIsOffline(offline);
      if (offline && !isConnected) {
        setJoinError((current) => current ?? JOIN_OFFLINE_MESSAGE);
        return;
      }
      setJoinError((current) =>
        current === JOIN_OFFLINE_MESSAGE ? null : current,
      );
    };
    syncOfflineState();
    window.addEventListener("online", syncOfflineState);
    window.addEventListener("offline", syncOfflineState);
    return () => {
      window.removeEventListener("online", syncOfflineState);
      window.removeEventListener("offline", syncOfflineState);
    };
  }, [isConnected]);

  React.useEffect(() => {
    if (!joining || isConnected || joinError) {
      setShowJoinConnectingHint(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setShowJoinConnectingHint(true);
    }, JOIN_CONNECTING_HINT_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isConnected, joinError, joining]);

  React.useEffect(() => {
    if (joinAttemptHandledRef.current === joinAttemptNonce) return;
    joinAttemptHandledRef.current = joinAttemptNonce;

    let active = true;
    (async () => {
      setJoining(true);
      setJoinError(null);
      setShowJoinConnectingHint(false);
      setSessionClosedByHistory(false);
      try {
        const offline = readIsOffline();
        setIsOffline(offline);
        if (offline) {
          if (active) setJoinError(JOIN_OFFLINE_MESSAGE);
          return;
        }

        let authToken: string | null = null;
        let hasLeftFlag = false;
        if (typeof window !== "undefined") {
          authToken = window.sessionStorage.getItem(joinTokenStorageKey);
          hasLeftFlag = Boolean(
            window.sessionStorage.getItem(leftSessionStorageKey),
          );
          if (authToken) {
            window.sessionStorage.removeItem(joinTokenStorageKey);
            window.sessionStorage.removeItem(leftSessionStorageKey);
          }
        }

        if (!authToken && hasLeftFlag && isWithinJoinWindow) {
          if (active) {
            setSessionClosedByHistory(true);
          }
          return;
        }

        const tryJoin = async (token: string) => {
          await runWithJoinTimeout(
            hmsActions.join({
              userName: displayName,
              authToken: token,
            }),
          );
        };

        if (authToken) {
          try {
            await tryJoin(authToken);
            return;
          } catch (err) {
            if (isJoinTimeoutError(err)) {
              console.error(
                "[focus sessions] join with cached token timed out",
                err,
              );
              if (active) setJoinError(JOIN_TIMEOUT_MESSAGE);
              return;
            }
            console.error("[focus sessions] join with cached token failed", err);
          }
        }

        if (readIsOffline()) {
          if (active) {
            setIsOffline(true);
            setJoinError(JOIN_OFFLINE_MESSAGE);
          }
          return;
        }

        const res = await csrfFetch(
          `/api/focus-sessions/${sessionId}/token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          },
        );
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
          if (active) setJoinError(message);
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
          console.error("[focus sessions] join token missing", res.status, text);
          if (active) setJoinError("Unable to join session.");
          return;
        }
        await tryJoin(token);
      } catch (err) {
        console.error(err);
        if (!active) return;
        if (readIsOffline()) {
          setIsOffline(true);
          setJoinError(JOIN_OFFLINE_MESSAGE);
        } else if (isJoinTimeoutError(err)) {
          setJoinError(JOIN_TIMEOUT_MESSAGE);
        } else {
          setJoinError("Unable to join session.");
        }
      } finally {
        if (active) setJoining(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [
    displayName,
    hmsActions,
    isWithinJoinWindow,
    joinAttemptNonce,
    joinTokenStorageKey,
    leftSessionStorageKey,
    sessionId,
  ]);

  React.useEffect(() => {
    if (!isConnected || !joinError) return;
    setJoinError(null);
  }, [isConnected, joinError]);

  React.useEffect(() => {
    if (isConnected) {
      wasConnectedRef.current = true;
      reconnectInFlightRef.current = false;
      setIsReconnecting(false);
      return;
    }

    const droppedFromConnectedState = wasConnectedRef.current;
    wasConnectedRef.current = false;

    if (!droppedFromConnectedState) return;
    if (endingDueToTime || sessionClosedByHistory) return;
    if (!isWithinJoinWindow) return;
    if (reconnectInFlightRef.current) return;

    reconnectInFlightRef.current = true;
    let active = true;

    (async () => {
      setIsReconnecting(true);
      setJoinError(null);
      setShowJoinConnectingHint(false);

      let lastError = RECONNECT_FAILED_MESSAGE;
      for (let attempt = 0; attempt < RECONNECT_MAX_RETRIES; attempt += 1) {
        if (!active) return;
        const offline = readIsOffline();
        setIsOffline(offline);
        if (offline) {
          lastError = JOIN_OFFLINE_MESSAGE;
        } else {
          try {
            await hmsActions.leave();
          } catch {}

          try {
            const res = await csrfFetch(`/api/focus-sessions/${sessionId}/token`, {
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
              lastError = payload?.error ?? "Unable to join session.";
              console.error(
                "[focus sessions] reconnect token fetch failed",
                res.status,
                text,
              );
            } else {
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
                lastError = "Unable to join session.";
                console.error(
                  "[focus sessions] reconnect token missing",
                  res.status,
                  text,
                );
              } else {
                await runWithJoinTimeout(
                  hmsActions.join({
                    userName: displayName,
                    authToken: token,
                  }),
                );
                return;
              }
            }
          } catch (err) {
            console.error("[focus sessions] reconnect attempt failed", err);
            if (isJoinTimeoutError(err)) {
              lastError = JOIN_TIMEOUT_MESSAGE;
            } else if (err instanceof Error && err.message) {
              lastError = err.message;
            } else {
              lastError = RECONNECT_FAILED_MESSAGE;
            }
          }
        }

        if (attempt < RECONNECT_MAX_RETRIES - 1) {
          const delay =
            RECONNECT_BACKOFF_MS[
              Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)
            ];
          await sleep(delay);
        }
      }

      if (active) setJoinError(lastError);
    })()
      .catch((err) => {
        console.error("[focus sessions] reconnect flow failed", err);
        if (!active) return;
        setJoinError(RECONNECT_FAILED_MESSAGE);
      })
      .finally(() => {
        reconnectInFlightRef.current = false;
        if (active) {
          setIsReconnecting(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    displayName,
    endingDueToTime,
    hmsActions,
    isConnected,
    isWithinJoinWindow,
    sessionClosedByHistory,
    sessionId,
  ]);

  React.useEffect(() => {
    return () => {
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(leftSessionStorageKey, String(Date.now()));
      }
      hmsActions.leave().catch(() => {});
    };
  }, [hmsActions, leftSessionStorageKey]);

  React.useEffect(() => {
    if (!sessionWindow?.endAtMs || sessionEndingHandledRef.current) return;
    let timer: number | null = null;

    const handleSessionEnd = async () => {
      if (sessionEndingHandledRef.current) return;
      if (Date.now() < sessionWindow.endAtMs) return;
      sessionEndingHandledRef.current = true;
      setEndingDueToTime(true);
      showFeedback("Session ended.", "info");
      try {
        await hmsActions.leave();
      } catch {
      } finally {
        window.setTimeout(() => {
          router.replace("/feature/live");
        }, 450);
      }
    };

    void handleSessionEnd();
    timer = window.setInterval(() => {
      void handleSessionEnd();
    }, 15_000);

    return () => {
      if (timer !== null) window.clearInterval(timer);
    };
  }, [hmsActions, router, sessionWindow?.endAtMs, showFeedback]);

  React.useEffect(() => {
    const video = pipVideoEl;
    if (!video) return;

    const handleEnter = () => {
      setIsPipActive(true);
      setPipOverlayOn(true);
    };
    const handleLeave = () => {
      setIsPipActive(false);
      setPipOverlayOn(false);
    };

    video.addEventListener("enterpictureinpicture", handleEnter);
    video.addEventListener("leavepictureinpicture", handleLeave);

    return () => {
      video.removeEventListener("enterpictureinpicture", handleEnter);
      video.removeEventListener("leavepictureinpicture", handleLeave);
    };
  }, [pipVideoEl]);

  const orderedPeers = React.useMemo(() => {
    const next = [...peers];
    next.sort((a, b) => {
      if (a.isLocal && !b.isLocal) return -1;
      if (!a.isLocal && b.isLocal) return 1;
      return (a.name || "").localeCompare(b.name || "");
    });
    return next;
  }, [peers]);

  const visiblePeers = orderedPeers.slice(0, 3);
  const peerCount = visiblePeers.length;

  const pipPeer = localPeer ?? visiblePeers[0] ?? null;
  const pipPeerId = pipPeer?.id ?? "";
  const pipLabel = formatLabel(pipPeer);
  const pipCameraTrack = useHMSStore(selectCameraStreamByPeerID(pipPeerId));
  const pipScreenShare = useHMSStore(selectScreenSharesByPeerId(pipPeerId));
  const pipTrackId = pipScreenShare?.video?.id ?? pipCameraTrack?.id;
  const controlsLocked = joining || !isConnected || endingDueToTime;

  const micLabel = pendingControls.mic
    ? isMicOn
      ? "Muting..."
      : "Unmuting..."
    : isMicOn
      ? "Mute"
      : "Unmute";
  const camLabel = pendingControls.cam
    ? isCamOn
      ? "Turning off..."
      : "Turning on..."
    : isCamOn
      ? "Camera off"
      : "Camera on";
  const shareLabel = pendingControls.screen
    ? isShareOn
      ? "Stopping..."
      : "Starting..."
    : isShareOn
      ? "Stop share"
      : "Share screen";
  const pipLabelText = pendingControls.pip
    ? "Working..."
    : isPipActive
      ? "Exit PiP"
      : "PiP";

  const toggleMic = React.useCallback(async () => {
    if (pendingControls.mic || controlsLocked) return;
    setControlPending("mic", true);
    try {
      await hmsActions.setLocalAudioEnabled(!isMicOn);
    } catch (err) {
      console.error(err);
      showFeedback(mapControlError("mic", err), "error");
    } finally {
      setControlPending("mic", false);
    }
  }, [
    controlsLocked,
    hmsActions,
    isMicOn,
    pendingControls.mic,
    setControlPending,
    showFeedback,
  ]);

  const toggleCam = React.useCallback(async () => {
    if (pendingControls.cam || controlsLocked) return;
    setControlPending("cam", true);
    try {
      await hmsActions.setLocalVideoEnabled(!isCamOn);
    } catch (err) {
      console.error(err);
      showFeedback(mapControlError("cam", err), "error");
    } finally {
      setControlPending("cam", false);
    }
  }, [
    controlsLocked,
    hmsActions,
    isCamOn,
    pendingControls.cam,
    setControlPending,
    showFeedback,
  ]);

  const toggleScreenShare = React.useCallback(async () => {
    if (pendingControls.screen || controlsLocked) return;
    setControlPending("screen", true);
    try {
      await hmsActions.setScreenShareEnabled(!isShareOn);
    } catch (err) {
      console.error(err);
      showFeedback(mapControlError("screen", err), "error");
    } finally {
      setControlPending("screen", false);
    }
  }, [
    controlsLocked,
    hmsActions,
    isShareOn,
    pendingControls.screen,
    setControlPending,
    showFeedback,
  ]);

  const togglePip = React.useCallback(async () => {
    if (pendingControls.pip || controlsLocked) return;
    setControlPending("pip", true);
    try {
      if (typeof document === "undefined") {
        showFeedback("Picture-in-Picture unavailable.", "error");
        return;
      }

      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPipActive(false);
        setPipOverlayOn(false);
        return;
      }

      if (!pipVideoEl || !document.pictureInPictureEnabled) {
        setPipOverlayOn(false);
        showFeedback("Picture-in-Picture unavailable.", "error");
        return;
      }

      if (typeof pipVideoEl.requestPictureInPicture !== "function") {
        setPipOverlayOn(false);
        showFeedback("Picture-in-Picture unavailable.", "error");
        return;
      }

      setPipOverlayOn(true);
      await pipVideoEl.requestPictureInPicture();
      setIsPipActive(true);
    } catch (err) {
      console.error(err);
      setPipOverlayOn(false);
      showFeedback(mapControlError("pip", err), "error");
    } finally {
      setControlPending("pip", false);
    }
  }, [
    controlsLocked,
    pendingControls.pip,
    pipVideoEl,
    setControlPending,
    showFeedback,
  ]);

  const retryJoin = React.useCallback(async () => {
    if (retryingJoin || endingDueToTime) return;
    setRetryingJoin(true);
    setJoinError(null);
    setShowJoinConnectingHint(false);
    setSessionClosedByHistory(false);
    try {
      await hmsActions.leave();
    } catch {}
    joinAttemptHandledRef.current = null;
    setJoinAttemptNonce((prev) => prev + 1);
    setRetryingJoin(false);
  }, [endingDueToTime, hmsActions, retryingJoin]);

  const showJoinRecoveryPanel =
    !endingDueToTime &&
    !isConnected &&
    (Boolean(joinError) || showJoinConnectingHint || isOffline);
  const joinRecoveryMessage = joinError
    ? joinError
    : isOffline
      ? JOIN_OFFLINE_MESSAGE
      : JOIN_CONNECTING_HINT_MESSAGE;
  const joinRecoveryIsError = Boolean(joinError) || isOffline;

  if (sessionClosedByHistory) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[radial-gradient(circle_at_top,_#172032,_#0b1117_55%,_#070b11_100%)] px-4 text-white">
        <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-black/40 p-6 text-center shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
          <p className="text-xs uppercase tracking-[0.28em] text-white/50">
            Focus session
          </p>
          <h1 className="mt-3 text-2xl font-semibold">Session closed</h1>
          <p className="mt-3 text-sm text-white/65">
            You left this call. Rejoin from Live Studio when you are ready.
          </p>
          <button
            type="button"
            onClick={() => router.replace("/feature/live")}
            className="mt-6 inline-flex h-11 items-center justify-center rounded-full border border-white/20 bg-white/10 px-6 text-sm font-semibold text-white transition hover:bg-white/20"
          >
            Back to Studio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[radial-gradient(circle_at_top,_#172032,_#0b1117_55%,_#070b11_100%)] text-white">
      <div className="flex-1 px-4 pb-8 pt-6 md:px-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-white/65">
            <div className="font-medium uppercase tracking-[0.3em] text-white/45">
              Focus session
            </div>
            <div>
              {endingDueToTime
                ? "Session ended"
                : isReconnecting
                  ? "Reconnecting..."
                : isOffline && !isConnected
                  ? "Offline"
                : joinError
                  ? "Unable to join"
                  : joining
                    ? "Connecting..."
                    : isConnected
                      ? "Live"
                      : "Waiting to connect"}
            </div>
          </div>

          {feedback ? (
            <div
              className={cx(
                "rounded-2xl border p-3 text-sm",
                feedback.tone === "error"
                  ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                  : "border-sky-500/40 bg-sky-500/10 text-sky-100",
              )}
            >
              {feedback.message}
            </div>
          ) : null}

          {showJoinRecoveryPanel ? (
            <div
              className={cx(
                "rounded-2xl border p-4 text-sm",
                joinRecoveryIsError
                  ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                  : "border-sky-500/40 bg-sky-500/10 text-sky-100",
              )}
            >
              <p>{joinRecoveryMessage}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void retryJoin();
                  }}
                  disabled={retryingJoin || endingDueToTime}
                  className={cx(
                    "inline-flex h-10 items-center justify-center rounded-full border px-4 text-xs font-semibold uppercase tracking-[0.14em] transition",
                    joinRecoveryIsError
                      ? "border-rose-300/50 bg-rose-400/20 text-rose-100 hover:bg-rose-400/30"
                      : "border-sky-300/50 bg-sky-400/20 text-sky-100 hover:bg-sky-400/30",
                    (retryingJoin || endingDueToTime) &&
                      "cursor-not-allowed opacity-60 hover:bg-inherit",
                  )}
                >
                  {retryingJoin ? "Retrying..." : "Try again"}
                </button>
                <button
                  type="button"
                  onClick={() => router.replace("/feature/live")}
                  className="inline-flex h-10 items-center justify-center rounded-full border border-white/25 bg-white/10 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-white transition hover:bg-white/20"
                >
                  Back to Studio
                </button>
              </div>
            </div>
          ) : null}

          <div className="mx-auto w-full max-w-6xl">
            {peerCount === 0 ? (
              <div className="flex h-[52vh] items-center justify-center rounded-[28px] border border-white/10 bg-black/40 text-sm text-white/60 md:h-[60vh] lg:h-[66vh]">
                {isReconnecting
                  ? "Reconnecting to the session..."
                  : "Connecting to the session..."}
              </div>
            ) : peerCount === 1 ? (
              <div className="h-[52vh] md:h-[60vh] lg:h-[66vh]">
                <VideoTile
                  peerId={visiblePeers[0].id}
                  label={formatLabel(visiblePeers[0])}
                  isLocal={visiblePeers[0].isLocal}
                  className="h-full"
                />
              </div>
            ) : peerCount === 2 ? (
              <div className="grid h-[52vh] gap-3 md:h-[60vh] md:grid-cols-2 lg:h-[66vh]">
                {visiblePeers.map((peer) => (
                  <VideoTile
                    key={peer.id}
                    peerId={peer.id}
                    label={formatLabel(peer)}
                    isLocal={peer.isLocal}
                    className="h-full"
                  />
                ))}
              </div>
            ) : (
              <div className="grid h-[52vh] gap-3 md:h-[60vh] md:grid-cols-2 md:grid-rows-2 lg:h-[66vh]">
                {visiblePeers.slice(0, 2).map((peer) => (
                  <VideoTile
                    key={peer.id}
                    peerId={peer.id}
                    label={formatLabel(peer)}
                    isLocal={peer.isLocal}
                    className="h-full"
                  />
                ))}
                <VideoTile
                  peerId={visiblePeers[2].id}
                  label={formatLabel(visiblePeers[2])}
                  isLocal={visiblePeers[2].isLocal}
                  className="h-full md:col-span-2"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 bg-[#0b1117]/80 px-4 py-4 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={toggleMic}
            disabled={pendingControls.mic || controlsLocked}
            className={cx(
              "inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition",
              isMicOn
                ? "bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"
                : "bg-rose-500/20 text-rose-100 hover:bg-rose-500/30",
              (pendingControls.mic || controlsLocked) &&
                "cursor-not-allowed opacity-60 hover:bg-inherit",
            )}
          >
            {isMicOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            {micLabel}
          </button>

          <button
            type="button"
            onClick={toggleCam}
            disabled={pendingControls.cam || controlsLocked}
            className={cx(
              "inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition",
              isCamOn
                ? "bg-white/10 text-white hover:bg-white/20"
                : "bg-white/10 text-white/70 hover:bg-white/20",
              (pendingControls.cam || controlsLocked) &&
                "cursor-not-allowed opacity-60 hover:bg-inherit",
            )}
          >
            {isCamOn ? (
              <VideoOff className="h-4 w-4" />
            ) : (
              <Video className="h-4 w-4" />
            )}
            {camLabel}
          </button>

          <button
            type="button"
            onClick={toggleScreenShare}
            disabled={pendingControls.screen || controlsLocked}
            className={cx(
              "inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition",
              isShareOn
                ? "bg-indigo-500/20 text-indigo-100 hover:bg-indigo-500/30"
                : "bg-white/10 text-white/70 hover:bg-white/20",
              (pendingControls.screen || controlsLocked) &&
                "cursor-not-allowed opacity-60 hover:bg-inherit",
            )}
          >
            {isShareOn ? (
              <MonitorOff className="h-4 w-4" />
            ) : (
              <MonitorUp className="h-4 w-4" />
            )}
            {shareLabel}
          </button>

          <button
            type="button"
            onClick={togglePip}
            disabled={pendingControls.pip || controlsLocked || !pipTrackId}
            className={cx(
              "inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition",
              isPipActive
                ? "bg-sky-500/20 text-sky-100 hover:bg-sky-500/30"
                : "bg-white/10 text-white/70 hover:bg-white/20",
              (pendingControls.pip || controlsLocked || !pipTrackId) &&
                "cursor-not-allowed opacity-60 hover:bg-inherit",
            )}
          >
            <PictureInPicture2 className="h-4 w-4" />
            {pipLabelText}
          </button>
        </div>
      </div>

      <PipOverlay
        trackId={pipTrackId}
        label={pipLabel}
        active={pipOverlayOn}
        onVideoElement={setPipVideoEl}
      />
    </div>
  );
}
