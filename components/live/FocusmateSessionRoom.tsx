"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  DeviceType,
  selectBroadcastMessages,
  selectConnectionQualities,
  selectIsConnectedToRoom,
  selectIsLocalAudioEnabled,
  selectIsLocalScreenShared,
  selectIsLocalVideoEnabled,
  selectLocalPeer,
  selectPeers,
  selectTracksMap,
  useHMSActions,
  useDevices,
  useHMSStore,
  useVideo,
  type HMSConfigInitialSettings,
  type HMSPeer,
} from "@100mslive/react-sdk";
import {
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  Pin,
  PinOff,
  PictureInPicture2,
  RefreshCcw,
  SlidersHorizontal,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import { csrfFetch } from "@/lib/csrf-client";
import GreenRoom, {
  type GreenRoomJoinPreferences,
} from "@/components/live/GreenRoom";

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
  mainTrackId?: string | null;
  mainTrackKind?: TileTrackKind;
  overlayTrackId?: string | null;
  overlayTrackKind?: TileTrackKind;
  label: string;
  isLocal: boolean;
  onTogglePin?: () => void;
  isPinned?: boolean;
  pinLabel?: string;
  showPresentingBadge?: boolean;
  connectionQuality?: ConnectionQualityView | null;
  reactionEmoji?: ReactionEmoji | null;
  isHandRaised?: boolean;
  showPinControl?: boolean;
  className?: string;
};

type ControlAction = "mic" | "cam" | "screen" | "pip";
type FeedbackTone = "info" | "error";
type ControlPendingState = Record<ControlAction, boolean>;
type ConnectionQualityLevel = "good" | "fair" | "poor";
type ConnectionQualityView = {
  level: ConnectionQualityLevel;
  label: "Good" | "Fair" | "Poor";
  score: number;
};
type AutoVideoMode = "normal" | "reduced";
type AutoVideoNotice = { mode: "reduced"; message: string } | null;
type FixAvAction =
  | "switch-mic"
  | "switch-cam"
  | "switch-speaker"
  | "restart-mic"
  | "restart-cam"
  | "rejoin";
type FixAvPendingState = Partial<Record<FixAvAction, boolean>>;
type ViewTargetKind = "peer-camera" | "peer-screen";
type ViewTarget = { kind: ViewTargetKind; peerId: string };
type PeerMediaView = {
  peer: HMSPeer;
  cameraTrackId: string | null;
  screenTrackId: string | null;
  hasCamera: boolean;
  hasScreen: boolean;
};

type SessionWindow = {
  joinOpenAtMs: number;
  endAtMs: number;
  status: string | null;
};
type TileTrackKind = "camera" | "screen";
type ReactionEmoji = "👍" | "👏" | "😂" | "🔥" | "❤️";
type FocusUiEventType = "focus-ui.v1";
type TimerRunState = "idle" | "running" | "paused";
type TimerWireState = {
  runState: TimerRunState;
  elapsedMs: number;
  startedAtMs: number | null;
  controllerPeerId: string | null;
};
type FocusUiEvent =
  | {
      v: 1;
      kind: "reaction";
      emoji: ReactionEmoji;
      peerId: string;
      sentAtMs: number;
    }
  | {
      v: 1;
      kind: "timer-request";
      peerId: string;
      sentAtMs: number;
    }
  | {
      v: 1;
      kind: "timer-sync";
      peerId: string;
      sentAtMs: number;
      timer: TimerWireState;
    };
type TimerViewState = {
  mode: "shared" | "local";
  runState: TimerRunState;
  elapsedMs: number;
  startedAtMs: number | null;
  controllerPeerId: string | null;
  updatedAtMs: number;
};
type HighlightEntry = {
  id: string;
  createdAtMs: number;
  timerMs: number;
  note: string;
};

const JOIN_TIMEOUT_MS = 45_000;
const JOIN_CONNECTING_HINT_DELAY_MS = 12_000;
const RECONNECT_MAX_RETRIES = 3;
const RECONNECT_BACKOFF_MS = [1_000, 2_500, 5_000];
const JOIN_TIMEOUT_ERROR_CODE = "focus_session_join_timeout";
const JOIN_TIMEOUT_MESSAGE =
  "Your network may be blocking live connections (VPN/corporate Wi-Fi). Try turning off VPN or switching to a hotspot.";
const JOIN_CONNECTING_HINT_MESSAGE =
  "Still connecting—this can take a moment on some networks.";
const JOIN_OFFLINE_MESSAGE =
  "You're offline. Reconnect to the internet and try again.";
const RECONNECT_FAILED_MESSAGE =
  "Connection dropped and reconnect did not complete. Try again.";
const JOIN_GENERIC_ERROR_MESSAGE =
  "Unable to join right now. Please try again.";
const JOIN_PROGRESS_STEPS = [
  "Preparing session...",
  "Connecting securely...",
  "Joining peers...",
  "Almost ready...",
] as const;
const JOIN_PROGRESS_STEP_THRESHOLDS_MS = [0, 1_500, 3_600, 6_500] as const;
const POOR_HOLD_MS = 15_000;
const GOOD_HOLD_MS = 30_000;
const AUTO_ACTION_COOLDOWN_MS = 45_000;
const MANUAL_OVERRIDE_GRACE_MS = 60_000;
const REDUCED_VIDEO_SETTINGS = {
  width: 640,
  height: 360,
  maxFramerate: 12,
} as const;
const NORMAL_VIDEO_SETTINGS = {
  width: 1280,
  height: 720,
  maxFramerate: 24,
} as const;
const FOCUS_UI_EVENT_TYPE: FocusUiEventType = "focus-ui.v1";
const REACTION_TTL_MS = 2_400;
const TIMER_HEARTBEAT_MS = 5_000;
const TIMER_BROADCAST_FAILURE_LIMIT = 2;
const HIGHLIGHT_MAX_NOTE_LENGTH = 160;
const REACTION_EMOJIS: readonly ReactionEmoji[] = [
  "👍",
  "👏",
  "😂",
  "🔥",
  "❤️",
];
const TIMER_DEFAULT_STATE: TimerViewState = {
  mode: "shared",
  runState: "idle",
  elapsedMs: 0,
  startedAtMs: null,
  controllerPeerId: null,
  updatedAtMs: 0,
};

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

function resolveDeviceLabel(
  devices: MediaDeviceInfo[],
  deviceId: string | null | undefined,
  fallback: string,
) {
  if (!deviceId) return "Not selected";
  const match = devices.find((device) => device.deviceId === deviceId);
  const label = match?.label?.trim();
  if (label) return label;
  if (match) return fallback;
  return "Unknown device";
}

function classifyConnectionQuality(raw: unknown): ConnectionQualityView | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const score = Math.max(0, Math.min(100, raw));
  if (score >= 80) {
    return { level: "good", label: "Good", score };
  }
  if (score >= 45) {
    return { level: "fair", label: "Fair", score };
  }
  return { level: "poor", label: "Poor", score };
}

function qualityToneClasses(level: ConnectionQualityLevel) {
  if (level === "good") {
    return {
      chip: "border-emerald-400/40 bg-emerald-500/12 text-emerald-100",
      badge: "border-emerald-300/30 bg-emerald-500/15 text-emerald-100",
      hint: "text-emerald-100/75",
    };
  }
  if (level === "fair") {
    return {
      chip: "border-amber-300/45 bg-amber-400/12 text-amber-100",
      badge: "border-amber-300/35 bg-amber-400/15 text-amber-100",
      hint: "text-amber-100/75",
    };
  }
  return {
    chip: "border-rose-300/45 bg-rose-500/14 text-rose-100",
    badge: "border-rose-300/35 bg-rose-500/18 text-rose-100",
    hint: "text-rose-100/80",
  };
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

function mapJoinServerError(message: unknown) {
  if (typeof message !== "string" || message.trim().length === 0) {
    return JOIN_GENERIC_ERROR_MESSAGE;
  }

  const normalized = message.toLowerCase();
  if (normalized.includes("reserve a spot")) {
    return "Reserve a spot in Live Studio before joining this session.";
  }
  if (normalized.includes("join window has not opened")) {
    return "This session has not opened yet. Try again closer to the start time.";
  }
  if (normalized.includes("session has ended")) {
    return "This session has ended.";
  }
  if (normalized.includes("session is not available")) {
    return "This session is not available right now.";
  }
  if (normalized.includes("unauthorized")) {
    return "Please sign in again and try joining.";
  }
  if (normalized.includes("offline")) {
    return JOIN_OFFLINE_MESSAGE;
  }
  if (
    normalized.includes("timed out") ||
    normalized.includes("network") ||
    normalized.includes("websocket") ||
    normalized.includes("csp")
  ) {
    return JOIN_TIMEOUT_MESSAGE;
  }
  return JOIN_GENERIC_ERROR_MESSAGE;
}

function mapJoinUnexpectedError(error: unknown) {
  if (isJoinTimeoutError(error)) return JOIN_TIMEOUT_MESSAGE;
  const blob = readErrorBlob(error);
  const likelyNetworkIssue =
    blob.includes("timed out") ||
    blob.includes("websocket") ||
    blob.includes("csp") ||
    blob.includes("network") ||
    blob.includes("transport") ||
    blob.includes("failed to fetch") ||
    blob.includes("ice");

  if (likelyNetworkIssue) return JOIN_TIMEOUT_MESSAGE;
  if (
    blob.includes("notallowederror") ||
    blob.includes("permission denied") ||
    blob.includes("permission blocked")
  ) {
    return "Camera or microphone permission is blocked. Check browser permissions and try again.";
  }
  return JOIN_GENERIC_ERROR_MESSAGE;
}

function buildJoinSettings(preferences: GreenRoomJoinPreferences | null) {
  if (!preferences) return undefined;

  const settings: HMSConfigInitialSettings = {};
  if (preferences.joinMuted || preferences.forceAudioMuted) {
    settings.isAudioMuted = true;
  }
  if (preferences.joinWithCameraOff || preferences.forceVideoMuted) {
    settings.isVideoMuted = true;
  }
  if (preferences.audioInputDeviceId) {
    settings.audioInputDeviceId = preferences.audioInputDeviceId;
  }
  if (preferences.videoDeviceId) {
    settings.videoDeviceId = preferences.videoDeviceId;
  }
  if (preferences.audioOutputDeviceId) {
    settings.audioOutputDeviceId = preferences.audioOutputDeviceId;
  }

  return Object.keys(settings).length > 0 ? settings : undefined;
}

function viewTargetKey(target: ViewTarget) {
  return `${target.kind}:${target.peerId}`;
}

function isSameTarget(a: ViewTarget | null, b: ViewTarget | null) {
  if (!a || !b) return false;
  return a.kind === b.kind && a.peerId === b.peerId;
}

function isTargetAvailable(target: ViewTarget, views: PeerMediaView[]) {
  const peerView = views.find((view) => view.peer.id === target.peerId);
  if (!peerView) return false;
  if (target.kind === "peer-screen") return peerView.hasScreen;
  return true;
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

function getHighlightsStorageKey(sessionId: string, userId: string) {
  return `focus-highlights:${sessionId}:${userId}`;
}

function isReactionEmoji(value: unknown): value is ReactionEmoji {
  return (
    typeof value === "string" &&
    REACTION_EMOJIS.includes(value as ReactionEmoji)
  );
}

function normalizeTimerWireState(raw: unknown): TimerWireState | null {
  if (!raw || typeof raw !== "object") return null;
  const timer = raw as Record<string, unknown>;
  const runState =
    timer.runState === "idle" ||
    timer.runState === "running" ||
    timer.runState === "paused"
      ? timer.runState
      : null;
  if (!runState) return null;
  const elapsedMs =
    typeof timer.elapsedMs === "number" && Number.isFinite(timer.elapsedMs)
      ? Math.max(0, timer.elapsedMs)
      : NaN;
  if (!Number.isFinite(elapsedMs)) return null;
  const startedAtMs =
    timer.startedAtMs === null
      ? null
      : typeof timer.startedAtMs === "number" &&
          Number.isFinite(timer.startedAtMs)
        ? timer.startedAtMs
        : null;
  const controllerPeerId =
    typeof timer.controllerPeerId === "string" && timer.controllerPeerId.length > 0
      ? timer.controllerPeerId
      : null;

  return {
    runState,
    elapsedMs,
    startedAtMs,
    controllerPeerId,
  };
}

function parseFocusUiEvent(rawMessage: unknown): FocusUiEvent | null {
  let parsed: unknown = rawMessage;
  if (typeof rawMessage === "string") {
    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (record.v !== 1) return null;
  if (typeof record.peerId !== "string" || record.peerId.length === 0) return null;
  if (typeof record.sentAtMs !== "number" || !Number.isFinite(record.sentAtMs)) {
    return null;
  }
  if (record.kind === "reaction") {
    if (!isReactionEmoji(record.emoji)) return null;
    return {
      v: 1,
      kind: "reaction",
      emoji: record.emoji,
      peerId: record.peerId,
      sentAtMs: record.sentAtMs,
    };
  }
  if (record.kind === "timer-request") {
    return {
      v: 1,
      kind: "timer-request",
      peerId: record.peerId,
      sentAtMs: record.sentAtMs,
    };
  }
  if (record.kind === "timer-sync") {
    const timer = normalizeTimerWireState(record.timer);
    if (!timer) return null;
    return {
      v: 1,
      kind: "timer-sync",
      peerId: record.peerId,
      sentAtMs: record.sentAtMs,
      timer,
    };
  }
  return null;
}

function getTimerElapsedMs(state: TimerViewState, nowMs: number) {
  if (state.runState !== "running" || state.startedAtMs === null) {
    return Math.max(0, state.elapsedMs);
  }
  return Math.max(0, state.elapsedMs + (nowMs - state.startedAtMs));
}

function formatDurationLabel(totalMs: number) {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1_000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3_600);
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
      2,
      "0",
    )}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function normalizeHighlightEntry(raw: unknown): HighlightEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) return null;
  if (
    typeof record.createdAtMs !== "number" ||
    !Number.isFinite(record.createdAtMs)
  ) {
    return null;
  }
  if (typeof record.timerMs !== "number" || !Number.isFinite(record.timerMs)) {
    return null;
  }
  if (typeof record.note !== "string") return null;
  return {
    id: record.id,
    createdAtMs: record.createdAtMs,
    timerMs: Math.max(0, record.timerMs),
    note: record.note.slice(0, HIGHLIGHT_MAX_NOTE_LENGTH),
  };
}

function buildHighlightsExportText(sessionId: string, highlights: HighlightEntry[]) {
  const header = [
    `Focus session highlights`,
    `Session: ${sessionId}`,
    `Exported: ${new Date().toLocaleString()}`,
    "",
  ];
  if (highlights.length === 0) {
    return [...header, "No highlights saved."].join("\n");
  }
  const lines = [...highlights]
    .sort((a, b) => a.createdAtMs - b.createdAtMs)
    .map((item) => {
      const timestamp = formatDurationLabel(item.timerMs);
      return item.note ? `[${timestamp}] ${item.note}` : `[${timestamp}]`;
    });
  return [...header, ...lines].join("\n");
}

function VideoTile({
  mainTrackId,
  mainTrackKind = "camera",
  overlayTrackId,
  overlayTrackKind = "camera",
  label,
  isLocal,
  onTogglePin,
  isPinned = false,
  pinLabel,
  showPresentingBadge = false,
  connectionQuality,
  reactionEmoji,
  isHandRaised = false,
  showPinControl = true,
  className,
}: VideoTileProps) {
  const { videoRef: mainVideoRef } = useVideo({
    trackId: mainTrackId ?? undefined,
  });
  const { videoRef: overlayVideoRef } = useVideo({
    trackId: overlayTrackId ?? undefined,
  });

  return (
    <div
      className={cx(
        "group relative overflow-hidden rounded-[28px] border border-white/10 bg-black/80 shadow-[0_20px_60px_rgba(0,0,0,0.45)]",
        className,
      )}
    >
      {mainTrackId ? (
        <video
          ref={mainVideoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={cx(
            "h-full w-full",
            mainTrackKind === "screen" ? "object-contain" : "object-cover",
            mainTrackKind === "camera" && isLocal && "scale-x-[-1]",
          )}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-black/70 text-sm text-white/60">
          Camera off
        </div>
      )}
      {showPresentingBadge || connectionQuality || isHandRaised ? (
        <div className="absolute left-3 top-3 z-10 flex flex-col gap-2">
          {showPresentingBadge ? (
            <div className="rounded-full border border-indigo-300/35 bg-indigo-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-100 backdrop-blur">
              Presenting
            </div>
          ) : null}
          {isHandRaised ? (
            <div className="rounded-full border border-amber-300/35 bg-amber-400/18 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-100 backdrop-blur">
              Hand raised
            </div>
          ) : null}
          {connectionQuality ? (
            <div
              className={cx(
                "rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] backdrop-blur",
                qualityToneClasses(connectionQuality.level).badge,
              )}
            >
              {connectionQuality.label}
            </div>
          ) : null}
        </div>
      ) : null}
      {onTogglePin && showPinControl ? (
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={pinLabel ?? (isPinned ? "Unpin view" : "Pin view")}
          className={cx(
            "absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white/80 opacity-90 backdrop-blur transition hover:bg-black/75 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400",
            !isPinned && "md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
          )}
        >
          {isPinned ? (
            <PinOff className="h-4 w-4" aria-hidden />
          ) : (
            <Pin className="h-4 w-4" aria-hidden />
          )}
        </button>
      ) : null}
      {reactionEmoji ? (
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-5 z-10 -translate-x-1/2 rounded-full border border-white/30 bg-black/60 px-3 py-1 text-xl shadow-[0_12px_30px_rgba(0,0,0,0.4)] backdrop-blur"
        >
          {reactionEmoji}
        </div>
      ) : null}
      {overlayTrackId ? (
        <div className="absolute bottom-3 right-3 z-10 h-[28%] w-[28%] min-h-[72px] min-w-[120px] overflow-hidden rounded-xl border border-white/15 bg-black/85 shadow-[0_8px_24px_rgba(0,0,0,0.55)]">
          <video
            ref={overlayVideoRef}
            autoPlay
            playsInline
            muted={isLocal}
            className={cx(
              "h-full w-full",
              overlayTrackKind === "screen" ? "object-contain" : "object-cover",
              overlayTrackKind === "camera" && isLocal && "scale-x-[-1]",
            )}
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
  trackKind?: TileTrackKind;
  label: string;
  active: boolean;
  onVideoElement: (node: HTMLVideoElement | null) => void;
};

function PipOverlay({
  trackId,
  trackKind = "camera",
  label,
  active,
  onVideoElement,
}: PipOverlayProps) {
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
          className={cx(
            "h-full w-full",
            trackKind === "screen" ? "object-contain" : "object-cover",
          )}
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
  const { allDevices, selectedDeviceIDs, updateDevice } = useDevices((error) => {
    throw error;
  });
  const isConnected = useHMSStore(selectIsConnectedToRoom);
  const peers = useHMSStore(selectPeers);
  const tracksMap = useHMSStore(selectTracksMap);
  const broadcastMessages = useHMSStore(selectBroadcastMessages);
  const connectionQualities = useHMSStore(selectConnectionQualities);
  const localPeer = useHMSStore(selectLocalPeer);
  const isMicOn = useHMSStore(selectIsLocalAudioEnabled);
  const isCamOn = useHMSStore(selectIsLocalVideoEnabled);
  const isShareOn = useHMSStore(selectIsLocalScreenShared);

  const [joining, setJoining] = React.useState(false);
  const [joinError, setJoinError] = React.useState<string | null>(null);
  const [joinRequested, setJoinRequested] = React.useState(false);
  const [joinPreferences, setJoinPreferences] =
    React.useState<GreenRoomJoinPreferences | null>(null);
  const [joinAttemptNonce, setJoinAttemptNonce] = React.useState(0);
  const [joinProgressStepIndex, setJoinProgressStepIndex] = React.useState(0);
  const [showJoinConnectingHint, setShowJoinConnectingHint] =
    React.useState(false);
  const [hasConnectedOnce, setHasConnectedOnce] = React.useState(false);
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
  const [autoVideoMode, setAutoVideoMode] = React.useState<AutoVideoMode>("normal");
  const [autoVideoNotice, setAutoVideoNotice] =
    React.useState<AutoVideoNotice>(null);
  const [isFixAvOpen, setIsFixAvOpen] = React.useState(false);
  const [fixAvPending, setFixAvPending] = React.useState<FixAvPendingState>({});
  const [quietModeEnabled, setQuietModeEnabled] = React.useState(false);
  const [quietModeIncomingMuted, setQuietModeIncomingMuted] = React.useState(false);
  const [quietModePending, setQuietModePending] = React.useState(false);
  const [handActionPending, setHandActionPending] = React.useState(false);
  const [isReactionPickerOpen, setIsReactionPickerOpen] = React.useState(false);
  const [reactionByPeerId, setReactionByPeerId] = React.useState<
    Record<string, ReactionEmoji>
  >({});
  const [isTimerPanelOpen, setIsTimerPanelOpen] = React.useState(false);
  const [timerActionPending, setTimerActionPending] = React.useState(false);
  const [timerNowMs, setTimerNowMs] = React.useState(() => Date.now());
  const [timerState, setTimerState] = React.useState<TimerViewState>(() => ({
    ...TIMER_DEFAULT_STATE,
    updatedAtMs: Date.now(),
  }));
  const [isHighlightsPanelOpen, setIsHighlightsPanelOpen] = React.useState(false);
  const [highlightDraft, setHighlightDraft] = React.useState("");
  const [highlights, setHighlights] = React.useState<HighlightEntry[]>([]);
  const [hasHydratedHighlights, setHasHydratedHighlights] = React.useState(false);
  const [pendingControls, setPendingControls] =
    React.useState<ControlPendingState>({
      mic: false,
      cam: false,
      screen: false,
      pip: false,
    });
  const [pinnedTarget, setPinnedTarget] = React.useState<ViewTarget | null>(null);

  const joinAttemptHandledRef = React.useRef<number | null>(null);
  const sessionEndingHandledRef = React.useRef(false);
  const hasConnectedOnceRef = React.useRef(false);
  const wasConnectedRef = React.useRef(false);
  const reconnectInFlightRef = React.useRef(false);
  const skipNextAutoReconnectRef = React.useRef(false);
  const joinProgressStartedAtRef = React.useRef<number | null>(null);
  const poorSinceRef = React.useRef<number | null>(null);
  const goodSinceRef = React.useRef<number | null>(null);
  const lastAutoActionAtRef = React.useRef(0);
  const manualOverrideUntilRef = React.useRef(0);
  const autoVideoActionInFlightRef = React.useRef<AutoVideoMode | null>(null);
  const reactionTimeoutsRef = React.useRef<Record<string, number>>(
    {},
  );
  const processedFocusUiMessageIdsRef = React.useRef<Set<string>>(new Set());
  const timerStateRef = React.useRef<TimerViewState>({
    ...TIMER_DEFAULT_STATE,
    updatedAtMs: Date.now(),
  });
  const timerBroadcastFailureCountRef = React.useRef(0);
  const timerRequestControllerRef = React.useRef<string | null>(null);
  const highlightStorageWarnedRef = React.useRef(false);
  const quietModeVolumeSnapshotRef = React.useRef<Record<string, number> | null>(
    null,
  );
  const quietModeMutedTrackIdsRef = React.useRef<Set<string>>(new Set());
  const highlightsStorageKey = React.useMemo(
    () => getHighlightsStorageKey(sessionId, user.id),
    [sessionId, user.id],
  );

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
  const supportsSpeakerSelection = React.useMemo(() => {
    if (typeof window === "undefined") return false;
    const prototype = window.HTMLMediaElement?.prototype as {
      setSinkId?: (deviceId: string) => Promise<void>;
    };
    return Boolean(prototype?.setSinkId);
  }, []);
  const audioInputDevices = React.useMemo(
    () => allDevices[DeviceType.audioInput] ?? [],
    [allDevices],
  );
  const videoInputDevices = React.useMemo(
    () => allDevices[DeviceType.videoInput] ?? [],
    [allDevices],
  );
  const audioOutputDevices = React.useMemo(
    () => allDevices[DeviceType.audioOutput] ?? [],
    [allDevices],
  );
  const selectedAudioInputDeviceId =
    selectedDeviceIDs[DeviceType.audioInput] ?? null;
  const selectedVideoInputDeviceId =
    selectedDeviceIDs[DeviceType.videoInput] ?? null;
  const selectedAudioOutputDeviceId =
    selectedDeviceIDs[DeviceType.audioOutput] ?? null;
  const currentMicLabel = React.useMemo(
    () =>
      resolveDeviceLabel(
        audioInputDevices,
        selectedAudioInputDeviceId,
        "Microphone",
      ),
    [audioInputDevices, selectedAudioInputDeviceId],
  );
  const currentCameraLabel = React.useMemo(
    () =>
      resolveDeviceLabel(videoInputDevices, selectedVideoInputDeviceId, "Camera"),
    [selectedVideoInputDeviceId, videoInputDevices],
  );
  const currentSpeakerLabel = React.useMemo(
    () =>
      resolveDeviceLabel(
        audioOutputDevices,
        selectedAudioOutputDeviceId,
        "Speaker",
      ),
    [audioOutputDevices, selectedAudioOutputDeviceId],
  );
  const hasFixAvPending = React.useMemo(
    () => Object.values(fixAvPending).some(Boolean),
    [fixAvPending],
  );
  const remoteAudioTrackEntries = React.useMemo(() => {
    return Object.values(tracksMap)
      .filter((track) => {
        return (
          track.type === "audio" &&
          Boolean(track.peerId) &&
          track.peerId !== localPeer?.id
        );
      })
      .map((track) => {
        const audioTrack = track as { id: string; volume?: number };
        const volume =
          typeof audioTrack.volume === "number" &&
          Number.isFinite(audioTrack.volume)
            ? Math.max(0, Math.min(100, audioTrack.volume))
            : 100;
        return {
          trackId: audioTrack.id,
          volume,
        };
      });
  }, [localPeer?.id, tracksMap]);
  const isLocalHandRaised = Boolean(localPeer?.isHandRaised);
  const orderedPeersByJoinTime = React.useMemo(() => {
    const next = [...peers];
    next.sort((a, b) => {
      const aJoin =
        a.joinedAt instanceof Date ? a.joinedAt.getTime() : Number.MAX_SAFE_INTEGER;
      const bJoin =
        b.joinedAt instanceof Date ? b.joinedAt.getTime() : Number.MAX_SAFE_INTEGER;
      if (aJoin !== bJoin) return aJoin - bJoin;
      return a.id.localeCompare(b.id);
    });
    return next;
  }, [peers]);
  const fallbackTimerControllerPeerId = React.useMemo(() => {
    const hostLike = orderedPeersByJoinTime.find((peer) =>
      /host|admin/i.test(peer.roleName ?? ""),
    );
    return hostLike?.id ?? orderedPeersByJoinTime[0]?.id ?? null;
  }, [orderedPeersByJoinTime]);

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
  const setFixPending = React.useCallback(
    (action: FixAvAction, pending: boolean) => {
      setFixAvPending((prev) => {
        if ((prev[action] ?? false) === pending) return prev;
        if (pending) return { ...prev, [action]: true };
        const next = { ...prev };
        delete next[action];
        return next;
      });
    },
    [],
  );
  const applyReaction = React.useCallback((peerId: string, emoji: ReactionEmoji) => {
    if (!peerId) return;
    setReactionByPeerId((prev) => ({ ...prev, [peerId]: emoji }));
    const existingTimeout = reactionTimeoutsRef.current[peerId];
    if (existingTimeout) {
      window.clearTimeout(existingTimeout);
    }
    reactionTimeoutsRef.current[peerId] = window.setTimeout(() => {
      setReactionByPeerId((prev) => {
        if (!prev[peerId]) return prev;
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
      delete reactionTimeoutsRef.current[peerId];
    }, REACTION_TTL_MS);
  }, []);

  const sendFocusUiEvent = React.useCallback(
    async (
      payload: FocusUiEvent,
      options?: { timerCritical?: boolean; suppressFeedback?: boolean },
    ) => {
      if (!isConnected) return false;
      try {
        await hmsActions.sendBroadcastMessage(
          JSON.stringify(payload),
          FOCUS_UI_EVENT_TYPE,
        );
        if (options?.timerCritical) {
          timerBroadcastFailureCountRef.current = 0;
        }
        return true;
      } catch (err) {
        console.error("[focus sessions] focus ui event failed", err);
        if (options?.timerCritical) {
          timerBroadcastFailureCountRef.current += 1;
          if (
            timerBroadcastFailureCountRef.current >= TIMER_BROADCAST_FAILURE_LIMIT
          ) {
            if (timerStateRef.current.mode !== "local") {
              setTimerState((prev) => {
                if (prev.mode === "local") return prev;
                const next: TimerViewState = {
                  ...prev,
                  mode: "local",
                  controllerPeerId: localPeer?.id ?? prev.controllerPeerId,
                  updatedAtMs: Date.now(),
                };
                timerStateRef.current = next;
                return next;
              });
              showFeedback("Shared timer unavailable. Switched to local timer.");
            }
          }
        } else if (!options?.suppressFeedback) {
          showFeedback("Unable to sync this action right now.", "error");
        }
        return false;
      }
    },
    [hmsActions, isConnected, localPeer?.id, showFeedback],
  );

  const timerControllerPeerId = React.useMemo(() => {
    if (timerState.mode === "local") {
      return localPeer?.id ?? timerState.controllerPeerId ?? fallbackTimerControllerPeerId;
    }
    if (
      timerState.controllerPeerId &&
      peers.some((peer) => peer.id === timerState.controllerPeerId)
    ) {
      return timerState.controllerPeerId;
    }
    return fallbackTimerControllerPeerId;
  }, [
    fallbackTimerControllerPeerId,
    localPeer?.id,
    peers,
    timerState.controllerPeerId,
    timerState.mode,
  ]);
  const isTimerController = React.useMemo(() => {
    if (!localPeer?.id) return false;
    if (timerState.mode === "local") return true;
    return timerControllerPeerId === localPeer.id;
  }, [localPeer?.id, timerControllerPeerId, timerState.mode]);
  const timerControllerLabel = React.useMemo(() => {
    if (!timerControllerPeerId) return "Unknown";
    return formatLabel(peers.find((peer) => peer.id === timerControllerPeerId) ?? null);
  }, [peers, timerControllerPeerId]);
  const timerElapsedMs = React.useMemo(
    () => getTimerElapsedMs(timerState, timerNowMs),
    [timerNowMs, timerState],
  );
  const timerLabel = timerState.mode === "local" ? "Local timer" : "Shared timer";
  const timerDisplayLabel = React.useMemo(
    () => formatDurationLabel(timerElapsedMs),
    [timerElapsedMs],
  );
  const timerControlsDisabled =
    timerActionPending || joining || retryingJoin || endingDueToTime || !isConnected;

  const persistTimerState = React.useCallback((next: TimerViewState) => {
    timerStateRef.current = next;
    setTimerState(next);
    setTimerNowMs(Date.now());
  }, []);

  const publishTimerSync = React.useCallback(
    async (stateToPublish: TimerViewState) => {
      if (stateToPublish.mode !== "shared") return true;
      if (!localPeer?.id) return false;
      const payload: FocusUiEvent = {
        v: 1,
        kind: "timer-sync",
        peerId: localPeer.id,
        sentAtMs: Date.now(),
        timer: {
          runState: stateToPublish.runState,
          elapsedMs: stateToPublish.elapsedMs,
          startedAtMs: stateToPublish.startedAtMs,
          controllerPeerId: stateToPublish.controllerPeerId,
        },
      };
      return sendFocusUiEvent(payload, {
        timerCritical: true,
        suppressFeedback: true,
      });
    },
    [localPeer?.id, sendFocusUiEvent],
  );

  const applyReducedVideoProfile = React.useCallback(async () => {
    if (autoVideoMode === "reduced") return;
    if (autoVideoActionInFlightRef.current) return;
    autoVideoActionInFlightRef.current = "reduced";
    try {
      await hmsActions.setVideoSettings(REDUCED_VIDEO_SETTINGS);
      setAutoVideoMode("reduced");
      setAutoVideoNotice({
        mode: "reduced",
        message: "We reduced video quality to keep audio smooth.",
      });
      lastAutoActionAtRef.current = Date.now();
      poorSinceRef.current = null;
      goodSinceRef.current = null;
    } catch (err) {
      console.error("[focus sessions] auto reduce video profile failed", err);
      showFeedback("Connection is weak. Try turning camera off or switching networks.");
    } finally {
      lastAutoActionAtRef.current = Date.now();
      autoVideoActionInFlightRef.current = null;
    }
  }, [autoVideoMode, hmsActions, showFeedback]);

  const restoreNormalVideoProfile = React.useCallback(
    async (source: "auto" | "manual") => {
      if (autoVideoActionInFlightRef.current) return;
      if (autoVideoMode === "normal" && !autoVideoNotice) return;
      autoVideoActionInFlightRef.current = "normal";
      try {
        await hmsActions.setVideoSettings(NORMAL_VIDEO_SETTINGS);
        setAutoVideoMode("normal");
        setAutoVideoNotice(null);
        lastAutoActionAtRef.current = Date.now();
        poorSinceRef.current = null;
        goodSinceRef.current = null;
        if (source === "manual") {
          showFeedback("Video quality restored.");
        }
      } catch (err) {
        console.error("[focus sessions] auto restore video profile failed", err);
        if (source === "manual") {
          showFeedback("Unable to restore video quality right now.", "error");
        }
      } finally {
        lastAutoActionAtRef.current = Date.now();
        autoVideoActionInFlightRef.current = null;
      }
    },
    [autoVideoMode, autoVideoNotice, hmsActions, showFeedback],
  );

  const handleManualRestoreVideo = React.useCallback(() => {
    manualOverrideUntilRef.current = Date.now() + MANUAL_OVERRIDE_GRACE_MS;
    void restoreNormalVideoProfile("manual");
  }, [restoreNormalVideoProfile]);

  React.useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 2600);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  React.useEffect(() => {
    timerStateRef.current = timerState;
  }, [timerState]);

  React.useEffect(() => {
    return () => {
      Object.values(reactionTimeoutsRef.current).forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      reactionTimeoutsRef.current = {};
    };
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(highlightsStorageKey);
      if (!raw) {
        setHighlights([]);
      } else {
        const parsed = JSON.parse(raw);
        const next = Array.isArray(parsed)
          ? parsed
              .map((item) => normalizeHighlightEntry(item))
              .filter((item): item is HighlightEntry => Boolean(item))
          : [];
        setHighlights(next);
      }
    } catch (err) {
      console.error("[focus sessions] highlights hydration failed", err);
      setHighlights([]);
      if (!highlightStorageWarnedRef.current) {
        highlightStorageWarnedRef.current = true;
        showFeedback("Highlights are available for this tab only.");
      }
    } finally {
      setHasHydratedHighlights(true);
    }
  }, [highlightsStorageKey, showFeedback]);

  React.useEffect(() => {
    if (!hasHydratedHighlights) return;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(highlightsStorageKey, JSON.stringify(highlights));
    } catch (err) {
      console.error("[focus sessions] highlights persist failed", err);
      if (!highlightStorageWarnedRef.current) {
        highlightStorageWarnedRef.current = true;
        showFeedback("Highlights are available for this tab only.");
      }
    }
  }, [hasHydratedHighlights, highlights, highlightsStorageKey, showFeedback]);

  React.useEffect(() => {
    if (!isConnected) {
      setIsReactionPickerOpen(false);
      setIsTimerPanelOpen(false);
      setIsHighlightsPanelOpen(false);
      return;
    }
    const validPeerIds = new Set(peers.map((peer) => peer.id));
    setReactionByPeerId((prev) => {
      let changed = false;
      const next: Record<string, ReactionEmoji> = {};
      for (const [peerId, emoji] of Object.entries(prev)) {
        if (validPeerIds.has(peerId)) {
          next[peerId] = emoji;
        } else {
          changed = true;
          const timeoutId = reactionTimeoutsRef.current[peerId];
          if (timeoutId) {
            window.clearTimeout(timeoutId);
            delete reactionTimeoutsRef.current[peerId];
          }
        }
      }
      return changed ? next : prev;
    });
  }, [isConnected, peers]);

  React.useEffect(() => {
    if (!quietModeEnabled) return;
    setIsReactionPickerOpen(false);
    setIsTimerPanelOpen(false);
    setIsHighlightsPanelOpen(false);
  }, [quietModeEnabled]);

  React.useEffect(() => {
    if (!isReactionPickerOpen && !isTimerPanelOpen && !isHighlightsPanelOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsReactionPickerOpen(false);
      setIsTimerPanelOpen(false);
      setIsHighlightsPanelOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isHighlightsPanelOpen, isReactionPickerOpen, isTimerPanelOpen]);

  React.useEffect(() => {
    if (!isConnected) return;
    if (timerState.runState !== "running") return;
    const timer = window.setInterval(() => {
      setTimerNowMs(Date.now());
    }, 1_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [isConnected, timerState.runState]);

  React.useEffect(() => {
    if (!isConnected) return;
    if (timerState.mode !== "shared") return;
    setTimerState((prev) => {
      const controllerPeerId =
        prev.controllerPeerId &&
        peers.some((peer) => peer.id === prev.controllerPeerId)
          ? prev.controllerPeerId
          : fallbackTimerControllerPeerId;
      if (controllerPeerId === prev.controllerPeerId) return prev;
      const next = {
        ...prev,
        controllerPeerId,
        updatedAtMs: Date.now(),
      };
      timerStateRef.current = next;
      return next;
    });
  }, [fallbackTimerControllerPeerId, isConnected, peers, timerState.mode]);

  React.useEffect(() => {
    if (!isConnected) return;
    if (!localPeer?.id) return;
    if (timerState.mode !== "shared") return;
    if (isTimerController) return;
    const requestKey = `${localPeer.id}:${timerControllerPeerId ?? "none"}`;
    if (timerRequestControllerRef.current === requestKey) return;
    timerRequestControllerRef.current = requestKey;
    const payload: FocusUiEvent = {
      v: 1,
      kind: "timer-request",
      peerId: localPeer.id,
      sentAtMs: Date.now(),
    };
    void sendFocusUiEvent(payload, { timerCritical: true, suppressFeedback: true });
  }, [
    isConnected,
    isTimerController,
    localPeer?.id,
    sendFocusUiEvent,
    timerControllerPeerId,
    timerState.mode,
  ]);

  React.useEffect(() => {
    if (!isTimerPanelOpen) return;
    timerRequestControllerRef.current = null;
  }, [isTimerPanelOpen]);

  React.useEffect(() => {
    if (isConnected) return;
    timerBroadcastFailureCountRef.current = 0;
    timerRequestControllerRef.current = null;
    processedFocusUiMessageIdsRef.current.clear();
    persistTimerState({
      ...TIMER_DEFAULT_STATE,
      updatedAtMs: Date.now(),
      controllerPeerId: null,
    });
  }, [isConnected, persistTimerState]);

  React.useEffect(() => {
    if (!isConnected) return;
    if (timerState.mode !== "shared") return;
    if (!isTimerController) return;
    if (timerState.runState !== "running") return;
    const timer = window.setInterval(() => {
      void publishTimerSync(timerStateRef.current);
    }, TIMER_HEARTBEAT_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [
    isConnected,
    isTimerController,
    publishTimerSync,
    timerState.mode,
    timerState.runState,
  ]);

  React.useEffect(() => {
    if (!broadcastMessages || broadcastMessages.length === 0) return;
    for (const message of broadcastMessages) {
      if (processedFocusUiMessageIdsRef.current.has(message.id)) continue;
      processedFocusUiMessageIdsRef.current.add(message.id);
      if (message.type !== FOCUS_UI_EVENT_TYPE) continue;
      const event = parseFocusUiEvent(message.message);
      if (!event) continue;

      if (event.kind === "reaction") {
        applyReaction(event.peerId, event.emoji);
        continue;
      }

      if (event.kind === "timer-request") {
        if (
          timerStateRef.current.mode === "shared" &&
          isTimerController &&
          event.peerId !== localPeer?.id
        ) {
          void publishTimerSync(timerStateRef.current);
        }
        continue;
      }

      if (timerStateRef.current.mode === "local") continue;
      setTimerState((prev) => {
        if (prev.mode === "local") return prev;
        if (event.sentAtMs < prev.updatedAtMs) return prev;
        const next: TimerViewState = {
          mode: "shared",
          runState: event.timer.runState,
          elapsedMs: Math.max(0, event.timer.elapsedMs),
          startedAtMs: event.timer.startedAtMs,
          controllerPeerId: event.timer.controllerPeerId ?? event.peerId,
          updatedAtMs: event.sentAtMs,
        };
        timerStateRef.current = next;
        return next;
      });
      setTimerNowMs(Date.now());
    }
  }, [
    applyReaction,
    broadcastMessages,
    isTimerController,
    localPeer?.id,
    publishTimerSync,
  ]);

  React.useEffect(() => {
    if (isConnected) return;
    setIsFixAvOpen(false);
    setQuietModeEnabled(false);
    setQuietModeIncomingMuted(false);
    setQuietModePending(false);
    quietModeVolumeSnapshotRef.current = null;
    quietModeMutedTrackIdsRef.current.clear();
    setHandActionPending(false);
  }, [isConnected]);

  React.useEffect(() => {
    if (!isFixAvOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsFixAvOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFixAvOpen]);

  React.useEffect(() => {
    if (isConnected && !endingDueToTime) return;
    poorSinceRef.current = null;
    goodSinceRef.current = null;
    lastAutoActionAtRef.current = 0;
    manualOverrideUntilRef.current = 0;
    autoVideoActionInFlightRef.current = null;
    setAutoVideoNotice(null);
    setAutoVideoMode("normal");
  }, [endingDueToTime, isConnected]);

  React.useEffect(() => {
    if (isCamOn) return;
    poorSinceRef.current = null;
    goodSinceRef.current = null;
    setAutoVideoNotice(null);
  }, [isCamOn]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const syncOfflineState = () => {
      const offline = readIsOffline();
      setIsOffline(offline);
      const shouldSurfaceOfflineError =
        joining || retryingJoin || hasConnectedOnce || joinRequested;
      if (offline && !isConnected) {
        if (shouldSurfaceOfflineError) {
          setJoinError((current) => current ?? JOIN_OFFLINE_MESSAGE);
        }
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
  }, [hasConnectedOnce, isConnected, joinRequested, joining, retryingJoin]);

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
    if (!isConnected) return;
    setHasConnectedOnce(true);
  }, [isConnected]);

  React.useEffect(() => {
    hasConnectedOnceRef.current = hasConnectedOnce;
  }, [hasConnectedOnce]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const authToken = window.sessionStorage.getItem(joinTokenStorageKey);
    const hasLeftFlag = Boolean(window.sessionStorage.getItem(leftSessionStorageKey));
    if (!authToken && hasLeftFlag && isWithinJoinWindow) {
      setSessionClosedByHistory(true);
    }
  }, [isWithinJoinWindow, joinTokenStorageKey, leftSessionStorageKey]);

  React.useEffect(() => {
    if (!joining || isConnected || Boolean(joinError)) {
      joinProgressStartedAtRef.current = null;
      setJoinProgressStepIndex(0);
      return;
    }
    if (joinProgressStartedAtRef.current === null) {
      joinProgressStartedAtRef.current = Date.now();
    }

    const updateProgress = () => {
      const startAt = joinProgressStartedAtRef.current ?? Date.now();
      const elapsed = Date.now() - startAt;
      let nextStep = 0;
      for (let index = JOIN_PROGRESS_STEP_THRESHOLDS_MS.length - 1; index >= 0; index -= 1) {
        if (elapsed >= JOIN_PROGRESS_STEP_THRESHOLDS_MS[index]) {
          nextStep = index;
          break;
        }
      }
      setJoinProgressStepIndex((current) =>
        current === nextStep ? current : nextStep,
      );
    };

    updateProgress();
    const timer = window.setInterval(updateProgress, 250);
    return () => {
      window.clearInterval(timer);
    };
  }, [isConnected, joinError, joining, joinAttemptNonce]);

  React.useEffect(() => {
    if (!joinRequested) return;
    if (joinAttemptHandledRef.current === joinAttemptNonce) return;
    joinAttemptHandledRef.current = joinAttemptNonce;

    let active = true;
    (async () => {
      setJoining(true);
      setJoinError(null);
      setShowJoinConnectingHint(false);
      setSessionClosedByHistory(false);
      setJoinProgressStepIndex(0);
      joinProgressStartedAtRef.current = Date.now();

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
          if (active) setSessionClosedByHistory(true);
          return;
        }

        const joinSettings = buildJoinSettings(joinPreferences);
        const tryJoin = async (token: string) => {
          await runWithJoinTimeout(
            hmsActions.join({
              userName: displayName,
              authToken: token,
              ...(joinSettings ? { settings: joinSettings } : {}),
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
          console.error("[focus sessions] join failed", res.status, text);
          if (active) setJoinError(mapJoinServerError(payload?.error));
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
          if (active) setJoinError(JOIN_GENERIC_ERROR_MESSAGE);
          return;
        }

        await tryJoin(token);
      } catch (err) {
        console.error(err);
        if (!active) return;
        if (readIsOffline()) {
          setIsOffline(true);
          setJoinError(JOIN_OFFLINE_MESSAGE);
        } else {
          setJoinError(mapJoinUnexpectedError(err));
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
    joinPreferences,
    joinRequested,
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
    if (skipNextAutoReconnectRef.current) {
      skipNextAutoReconnectRef.current = false;
      return;
    }
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
              lastError = mapJoinServerError(payload?.error);
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
                lastError = JOIN_GENERIC_ERROR_MESSAGE;
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
            lastError = mapJoinUnexpectedError(err);
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
        setJoinError(mapJoinUnexpectedError(err));
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
      if (typeof window !== "undefined" && hasConnectedOnceRef.current) {
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

  const qualityByPeerId = React.useMemo(() => {
    const next: Record<string, ConnectionQualityView> = {};
    if (!connectionQualities || typeof connectionQualities !== "object") {
      return next;
    }

    for (const [peerId, quality] of Object.entries(connectionQualities)) {
      if (!peerId) continue;
      const view = classifyConnectionQuality(
        (quality as { downlinkQuality?: unknown })?.downlinkQuality,
      );
      if (view) {
        next[peerId] = view;
      }
    }

    return next;
  }, [connectionQualities]);

  const localConnectionQuality = React.useMemo(() => {
    const peerId = localPeer?.id;
    if (!peerId) return null;
    return qualityByPeerId[peerId] ?? null;
  }, [localPeer?.id, qualityByPeerId]);

  React.useEffect(() => {
    if (!isConnected || joining || retryingJoin || endingDueToTime || !isCamOn) {
      poorSinceRef.current = null;
      goodSinceRef.current = null;
      return;
    }

    const level = localConnectionQuality?.level;
    if (!level) {
      poorSinceRef.current = null;
      goodSinceRef.current = null;
      return;
    }

    const evaluate = () => {
      const now = Date.now();
      if (now < manualOverrideUntilRef.current) {
        poorSinceRef.current = null;
        goodSinceRef.current = null;
        return;
      }
      if (autoVideoActionInFlightRef.current) return;
      if (
        lastAutoActionAtRef.current > 0 &&
        now - lastAutoActionAtRef.current < AUTO_ACTION_COOLDOWN_MS
      ) {
        return;
      }

      if (level === "poor") {
        goodSinceRef.current = null;
        if (poorSinceRef.current === null) {
          poorSinceRef.current = now;
        }
        if (
          autoVideoMode === "normal" &&
          now - poorSinceRef.current >= POOR_HOLD_MS
        ) {
          void applyReducedVideoProfile();
        }
        return;
      }

      if (level === "good") {
        poorSinceRef.current = null;
        if (goodSinceRef.current === null) {
          goodSinceRef.current = now;
        }
        if (
          autoVideoMode === "reduced" &&
          now - goodSinceRef.current >= GOOD_HOLD_MS
        ) {
          void restoreNormalVideoProfile("auto");
        }
        return;
      }

      poorSinceRef.current = null;
      goodSinceRef.current = null;
    };

    evaluate();
    const timer = window.setInterval(evaluate, 1_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [
    applyReducedVideoProfile,
    autoVideoMode,
    endingDueToTime,
    isCamOn,
    isConnected,
    joining,
    localConnectionQuality?.level,
    restoreNormalVideoProfile,
    retryingJoin,
  ]);

  const peerMediaViews = React.useMemo<PeerMediaView[]>(() => {
    return orderedPeers.map((peer) => {
      const rawCameraTrackId = peer.videoTrack ?? null;
      const cameraTrack = rawCameraTrackId ? tracksMap[rawCameraTrackId] : null;
      const cameraTrackId =
        cameraTrack && cameraTrack.type === "video" ? rawCameraTrackId : null;

      const rawScreenTrackId =
        peer.auxiliaryTracks.find((trackId) => {
          const track = tracksMap[trackId];
          return track?.type === "video" && track.source === "screen";
        }) ?? null;
      const screenTrack = rawScreenTrackId ? tracksMap[rawScreenTrackId] : null;
      const screenTrackId =
        screenTrack && screenTrack.type === "video" ? rawScreenTrackId : null;

      return {
        peer,
        cameraTrackId,
        screenTrackId,
        hasCamera: Boolean(cameraTrackId),
        hasScreen: Boolean(screenTrackId),
      };
    });
  }, [orderedPeers, tracksMap]);

  const screenPresenters = React.useMemo(
    () => peerMediaViews.filter((view) => view.hasScreen),
    [peerMediaViews],
  );

  React.useEffect(() => {
    if (!pinnedTarget) return;
    if (isTargetAvailable(pinnedTarget, peerMediaViews)) return;
    setPinnedTarget(null);
  }, [peerMediaViews, pinnedTarget]);

  const mainTarget = React.useMemo<ViewTarget | null>(() => {
    if (pinnedTarget && isTargetAvailable(pinnedTarget, peerMediaViews)) {
      return pinnedTarget;
    }
    const presenter = screenPresenters[0];
    if (presenter) {
      return { kind: "peer-screen", peerId: presenter.peer.id };
    }
    return null;
  }, [peerMediaViews, pinnedTarget, screenPresenters]);

  const useStageLayout = Boolean(mainTarget);

  const activePresenter = React.useMemo(() => {
    if (screenPresenters.length === 0) return null;
    if (mainTarget?.kind === "peer-screen") {
      return (
        peerMediaViews.find((view) => view.peer.id === mainTarget.peerId)?.peer ??
        screenPresenters[0].peer
      );
    }
    return screenPresenters[0].peer;
  }, [mainTarget, peerMediaViews, screenPresenters]);

  const buildTileTarget = React.useCallback(
    (view: PeerMediaView, kind: ViewTargetKind) => {
      const target: ViewTarget = { kind, peerId: view.peer.id };
      const connectionQuality = qualityByPeerId[view.peer.id] ?? null;
      const reactionEmoji = reactionByPeerId[view.peer.id] ?? null;
      const isHandRaised = Boolean(view.peer.isHandRaised);
      if (kind === "peer-screen") {
        return {
          key: viewTargetKey(target),
          target,
          label: `${formatLabel(view.peer)} · Screen`,
          isLocal: view.peer.isLocal,
          mainTrackId: view.screenTrackId,
          mainTrackKind: "screen" as TileTrackKind,
          overlayTrackId: view.cameraTrackId,
          overlayTrackKind: "camera" as TileTrackKind,
          showPresentingBadge: true,
          connectionQuality,
          reactionEmoji,
          isHandRaised,
        };
      }
      return {
        key: viewTargetKey(target),
        target,
        label: formatLabel(view.peer),
        isLocal: view.peer.isLocal,
        mainTrackId: view.cameraTrackId,
        mainTrackKind: "camera" as TileTrackKind,
        overlayTrackId: null,
        overlayTrackKind: undefined,
        showPresentingBadge: false,
        connectionQuality,
        reactionEmoji,
        isHandRaised,
      };
    },
    [qualityByPeerId, reactionByPeerId],
  );

  const mainTile = React.useMemo(() => {
    if (!mainTarget) return null;
    const view = peerMediaViews.find((item) => item.peer.id === mainTarget.peerId);
    if (!view) return null;
    return buildTileTarget(view, mainTarget.kind);
  }, [buildTileTarget, mainTarget, peerMediaViews]);

  const stripTiles = React.useMemo(() => {
    const cameraTiles = peerMediaViews.map((view) =>
      buildTileTarget(view, "peer-camera"),
    );
    const screenTiles = peerMediaViews
      .filter((view) => view.hasScreen)
      .map((view) => buildTileTarget(view, "peer-screen"));

    const next = [...cameraTiles, ...screenTiles];
    if (!mainTile) return next;
    return next.filter((tile) => tile.key !== mainTile.key);
  }, [buildTileTarget, mainTile, peerMediaViews]);

  const visiblePeerViews = peerMediaViews.slice(0, 3);
  const peerCount = visiblePeerViews.length;
  const defaultGridTiles = React.useMemo(
    () => visiblePeerViews.map((view) => buildTileTarget(view, "peer-camera")),
    [buildTileTarget, visiblePeerViews],
  );

  const pipPeer = localPeer ?? orderedPeers[0] ?? null;
  const pipLabel = formatLabel(pipPeer);
  const pipPeerView = peerMediaViews.find((view) => view.peer.id === pipPeer?.id);
  const pipTrackId = pipPeerView?.screenTrackId ?? pipPeerView?.cameraTrackId ?? null;
  const pipTrackKind: TileTrackKind = pipPeerView?.screenTrackId
    ? "screen"
    : "camera";
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
    manualOverrideUntilRef.current = Date.now() + MANUAL_OVERRIDE_GRACE_MS;
    poorSinceRef.current = null;
    goodSinceRef.current = null;
    setAutoVideoMode("normal");
    setAutoVideoNotice(null);
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

  const clearQuietModeVolumeSnapshot = React.useCallback(() => {
    quietModeVolumeSnapshotRef.current = null;
    quietModeMutedTrackIdsRef.current.clear();
  }, []);

  const setIncomingAudioMuted = React.useCallback(
    async (mute: boolean, options?: { clearSnapshot?: boolean }) => {
      setQuietModePending(true);
      try {
        if (mute) {
          const snapshot = quietModeVolumeSnapshotRef.current ?? {};
          for (const entry of remoteAudioTrackEntries) {
            if (snapshot[entry.trackId] === undefined) {
              snapshot[entry.trackId] = entry.volume;
            }
            quietModeMutedTrackIdsRef.current.add(entry.trackId);
          }
          quietModeVolumeSnapshotRef.current = snapshot;
          const results = await Promise.allSettled(
            remoteAudioTrackEntries.map((entry) =>
              hmsActions.setVolume(0, entry.trackId),
            ),
          );
          if (results.some((result) => result.status === "rejected")) {
            showFeedback("Unable to mute some incoming audio.", "error");
          }
          setQuietModeIncomingMuted(true);
          return;
        }

        const snapshot = quietModeVolumeSnapshotRef.current ?? {};
        const activeTrackIds = new Set(
          remoteAudioTrackEntries.map((entry) => entry.trackId),
        );
        const restoreEntries = Object.entries(snapshot).filter(([trackId]) =>
          activeTrackIds.has(trackId),
        );
        const results = await Promise.allSettled(
          restoreEntries.map(([trackId, volume]) =>
            hmsActions.setVolume(volume, trackId),
          ),
        );
        if (results.some((result) => result.status === "rejected")) {
          showFeedback("Unable to restore some incoming audio.", "error");
        }
        setQuietModeIncomingMuted(false);
        quietModeMutedTrackIdsRef.current.clear();
        if (options?.clearSnapshot) {
          quietModeVolumeSnapshotRef.current = null;
        }
      } catch (err) {
        console.error("[focus sessions] quiet mode audio failed", err);
        showFeedback(
          mute
            ? "Unable to mute incoming audio."
            : "Unable to restore incoming audio.",
          "error",
        );
      } finally {
        setQuietModePending(false);
      }
    },
    [hmsActions, remoteAudioTrackEntries, showFeedback],
  );

  const toggleQuietMode = React.useCallback(async () => {
    if (quietModePending || !isConnected) return;
    const enable = !quietModeEnabled;
    setQuietModeEnabled(enable);
    if (enable) {
      await setIncomingAudioMuted(true);
      return;
    }
    if (quietModeIncomingMuted) {
      await setIncomingAudioMuted(false, { clearSnapshot: true });
      return;
    }
    clearQuietModeVolumeSnapshot();
    setQuietModeIncomingMuted(false);
  }, [
    clearQuietModeVolumeSnapshot,
    isConnected,
    quietModeEnabled,
    quietModeIncomingMuted,
    quietModePending,
    setIncomingAudioMuted,
  ]);

  React.useEffect(() => {
    if (!quietModeEnabled || !quietModeIncomingMuted || quietModePending) return;
    const snapshot = quietModeVolumeSnapshotRef.current ?? {};
    const activeTrackIds = new Set(
      remoteAudioTrackEntries.map((entry) => entry.trackId),
    );
    for (const trackId of quietModeMutedTrackIdsRef.current) {
      if (!activeTrackIds.has(trackId)) {
        quietModeMutedTrackIdsRef.current.delete(trackId);
      }
    }

    const tracksToMute: string[] = [];
    for (const entry of remoteAudioTrackEntries) {
      if (snapshot[entry.trackId] === undefined) {
        snapshot[entry.trackId] = entry.volume;
      }
      if (!quietModeMutedTrackIdsRef.current.has(entry.trackId)) {
        quietModeMutedTrackIdsRef.current.add(entry.trackId);
        tracksToMute.push(entry.trackId);
      }
    }
    quietModeVolumeSnapshotRef.current = snapshot;
    if (tracksToMute.length === 0) return;

    let active = true;
    (async () => {
      const results = await Promise.allSettled(
        tracksToMute.map((trackId) => hmsActions.setVolume(0, trackId)),
      );
      if (!active) return;
      if (results.some((result) => result.status === "rejected")) {
        showFeedback("Unable to mute some incoming audio.", "error");
      }
    })().catch((error) => {
      if (!active) return;
      console.error("[focus sessions] quiet mode track churn mute failed", error);
      showFeedback("Unable to mute some incoming audio.", "error");
    });

    return () => {
      active = false;
    };
  }, [
    hmsActions,
    quietModeEnabled,
    quietModeIncomingMuted,
    quietModePending,
    remoteAudioTrackEntries,
    showFeedback,
  ]);

  const toggleRaiseHand = React.useCallback(async () => {
    if (handActionPending || controlsLocked) return;
    setHandActionPending(true);
    try {
      if (isLocalHandRaised) {
        await hmsActions.lowerLocalPeerHand();
      } else {
        await hmsActions.raiseLocalPeerHand();
      }
    } catch (err) {
      console.error("[focus sessions] hand raise failed", err);
      showFeedback("Unable to update raised hand.", "error");
    } finally {
      setHandActionPending(false);
    }
  }, [
    controlsLocked,
    handActionPending,
    hmsActions,
    isLocalHandRaised,
    showFeedback,
  ]);

  const sendReaction = React.useCallback(
    async (emoji: ReactionEmoji) => {
      if (!localPeer?.id || controlsLocked) return;
      applyReaction(localPeer.id, emoji);
      setIsReactionPickerOpen(false);
      const payload: FocusUiEvent = {
        v: 1,
        kind: "reaction",
        emoji,
        peerId: localPeer.id,
        sentAtMs: Date.now(),
      };
      await sendFocusUiEvent(payload, { suppressFeedback: true });
    },
    [applyReaction, controlsLocked, localPeer?.id, sendFocusUiEvent],
  );

  const setTimerFromAction = React.useCallback(
    async (nextRunState: TimerRunState | "reset") => {
      if (timerControlsDisabled) return;
      if (!isTimerController) return;

      setTimerActionPending(true);
      try {
        const now = Date.now();
        const current = timerStateRef.current;
        const controllerPeerId = timerControllerPeerId ?? localPeer?.id ?? null;
        const elapsedNow = getTimerElapsedMs(current, now);
        let next: TimerViewState;

        if (nextRunState === "reset") {
          next = {
            ...current,
            mode: current.mode,
            runState: "idle",
            elapsedMs: 0,
            startedAtMs: null,
            controllerPeerId,
            updatedAtMs: now,
          };
        } else if (nextRunState === "running") {
          if (current.runState === "running") {
            next = current;
          } else {
            next = {
              ...current,
              mode: current.mode,
              runState: "running",
              elapsedMs: current.runState === "idle" ? 0 : elapsedNow,
              startedAtMs: now,
              controllerPeerId,
              updatedAtMs: now,
            };
          }
        } else {
          next = {
            ...current,
            mode: current.mode,
            runState: "paused",
            elapsedMs: elapsedNow,
            startedAtMs: null,
            controllerPeerId,
            updatedAtMs: now,
          };
        }

        persistTimerState(next);
        if (next.mode === "shared") {
          await publishTimerSync(next);
        }
      } finally {
        setTimerActionPending(false);
      }
    },
    [
      isTimerController,
      localPeer?.id,
      persistTimerState,
      publishTimerSync,
      timerControllerPeerId,
      timerControlsDisabled,
    ],
  );

  const addHighlight = React.useCallback(() => {
    const note = highlightDraft.trim().slice(0, HIGHLIGHT_MAX_NOTE_LENGTH);
    const entry: HighlightEntry = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.floor(Math.random() * 10_000)}`,
      createdAtMs: Date.now(),
      timerMs: timerElapsedMs,
      note,
    };
    setHighlights((prev) => [entry, ...prev]);
    setHighlightDraft("");
    showFeedback("Highlight saved.");
  }, [highlightDraft, timerElapsedMs, showFeedback]);

  const copyHighlights = React.useCallback(async () => {
    if (highlights.length === 0) {
      showFeedback("Add at least one highlight first.");
      return;
    }
    const text = buildHighlightsExportText(sessionId, highlights);
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      showFeedback("Clipboard unavailable on this browser.", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showFeedback("Highlights copied.");
    } catch (err) {
      console.error("[focus sessions] copy highlights failed", err);
      showFeedback("Unable to copy highlights.", "error");
    }
  }, [highlights, sessionId, showFeedback]);

  const downloadHighlights = React.useCallback(() => {
    const text = buildHighlightsExportText(sessionId, highlights);
    if (typeof window === "undefined" || typeof document === "undefined") return;
    try {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `focus-highlights-${sessionId}.txt`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      showFeedback("Highlights downloaded.");
    } catch (err) {
      console.error("[focus sessions] download highlights failed", err);
      showFeedback("Unable to download highlights.", "error");
    }
  }, [highlights, sessionId, showFeedback]);

  const togglePinTarget = React.useCallback((target: ViewTarget) => {
    setPinnedTarget((current) => (isSameTarget(current, target) ? null : target));
  }, []);

  const handleStartJoin = React.useCallback(
    (preferences: GreenRoomJoinPreferences) => {
      if (joining || retryingJoin || endingDueToTime) return;
      setJoinPreferences(preferences);
      setJoinRequested(true);
      setJoinError(null);
      setShowJoinConnectingHint(false);
      setSessionClosedByHistory(false);
      setJoinProgressStepIndex(0);
      joinProgressStartedAtRef.current = null;
      joinAttemptHandledRef.current = null;
      setJoinAttemptNonce((prev) => prev + 1);
    },
    [endingDueToTime, joining, retryingJoin],
  );

  const retryJoin = React.useCallback(async () => {
    if (retryingJoin || endingDueToTime) return;
    setRetryingJoin(true);
    setJoinRequested(true);
    setJoinError(null);
    setShowJoinConnectingHint(false);
    setSessionClosedByHistory(false);
    setJoinProgressStepIndex(0);
    joinProgressStartedAtRef.current = null;
    try {
      await hmsActions.leave();
    } catch {}
    joinAttemptHandledRef.current = null;
    setJoinAttemptNonce((prev) => prev + 1);
    setRetryingJoin(false);
  }, [endingDueToTime, hmsActions, retryingJoin]);

  const switchAudioInput = React.useCallback(
    async (deviceId: string) => {
      if (!deviceId || deviceId === selectedAudioInputDeviceId || hasFixAvPending) {
        return;
      }
      setFixPending("switch-mic", true);
      try {
        await updateDevice({
          deviceType: DeviceType.audioInput,
          deviceId,
        });
        showFeedback("Microphone updated.");
      } catch (err) {
        console.error(err);
        showFeedback(mapControlError("mic", err), "error");
      } finally {
        setFixPending("switch-mic", false);
      }
    },
    [
      hasFixAvPending,
      selectedAudioInputDeviceId,
      setFixPending,
      showFeedback,
      updateDevice,
    ],
  );

  const switchVideoInput = React.useCallback(
    async (deviceId: string) => {
      if (!deviceId || deviceId === selectedVideoInputDeviceId || hasFixAvPending) {
        return;
      }
      setFixPending("switch-cam", true);
      try {
        await updateDevice({
          deviceType: DeviceType.videoInput,
          deviceId,
        });
        showFeedback("Camera updated.");
      } catch (err) {
        console.error(err);
        showFeedback(mapControlError("cam", err), "error");
      } finally {
        setFixPending("switch-cam", false);
      }
    },
    [
      hasFixAvPending,
      selectedVideoInputDeviceId,
      setFixPending,
      showFeedback,
      updateDevice,
    ],
  );

  const switchAudioOutput = React.useCallback(
    async (deviceId: string) => {
      if (
        !supportsSpeakerSelection ||
        !deviceId ||
        deviceId === selectedAudioOutputDeviceId ||
        hasFixAvPending
      ) {
        return;
      }
      setFixPending("switch-speaker", true);
      try {
        await updateDevice({
          deviceType: DeviceType.audioOutput,
          deviceId,
        });
        showFeedback("Speaker updated.");
      } catch (err) {
        console.error(err);
        showFeedback("Unable to update speaker.", "error");
      } finally {
        setFixPending("switch-speaker", false);
      }
    },
    [
      hasFixAvPending,
      selectedAudioOutputDeviceId,
      setFixPending,
      showFeedback,
      supportsSpeakerSelection,
      updateDevice,
    ],
  );

  const restartMicrophone = React.useCallback(async () => {
    if (hasFixAvPending) return;
    const deviceId = selectedAudioInputDeviceId ?? audioInputDevices[0]?.deviceId;
    if (!deviceId) {
      showFeedback("No microphone found.", "error");
      return;
    }
    setFixPending("restart-mic", true);
    try {
      await hmsActions.setAudioSettings({ deviceId });
      showFeedback("Microphone restarted.");
    } catch (err) {
      console.error(err);
      showFeedback(mapControlError("mic", err), "error");
    } finally {
      setFixPending("restart-mic", false);
    }
  }, [
    audioInputDevices,
    hasFixAvPending,
    hmsActions,
    selectedAudioInputDeviceId,
    setFixPending,
    showFeedback,
  ]);

  const restartCamera = React.useCallback(async () => {
    if (hasFixAvPending) return;
    const deviceId = selectedVideoInputDeviceId ?? videoInputDevices[0]?.deviceId;
    if (!deviceId) {
      showFeedback("No camera found.", "error");
      return;
    }
    setFixPending("restart-cam", true);
    try {
      await hmsActions.setVideoSettings({ deviceId });
      showFeedback("Camera restarted.");
    } catch (err) {
      console.error(err);
      showFeedback(mapControlError("cam", err), "error");
    } finally {
      setFixPending("restart-cam", false);
    }
  }, [
    hasFixAvPending,
    hmsActions,
    selectedVideoInputDeviceId,
    setFixPending,
    showFeedback,
    videoInputDevices,
  ]);

  const handleFixAvRejoin = React.useCallback(async () => {
    if (hasFixAvPending || joining || retryingJoin || isReconnecting || endingDueToTime) {
      return;
    }
    setFixAvPending({ rejoin: true });
    setIsFixAvOpen(false);
    skipNextAutoReconnectRef.current = true;
    try {
      await retryJoin();
      showFeedback("Rejoining session...");
    } finally {
      setFixPending("rejoin", false);
    }
  }, [
    endingDueToTime,
    hasFixAvPending,
    isReconnecting,
    joining,
    retryJoin,
    retryingJoin,
    setFixPending,
    showFeedback,
  ]);

  const showGreenRoom =
    !endingDueToTime && !sessionClosedByHistory && !hasConnectedOnce && !isConnected;
  const showJoinRecoveryPanel =
    hasConnectedOnce &&
    !endingDueToTime &&
    !isConnected &&
    (Boolean(joinError) || showJoinConnectingHint || isOffline);
  const joinRecoveryMessage = joinError
    ? joinError
    : isOffline
      ? JOIN_OFFLINE_MESSAGE
      : JOIN_CONNECTING_HINT_MESSAGE;
  const joinRecoveryIsError = Boolean(joinError) || isOffline;
  const fixRejoinDisabled =
    hasFixAvPending ||
    joining ||
    retryingJoin ||
    isReconnecting ||
    endingDueToTime;
  const fixPanelControlsDisabled =
    hasFixAvPending || joining || retryingJoin || endingDueToTime;
  const localConnectionTone = localConnectionQuality
    ? qualityToneClasses(localConnectionQuality.level)
    : null;
  const showAutoVideoNotice =
    autoVideoMode === "reduced" &&
    isCamOn &&
    Boolean(localConnectionQuality) &&
    autoVideoNotice?.mode === "reduced";
  const autoVideoActionDisabled = pendingControls.cam || controlsLocked;
  const showPinControl = !quietModeEnabled;
  const showFixAvButton = isConnected && !quietModeEnabled;
  const showNonEssentialControls = !quietModeEnabled && isConnected;
  const raiseHandLabel = handActionPending
    ? "Updating..."
    : isLocalHandRaised
      ? "Lower hand"
      : "Raise hand";
  const canAddHighlight = highlightDraft.trim().length <= HIGHLIGHT_MAX_NOTE_LENGTH;
  const timerPrimaryActionLabel =
    timerState.runState === "running" ? "Pause" : "Start";
  const isTimerPrimaryActionRunning = timerState.runState === "running";
  const quietModeActionDisabled =
    quietModePending || joining || retryingJoin || endingDueToTime || !isConnected;

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

  if (showGreenRoom) {
    return (
      <GreenRoom
        isOffline={isOffline}
        joining={joining}
        joinError={joinError}
        retryingJoin={retryingJoin}
        activeJoinStep={joinProgressStepIndex}
        joinSteps={[...JOIN_PROGRESS_STEPS]}
        showSlowConnectingHint={showJoinConnectingHint}
        onJoin={handleStartJoin}
        onRetry={() => {
          void retryJoin();
        }}
        onBack={() => router.replace("/feature/live")}
      />
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
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span>
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
              </span>
              {localConnectionQuality && localConnectionTone ? (
                <span
                  className={cx(
                    "inline-flex h-8 items-center rounded-full border px-3 text-[11px] font-semibold uppercase tracking-[0.14em]",
                    localConnectionTone.chip,
                  )}
                >
                  Connection: {localConnectionQuality.label}
                </span>
              ) : null}
              {isConnected ? (
                <button
                  type="button"
                  onClick={() => setIsTimerPanelOpen((prev) => !prev)}
                  className="inline-flex h-9 items-center rounded-full border border-white/20 bg-white/10 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-white/80 transition hover:bg-white/20 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                >
                  {timerLabel}: {timerDisplayLabel}
                </button>
              ) : null}
              {showNonEssentialControls ? (
                <button
                  type="button"
                  onClick={() => setIsHighlightsPanelOpen((prev) => !prev)}
                  className="inline-flex h-9 items-center rounded-full border border-white/20 bg-white/10 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-white/80 transition hover:bg-white/20 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                >
                  Highlights ({highlights.length})
                </button>
              ) : null}
              {showFixAvButton ? (
                <button
                  type="button"
                  onClick={() => setIsFixAvOpen(true)}
                  className="inline-flex h-9 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-white/80 transition hover:bg-white/20 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  Fix audio/video
                </button>
              ) : null}
              {isConnected ? (
                <button
                  type="button"
                  onClick={() => {
                    void toggleQuietMode();
                  }}
                  disabled={quietModeActionDisabled}
                  className={cx(
                    "inline-flex h-9 items-center rounded-full border px-4 text-xs font-semibold uppercase tracking-[0.14em] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400",
                    quietModeEnabled
                      ? "border-sky-300/45 bg-sky-400/20 text-sky-100 hover:bg-sky-400/30"
                      : "border-white/20 bg-white/10 text-white/80 hover:bg-white/20 hover:text-white",
                    quietModeActionDisabled &&
                      "cursor-not-allowed opacity-60 hover:bg-inherit",
                  )}
                >
                  {quietModeEnabled ? "Quiet mode on" : "Quiet mode"}
                </button>
              ) : null}
            </div>
          </div>

          {showAutoVideoNotice ? (
            <div className="-mt-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-400/25 bg-sky-500/10 px-3 py-2 text-xs text-sky-100/90">
              <p>{autoVideoNotice?.message}</p>
              <button
                type="button"
                onClick={handleManualRestoreVideo}
                disabled={autoVideoActionDisabled}
                className={cx(
                  "inline-flex h-8 items-center rounded-full border border-sky-300/45 bg-sky-400/20 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-100 transition hover:bg-sky-400/30",
                  autoVideoActionDisabled &&
                    "cursor-not-allowed opacity-60 hover:bg-sky-400/20",
                )}
              >
                Restore video
              </button>
            </div>
          ) : localConnectionQuality?.level === "poor" && localConnectionTone ? (
            <p
              className={cx(
                "-mt-2 text-xs font-medium tracking-[0.02em]",
                localConnectionTone.hint,
              )}
            >
              Try turning camera off or switching networks.
            </p>
          ) : null}

          {quietModeEnabled ? (
            <div className="-mt-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/12 bg-white/5 px-3 py-2 text-xs text-white/75">
              <p>Quiet mode is enabled. Non-essential controls are hidden.</p>
              <button
                type="button"
                onClick={() => {
                  void setIncomingAudioMuted(!quietModeIncomingMuted);
                }}
                disabled={quietModePending || !isConnected}
                className={cx(
                  "inline-flex h-8 items-center rounded-full border border-white/20 bg-white/10 px-3 font-semibold uppercase tracking-[0.14em] text-white/80 transition hover:bg-white/20",
                  (quietModePending || !isConnected) &&
                    "cursor-not-allowed opacity-60 hover:bg-white/10",
                )}
              >
                {quietModeIncomingMuted ? "Unmute incoming" : "Mute incoming"}
              </button>
            </div>
          ) : null}

          {isConnected && isTimerPanelOpen ? (
            <div className="rounded-2xl border border-white/12 bg-black/25 p-4 text-sm text-white/80">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-white/50">
                    {timerLabel}
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-white">
                    {timerDisplayLabel}
                  </p>
                </div>
                {timerState.mode === "shared" && !isTimerController ? (
                  <p className="text-xs text-white/60">
                    Controlled by {timerControllerLabel}
                  </p>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void setTimerFromAction(
                      isTimerPrimaryActionRunning ? "paused" : "running",
                    );
                  }}
                  disabled={timerControlsDisabled || !isTimerController}
                  className={cx(
                    "inline-flex h-9 items-center rounded-full border border-sky-300/45 bg-sky-400/20 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-sky-100 transition hover:bg-sky-400/30",
                    (timerControlsDisabled || !isTimerController) &&
                      "cursor-not-allowed opacity-60 hover:bg-sky-400/20",
                  )}
                >
                  {timerPrimaryActionLabel}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void setTimerFromAction("reset");
                  }}
                  disabled={timerControlsDisabled || !isTimerController}
                  className={cx(
                    "inline-flex h-9 items-center rounded-full border border-white/20 bg-white/10 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-white/80 transition hover:bg-white/20",
                    (timerControlsDisabled || !isTimerController) &&
                      "cursor-not-allowed opacity-60 hover:bg-white/10",
                  )}
                >
                  Reset
                </button>
              </div>
            </div>
          ) : null}

          {showNonEssentialControls && isHighlightsPanelOpen ? (
            <div className="rounded-2xl border border-white/12 bg-black/25 p-4 text-sm text-white/80">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] uppercase tracking-[0.16em] text-white/50">
                  Highlights
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void copyHighlights();
                    }}
                    className="inline-flex h-8 items-center rounded-full border border-white/20 bg-white/10 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/80 transition hover:bg-white/20"
                  >
                    Copy notes
                  </button>
                  <button
                    type="button"
                    onClick={downloadHighlights}
                    className="inline-flex h-8 items-center rounded-full border border-white/20 bg-white/10 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/80 transition hover:bg-white/20"
                  >
                    Download
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-start gap-2">
                <textarea
                  value={highlightDraft}
                  onChange={(event) =>
                    setHighlightDraft(
                      event.target.value.slice(0, HIGHLIGHT_MAX_NOTE_LENGTH),
                    )
                  }
                  rows={2}
                  placeholder="Optional note"
                  className="min-w-[220px] flex-1 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                />
                <button
                  type="button"
                  onClick={addHighlight}
                  disabled={!canAddHighlight}
                  className={cx(
                    "inline-flex h-10 items-center rounded-full border border-sky-300/45 bg-sky-400/20 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-sky-100 transition hover:bg-sky-400/30",
                    !canAddHighlight &&
                      "cursor-not-allowed opacity-60 hover:bg-sky-400/20",
                  )}
                >
                  Add highlight
                </button>
              </div>
              <p className="mt-2 text-[11px] text-white/45">
                {highlightDraft.length}/{HIGHLIGHT_MAX_NOTE_LENGTH}
              </p>
              <div className="mt-3 max-h-40 space-y-2 overflow-y-auto pr-1">
                {highlights.length === 0 ? (
                  <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
                    No highlights yet.
                  </p>
                ) : (
                  highlights.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80"
                    >
                      <p className="font-semibold text-white/90">
                        [{formatDurationLabel(item.timerMs)}]
                      </p>
                      {item.note ? <p className="mt-1 text-white/75">{item.note}</p> : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}

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
            {screenPresenters.length > 0 ? (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-100">
                <p>
                  {isShareOn
                    ? "You are sharing your screen"
                    : `${formatLabel(activePresenter)} is presenting`}
                </p>
                {isShareOn ? (
                  <button
                    type="button"
                    onClick={toggleScreenShare}
                    disabled={pendingControls.screen || controlsLocked}
                    className={cx(
                      "inline-flex h-9 items-center justify-center rounded-full border border-indigo-300/45 bg-indigo-400/20 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-indigo-100 transition hover:bg-indigo-400/30",
                      (pendingControls.screen || controlsLocked) &&
                        "cursor-not-allowed opacity-60 hover:bg-indigo-400/20",
                    )}
                  >
                    {pendingControls.screen ? "Stopping..." : "Stop sharing"}
                  </button>
                ) : null}
              </div>
            ) : null}

            {peerCount === 0 ? (
              <div className="flex h-[52vh] items-center justify-center rounded-[28px] border border-white/10 bg-black/40 text-sm text-white/60 md:h-[60vh] lg:h-[66vh]">
                {isReconnecting
                  ? "Reconnecting to the session..."
                  : "Connecting to the session..."}
              </div>
            ) : useStageLayout && mainTile ? (
              stripTiles.length > 0 ? (
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
                  <div className="h-[52vh] md:h-[60vh] lg:h-[66vh]">
                    <VideoTile
                      key={mainTile.key}
                      mainTrackId={mainTile.mainTrackId}
                      mainTrackKind={mainTile.mainTrackKind}
                      overlayTrackId={mainTile.overlayTrackId}
                      overlayTrackKind={mainTile.overlayTrackKind}
                      label={mainTile.label}
                      isLocal={mainTile.isLocal}
                      showPresentingBadge={mainTile.showPresentingBadge}
                      connectionQuality={mainTile.connectionQuality}
                      reactionEmoji={mainTile.reactionEmoji}
                      isHandRaised={mainTile.isHandRaised}
                      showPinControl={showPinControl}
                      isPinned={isSameTarget(pinnedTarget, mainTile.target)}
                      pinLabel={
                        isSameTarget(pinnedTarget, mainTile.target)
                          ? "Unpin main view"
                          : "Pin main view"
                      }
                      onTogglePin={() => togglePinTarget(mainTile.target)}
                      className="h-full"
                    />
                  </div>
                  <div className="flex gap-3 overflow-x-auto pb-1 lg:h-[66vh] lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:pb-0">
                    {stripTiles.map((tile) => (
                      <VideoTile
                        key={tile.key}
                        mainTrackId={tile.mainTrackId}
                        mainTrackKind={tile.mainTrackKind}
                        overlayTrackId={tile.overlayTrackId}
                        overlayTrackKind={tile.overlayTrackKind}
                        label={tile.label}
                        isLocal={tile.isLocal}
                        showPresentingBadge={tile.showPresentingBadge}
                        connectionQuality={tile.connectionQuality}
                        reactionEmoji={tile.reactionEmoji}
                        isHandRaised={tile.isHandRaised}
                        showPinControl={showPinControl}
                        isPinned={isSameTarget(pinnedTarget, tile.target)}
                        pinLabel={
                          isSameTarget(pinnedTarget, tile.target)
                            ? "Unpin view"
                            : "Pin view"
                        }
                        onTogglePin={() => togglePinTarget(tile.target)}
                        className="h-[132px] min-w-[180px] shrink-0 lg:h-[152px] lg:min-w-0"
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-[52vh] md:h-[60vh] lg:h-[66vh]">
                  <VideoTile
                    key={mainTile.key}
                    mainTrackId={mainTile.mainTrackId}
                    mainTrackKind={mainTile.mainTrackKind}
                    overlayTrackId={mainTile.overlayTrackId}
                    overlayTrackKind={mainTile.overlayTrackKind}
                    label={mainTile.label}
                    isLocal={mainTile.isLocal}
                    showPresentingBadge={mainTile.showPresentingBadge}
                    connectionQuality={mainTile.connectionQuality}
                    reactionEmoji={mainTile.reactionEmoji}
                    isHandRaised={mainTile.isHandRaised}
                    showPinControl={showPinControl}
                    isPinned={isSameTarget(pinnedTarget, mainTile.target)}
                    pinLabel={
                      isSameTarget(pinnedTarget, mainTile.target)
                        ? "Unpin main view"
                        : "Pin main view"
                    }
                    onTogglePin={() => togglePinTarget(mainTile.target)}
                    className="h-full"
                  />
                </div>
              )
            ) : peerCount === 1 ? (
              <div className="h-[52vh] md:h-[60vh] lg:h-[66vh]">
                <VideoTile
                  mainTrackId={defaultGridTiles[0]?.mainTrackId}
                  mainTrackKind={defaultGridTiles[0]?.mainTrackKind}
                  overlayTrackId={defaultGridTiles[0]?.overlayTrackId}
                  overlayTrackKind={defaultGridTiles[0]?.overlayTrackKind}
                  label={defaultGridTiles[0]?.label ?? "Guest"}
                  isLocal={Boolean(defaultGridTiles[0]?.isLocal)}
                  connectionQuality={defaultGridTiles[0]?.connectionQuality ?? null}
                  reactionEmoji={defaultGridTiles[0]?.reactionEmoji ?? null}
                  isHandRaised={defaultGridTiles[0]?.isHandRaised ?? false}
                  showPinControl={showPinControl}
                  isPinned={isSameTarget(pinnedTarget, defaultGridTiles[0]?.target ?? null)}
                  onTogglePin={() => {
                    if (defaultGridTiles[0]) {
                      togglePinTarget(defaultGridTiles[0].target);
                    }
                  }}
                  pinLabel={
                    isSameTarget(pinnedTarget, defaultGridTiles[0]?.target ?? null)
                      ? "Unpin participant"
                      : "Pin participant"
                  }
                  className="h-full"
                />
              </div>
            ) : peerCount === 2 ? (
              <div className="grid h-[52vh] gap-3 md:h-[60vh] md:grid-cols-2 lg:h-[66vh]">
                {defaultGridTiles.map((tile) => (
                  <VideoTile
                    key={tile.key}
                    mainTrackId={tile.mainTrackId}
                    mainTrackKind={tile.mainTrackKind}
                    overlayTrackId={tile.overlayTrackId}
                    overlayTrackKind={tile.overlayTrackKind}
                    label={tile.label}
                    isLocal={tile.isLocal}
                    connectionQuality={tile.connectionQuality}
                    reactionEmoji={tile.reactionEmoji}
                    isHandRaised={tile.isHandRaised}
                    showPinControl={showPinControl}
                    isPinned={isSameTarget(pinnedTarget, tile.target)}
                    onTogglePin={() => togglePinTarget(tile.target)}
                    pinLabel={
                      isSameTarget(pinnedTarget, tile.target)
                        ? "Unpin participant"
                        : "Pin participant"
                    }
                    className="h-full"
                  />
                ))}
              </div>
            ) : (
              <div className="grid h-[52vh] gap-3 md:h-[60vh] md:grid-cols-2 md:grid-rows-2 lg:h-[66vh]">
                {defaultGridTiles.slice(0, 2).map((tile) => (
                  <VideoTile
                    key={tile.key}
                    mainTrackId={tile.mainTrackId}
                    mainTrackKind={tile.mainTrackKind}
                    overlayTrackId={tile.overlayTrackId}
                    overlayTrackKind={tile.overlayTrackKind}
                    label={tile.label}
                    isLocal={tile.isLocal}
                    connectionQuality={tile.connectionQuality}
                    reactionEmoji={tile.reactionEmoji}
                    isHandRaised={tile.isHandRaised}
                    showPinControl={showPinControl}
                    isPinned={isSameTarget(pinnedTarget, tile.target)}
                    onTogglePin={() => togglePinTarget(tile.target)}
                    pinLabel={
                      isSameTarget(pinnedTarget, tile.target)
                        ? "Unpin participant"
                        : "Pin participant"
                    }
                    className="h-full"
                  />
                ))}
                <VideoTile
                  mainTrackId={defaultGridTiles[2]?.mainTrackId}
                  mainTrackKind={defaultGridTiles[2]?.mainTrackKind}
                  overlayTrackId={defaultGridTiles[2]?.overlayTrackId}
                  overlayTrackKind={defaultGridTiles[2]?.overlayTrackKind}
                  label={defaultGridTiles[2]?.label ?? "Guest"}
                  isLocal={Boolean(defaultGridTiles[2]?.isLocal)}
                  connectionQuality={defaultGridTiles[2]?.connectionQuality ?? null}
                  reactionEmoji={defaultGridTiles[2]?.reactionEmoji ?? null}
                  isHandRaised={defaultGridTiles[2]?.isHandRaised ?? false}
                  showPinControl={showPinControl}
                  isPinned={isSameTarget(pinnedTarget, defaultGridTiles[2]?.target ?? null)}
                  onTogglePin={() => {
                    if (defaultGridTiles[2]) {
                      togglePinTarget(defaultGridTiles[2].target);
                    }
                  }}
                  pinLabel={
                    isSameTarget(pinnedTarget, defaultGridTiles[2]?.target ?? null)
                      ? "Unpin participant"
                      : "Pin participant"
                  }
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

          {showNonEssentialControls ? (
            <button
              type="button"
              onClick={toggleRaiseHand}
              disabled={handActionPending || controlsLocked}
              className={cx(
                "inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition",
                isLocalHandRaised
                  ? "bg-amber-400/20 text-amber-100 hover:bg-amber-400/30"
                  : "bg-white/10 text-white/70 hover:bg-white/20",
                (handActionPending || controlsLocked) &&
                  "cursor-not-allowed opacity-60 hover:bg-inherit",
              )}
            >
              {raiseHandLabel}
            </button>
          ) : null}

          {showNonEssentialControls ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsReactionPickerOpen((prev) => !prev)}
                disabled={controlsLocked}
                className={cx(
                  "inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/20",
                  controlsLocked && "cursor-not-allowed opacity-60 hover:bg-white/10",
                )}
              >
                Reactions
              </button>
              {isReactionPickerOpen ? (
                <div className="absolute bottom-12 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-black/80 px-2 py-1 shadow-[0_14px_40px_rgba(0,0,0,0.45)] backdrop-blur">
                  {REACTION_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        void sendReaction(emoji);
                      }}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-lg transition hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                      aria-label={`Send ${emoji} reaction`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {showNonEssentialControls ? (
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
          ) : null}
        </div>
      </div>

      {isFixAvOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
          <button
            type="button"
            aria-label="Close fix audio and video panel"
            onClick={() => setIsFixAvOpen(false)}
            className="absolute inset-0 bg-[#040711]/80 backdrop-blur-xl"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Fix audio and video"
            className="relative z-10 w-full max-w-2xl overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-br from-[#0f1422] via-[#0c1320] to-[#080d16] shadow-[0_32px_110px_rgba(0,0,0,0.58)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-white/45">
                  In call help
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-white">
                  Fix audio/video
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsFixAvOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white/75 transition hover:bg-white/20 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-5 px-6 py-6 text-sm text-white/80">
              <div className="grid gap-3 rounded-2xl border border-white/10 bg-black/30 p-4 md:grid-cols-2">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-white/45">
                    Microphone
                  </p>
                  <p className="mt-1 text-sm font-medium text-white">{currentMicLabel}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-white/45">
                    Camera
                  </p>
                  <p className="mt-1 text-sm font-medium text-white">
                    {currentCameraLabel}
                  </p>
                </div>
                {supportsSpeakerSelection ? (
                  <div className="md:col-span-2">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-white/45">
                      Speaker
                    </p>
                    <p className="mt-1 text-sm font-medium text-white">
                      {currentSpeakerLabel}
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.15em] text-white/55">
                    Select microphone
                  </span>
                  <select
                    value={
                      selectedAudioInputDeviceId ??
                      audioInputDevices[0]?.deviceId ??
                      ""
                    }
                    onChange={(event) => {
                      void switchAudioInput(event.target.value);
                    }}
                    disabled={fixPanelControlsDisabled || audioInputDevices.length === 0}
                    className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {audioInputDevices.length === 0 ? (
                      <option value="">No microphone found</option>
                    ) : null}
                    {audioInputDevices.map((device, index) => (
                      <option
                        key={`mic-${device.deviceId || index}`}
                        value={device.deviceId}
                        className="bg-[#0d1422]"
                      >
                        {device.label?.trim() || `Microphone ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.15em] text-white/55">
                    Select camera
                  </span>
                  <select
                    value={
                      selectedVideoInputDeviceId ??
                      videoInputDevices[0]?.deviceId ??
                      ""
                    }
                    onChange={(event) => {
                      void switchVideoInput(event.target.value);
                    }}
                    disabled={fixPanelControlsDisabled || videoInputDevices.length === 0}
                    className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {videoInputDevices.length === 0 ? (
                      <option value="">No camera found</option>
                    ) : null}
                    {videoInputDevices.map((device, index) => (
                      <option
                        key={`cam-${device.deviceId || index}`}
                        value={device.deviceId}
                        className="bg-[#0d1422]"
                      >
                        {device.label?.trim() || `Camera ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {supportsSpeakerSelection ? (
                <label className="block space-y-2">
                  <span className="text-xs uppercase tracking-[0.15em] text-white/55">
                    Select speaker
                  </span>
                  <select
                    value={
                      selectedAudioOutputDeviceId ??
                      audioOutputDevices[0]?.deviceId ??
                      ""
                    }
                    onChange={(event) => {
                      void switchAudioOutput(event.target.value);
                    }}
                    disabled={fixPanelControlsDisabled || audioOutputDevices.length === 0}
                    className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {audioOutputDevices.length === 0 ? (
                      <option value="">No speaker found</option>
                    ) : null}
                    {audioOutputDevices.map((device, index) => (
                      <option
                        key={`speaker-${device.deviceId || index}`}
                        value={device.deviceId}
                        className="bg-[#0d1422]"
                      >
                        {device.label?.trim() || `Speaker ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void restartMicrophone();
                  }}
                  disabled={fixPanelControlsDisabled}
                  className={cx(
                    "inline-flex h-10 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-white transition hover:bg-white/20",
                    fixPanelControlsDisabled &&
                      "cursor-not-allowed opacity-60 hover:bg-white/10",
                  )}
                >
                  <RefreshCcw className="h-4 w-4" />
                  Restart microphone
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void restartCamera();
                  }}
                  disabled={fixPanelControlsDisabled}
                  className={cx(
                    "inline-flex h-10 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-white transition hover:bg-white/20",
                    fixPanelControlsDisabled &&
                      "cursor-not-allowed opacity-60 hover:bg-white/10",
                  )}
                >
                  <RefreshCcw className="h-4 w-4" />
                  Restart camera
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleFixAvRejoin();
                  }}
                  disabled={fixRejoinDisabled}
                  className={cx(
                    "inline-flex h-10 items-center rounded-full border border-sky-300/45 bg-sky-400/20 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-sky-100 transition hover:bg-sky-400/30",
                    fixRejoinDisabled &&
                      "cursor-not-allowed opacity-60 hover:bg-sky-400/20",
                  )}
                >
                  {fixAvPending.rejoin ? "Rejoining..." : "Rejoin session"}
                </button>
              </div>

              <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/65">
                If you&apos;re on VPN/corporate Wi-Fi, try turning VPN off or switching to
                a hotspot.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <PipOverlay
        trackId={pipTrackId ?? undefined}
        trackKind={pipTrackKind}
        label={pipLabel}
        active={pipOverlayOn}
        onVideoElement={setPipVideoEl}
      />
    </div>
  );
}
