"use client";

import React from "react";
import { ArrowLeft, Camera, Mic, RefreshCw } from "lucide-react";

export type GreenRoomJoinPreferences = {
  joinMuted: boolean;
  joinWithCameraOff: boolean;
  audioInputDeviceId: string | null;
  videoDeviceId: string | null;
  audioOutputDeviceId: string | null;
  forceAudioMuted: boolean;
  forceVideoMuted: boolean;
};

export type GreenRoomProps = {
  isOffline: boolean;
  joining: boolean;
  joinError: string | null;
  retryingJoin: boolean;
  activeJoinStep: number;
  joinSteps: string[];
  showSlowConnectingHint: boolean;
  onJoin: (preferences: GreenRoomJoinPreferences) => void;
  onRetry: () => void;
  onBack: () => void;
};

type MediaReadiness = "loading" | "ready" | "blocked" | "missing" | "error";
type DevicePreferences = {
  audioInputDeviceId?: string | null;
  videoDeviceId?: string | null;
  audioOutputDeviceId?: string | null;
};

const MIC_BAR_WEIGHTS = [0.34, 0.52, 0.68, 0.84, 1, 0.78, 0.58, 0.44];

function cx(...classes: Array<string | null | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

function stopMediaStream(stream: MediaStream | null) {
  if (!stream) return;
  stream.getTracks().forEach((track) => {
    track.stop();
  });
}

function readErrorBlob(error: unknown) {
  if (error instanceof Error) {
    return `${error.name} ${error.message}`.toLowerCase();
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return [record.name, record.code, record.message]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase();
  }
  if (typeof error === "string") return error.toLowerCase();
  return "";
}

function mapMediaError(kind: "camera" | "microphone", error: unknown) {
  const blob = readErrorBlob(error);
  const isBlocked =
    blob.includes("notallowederror") ||
    blob.includes("permission denied") ||
    blob.includes("permission blocked");
  const isMissing =
    blob.includes("notfounderror") ||
    blob.includes("requested device not found") ||
    blob.includes("overconstrainederror") ||
    blob.includes("no device");

  if (kind === "camera") {
    if (isBlocked) {
      return {
        readiness: "blocked" as MediaReadiness,
        message:
          "Camera permission is blocked. You can still join with camera off.",
      };
    }
    if (isMissing) {
      return {
        readiness: "missing" as MediaReadiness,
        message: "No camera detected. You can still join audio-only.",
      };
    }
    return {
      readiness: "error" as MediaReadiness,
      message: "Unable to access camera right now.",
    };
  }

  if (isBlocked) {
    return {
      readiness: "blocked" as MediaReadiness,
      message: "Microphone permission is blocked. You can still join muted.",
    };
  }
  if (isMissing) {
    return {
      readiness: "missing" as MediaReadiness,
      message: "No microphone detected. You can still join without audio.",
    };
  }
  return {
    readiness: "error" as MediaReadiness,
    message: "Unable to access microphone right now.",
  };
}

function getDeviceLabel(
  device: MediaDeviceInfo,
  index: number,
  fallbackPrefix: string,
) {
  const trimmed = device.label?.trim();
  if (trimmed) return trimmed;
  return `${fallbackPrefix} ${index + 1}`;
}

function chooseDeviceId(
  previous: string | null,
  devices: MediaDeviceInfo[],
  preferred?: string | null,
) {
  if (preferred && devices.some((device) => device.deviceId === preferred)) {
    return preferred;
  }
  if (previous && devices.some((device) => device.deviceId === previous)) {
    return previous;
  }
  return devices[0]?.deviceId ?? null;
}

export default function GreenRoom({
  isOffline,
  joining,
  joinError,
  retryingJoin,
  activeJoinStep,
  joinSteps,
  showSlowConnectingHint,
  onJoin,
  onRetry,
  onBack,
}: GreenRoomProps) {
  const mountedRef = React.useRef(true);
  const previewVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = React.useRef<MediaStream | null>(null);
  const microphoneStreamRef = React.useRef<MediaStream | null>(null);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const sourceNodeRef = React.useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef = React.useRef<number | null>(null);

  const [isInitializing, setIsInitializing] = React.useState(true);
  const [cameraState, setCameraState] = React.useState<MediaReadiness>("loading");
  const [microphoneState, setMicrophoneState] =
    React.useState<MediaReadiness>("loading");
  const [cameraNotice, setCameraNotice] = React.useState<string | null>(null);
  const [microphoneNotice, setMicrophoneNotice] = React.useState<string | null>(
    null,
  );
  const [audioInputs, setAudioInputs] = React.useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = React.useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = React.useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInputDeviceId, setSelectedAudioInputDeviceId] =
    React.useState<string | null>(null);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = React.useState<
    string | null
  >(null);
  const [selectedAudioOutputDeviceId, setSelectedAudioOutputDeviceId] =
    React.useState<string | null>(null);
  const [joinMuted, setJoinMuted] = React.useState(false);
  const [joinWithCameraOff, setJoinWithCameraOff] = React.useState(false);
  const [micLevel, setMicLevel] = React.useState(0);

  const hasMediaDevices =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);
  const supportsSpeakerSelection = React.useMemo(() => {
    if (typeof window === "undefined") return false;
    const prototype = window.HTMLMediaElement?.prototype as {
      setSinkId?: (deviceId: string) => Promise<void>;
    };
    return Boolean(prototype?.setSinkId);
  }, []);

  const attachPreviewStream = React.useCallback((stream: MediaStream | null) => {
    const node = previewVideoRef.current;
    if (!node) return;
    node.srcObject = stream;
  }, []);

  const stopMicMeter = React.useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    analyserRef.current = null;
    if (mountedRef.current) {
      setMicLevel(0);
    }
  }, []);

  const startMicMeter = React.useCallback(
    (stream: MediaStream | null) => {
      stopMicMeter();
      if (!stream) return;

      const AudioContextCtor =
        window.AudioContext ||
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;
      if (!AudioContextCtor) return;

      const context = audioContextRef.current ?? new AudioContextCtor();
      audioContextRef.current = context;
      if (context.state === "suspended") {
        void context.resume().catch(() => {});
      }

      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      analyserRef.current = analyser;
      sourceNodeRef.current = source;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!mountedRef.current) return;
        analyser.getByteFrequencyData(data);
        let total = 0;
        for (let index = 0; index < data.length; index += 1) {
          total += data[index];
        }
        const average = data.length > 0 ? total / data.length : 0;
        setMicLevel(Math.min(1, average / 90));
        rafRef.current = window.requestAnimationFrame(tick);
      };
      tick();
    },
    [stopMicMeter],
  );

  const refreshDeviceLists = React.useCallback(
    async (preferred: DevicePreferences = {}) => {
      if (!hasMediaDevices) return;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!mountedRef.current) return;

        const nextAudioInputs = devices.filter(
          (device) => device.kind === "audioinput",
        );
        const nextVideoInputs = devices.filter(
          (device) => device.kind === "videoinput",
        );
        const nextAudioOutputs = devices.filter(
          (device) => device.kind === "audiooutput",
        );

        setAudioInputs(nextAudioInputs);
        setVideoInputs(nextVideoInputs);
        setAudioOutputs(nextAudioOutputs);

        setSelectedAudioInputDeviceId((current) =>
          chooseDeviceId(
            current,
            nextAudioInputs,
            preferred.audioInputDeviceId ?? current,
          ),
        );
        setSelectedVideoDeviceId((current) =>
          chooseDeviceId(
            current,
            nextVideoInputs,
            preferred.videoDeviceId ?? current,
          ),
        );
        setSelectedAudioOutputDeviceId((current) =>
          chooseDeviceId(
            current,
            nextAudioOutputs,
            preferred.audioOutputDeviceId ?? current,
          ),
        );
      } catch {
        if (!mountedRef.current) return;
        setAudioInputs([]);
        setVideoInputs([]);
        setAudioOutputs([]);
      }
    },
    [hasMediaDevices],
  );

  const requestCamera = React.useCallback(
    async (deviceId: string | null) => {
      if (!hasMediaDevices) {
        setCameraState("error");
        setCameraNotice("Camera preview is unavailable in this browser.");
        return;
      }

      if (mountedRef.current) {
        setCameraState("loading");
        setCameraNotice(null);
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId ? { deviceId: { exact: deviceId } } : true,
        });
        if (!mountedRef.current) {
          stopMediaStream(stream);
          return;
        }

        const trackDeviceId =
          stream.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId ?? null;

        stopMediaStream(cameraStreamRef.current);
        cameraStreamRef.current = stream;
        attachPreviewStream(stream);
        setCameraState("ready");
        setCameraNotice(null);
        setSelectedVideoDeviceId(trackDeviceId);
        await refreshDeviceLists({ videoDeviceId: trackDeviceId });
      } catch (error) {
        if (!mountedRef.current) return;
        const mapped = mapMediaError("camera", error);
        if (cameraStreamRef.current) {
          setCameraNotice("Unable to switch camera. Check permissions or device.");
          setCameraState("ready");
          return;
        }
        setCameraState(mapped.readiness);
        setCameraNotice(mapped.message);
      }
    },
    [attachPreviewStream, hasMediaDevices, refreshDeviceLists],
  );

  const requestMicrophone = React.useCallback(
    async (deviceId: string | null) => {
      if (!hasMediaDevices) {
        setMicrophoneState("error");
        setMicrophoneNotice("Microphone preview is unavailable in this browser.");
        return;
      }

      if (mountedRef.current) {
        setMicrophoneState("loading");
        setMicrophoneNotice(null);
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
          video: false,
        });
        if (!mountedRef.current) {
          stopMediaStream(stream);
          return;
        }

        const trackDeviceId =
          stream.getAudioTracks()[0]?.getSettings().deviceId ?? deviceId ?? null;

        stopMediaStream(microphoneStreamRef.current);
        microphoneStreamRef.current = stream;
        startMicMeter(stream);
        setMicrophoneState("ready");
        setMicrophoneNotice(null);
        setSelectedAudioInputDeviceId(trackDeviceId);
        await refreshDeviceLists({ audioInputDeviceId: trackDeviceId });
      } catch (error) {
        if (!mountedRef.current) return;
        const mapped = mapMediaError("microphone", error);
        if (microphoneStreamRef.current) {
          setMicrophoneNotice(
            "Unable to switch microphone. Check permissions or device.",
          );
          setMicrophoneState("ready");
          return;
        }
        stopMicMeter();
        setMicrophoneState(mapped.readiness);
        setMicrophoneNotice(mapped.message);
      }
    },
    [hasMediaDevices, refreshDeviceLists, startMicMeter, stopMicMeter],
  );

  React.useEffect(() => {
    mountedRef.current = true;
    let canceled = false;

    const initialize = async () => {
      if (!hasMediaDevices) {
        setIsInitializing(false);
        setCameraState("error");
        setMicrophoneState("error");
        setCameraNotice("Camera preview is unavailable in this browser.");
        setMicrophoneNotice("Microphone preview is unavailable in this browser.");
        return;
      }

      setIsInitializing(true);
      await refreshDeviceLists();
      await Promise.allSettled([requestCamera(null), requestMicrophone(null)]);
      await refreshDeviceLists({
        audioInputDeviceId:
          microphoneStreamRef.current
            ?.getAudioTracks()[0]
            ?.getSettings()
            .deviceId ?? null,
        videoDeviceId:
          cameraStreamRef.current?.getVideoTracks()[0]?.getSettings().deviceId ??
          null,
      });

      if (!canceled && mountedRef.current) {
        setIsInitializing(false);
      }
    };

    void initialize();

    const mediaDevices = navigator.mediaDevices;
    const previewNode = previewVideoRef.current;
    const handleDeviceChange = () => {
      void refreshDeviceLists();
    };
    mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);

    return () => {
      canceled = true;
      mountedRef.current = false;
      mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
      stopMicMeter();
      stopMediaStream(cameraStreamRef.current);
      stopMediaStream(microphoneStreamRef.current);
      cameraStreamRef.current = null;
      microphoneStreamRef.current = null;
      if (previewNode) {
        previewNode.srcObject = null;
      }
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context) {
        void context.close().catch(() => {});
      }
    };
  }, [
    hasMediaDevices,
    refreshDeviceLists,
    requestCamera,
    requestMicrophone,
    stopMicMeter,
  ]);

  const micBars = React.useMemo(
    () =>
      MIC_BAR_WEIGHTS.map((weight) => {
        const next = 10 + Math.round(34 * micLevel * weight);
        return Math.max(8, Math.min(44, next));
      }),
    [micLevel],
  );

  const forceAudioMuted = microphoneState !== "ready";
  const forceVideoMuted = cameraState !== "ready";
  const effectiveJoinMuted = joinMuted || forceAudioMuted;
  const effectiveJoinWithCameraOff = joinWithCameraOff || forceVideoMuted;
  const activeStep = Math.min(
    Math.max(activeJoinStep, 0),
    Math.max(joinSteps.length - 1, 0),
  );
  const showJoinProgress = joining || retryingJoin || Boolean(joinError);

  const cameraStatusText =
    cameraState === "ready"
      ? "Camera ready"
      : cameraState === "loading"
        ? "Checking camera..."
        : "Camera unavailable";
  const microphoneStatusText =
    microphoneState === "ready"
      ? "Microphone active"
      : microphoneState === "loading"
        ? "Checking microphone..."
        : "Microphone unavailable";

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[radial-gradient(circle_at_top,_#172032,_#0b1117_55%,_#070b11_100%)] px-4 py-8 text-white">
      <div className="w-full max-w-6xl">
        <div className="rounded-[28px] border border-white/10 bg-black/35 p-5 shadow-[0_28px_80px_rgba(0,0,0,0.45)] md:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-white/45">
                Focus session
              </p>
              <h1 className="mt-2 text-2xl font-semibold md:text-3xl">
                Green Room
              </h1>
              <p className="mt-2 text-sm text-white/65">
                Check your setup before entering the session.
              </p>
            </div>
            <span
              className={cx(
                "rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em]",
                isOffline
                  ? "border-rose-400/40 bg-rose-500/10 text-rose-200"
                  : "border-emerald-400/30 bg-emerald-500/10 text-emerald-100",
              )}
            >
              {isOffline ? "Offline" : "Ready"}
            </span>
          </div>

          {isOffline ? (
            <div className="mt-5 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
              <p className="font-medium">You are offline.</p>
              <p className="mt-1 text-rose-100/85">
                Reconnect to the internet, then join the session.
              </p>
            </div>
          ) : null}

          {showJoinProgress ? (
            <section className="mt-5 min-h-[380px] rounded-3xl border border-white/10 bg-black/40 p-5 md:p-7">
              <p className="text-xs uppercase tracking-[0.24em] text-white/45">
                Joining
              </p>
              <h2 className="mt-3 text-2xl font-semibold">
                {joinError
                  ? "Unable to join right now"
                  : retryingJoin
                    ? "Retrying your connection..."
                    : "Connecting you to the session..."}
              </h2>
              <ol className="mt-6 space-y-3">
                {joinSteps.map((step, index) => {
                  const isComplete = index < activeStep && !joinError;
                  const isCurrent = index === activeStep;
                  return (
                    <li
                      key={step}
                      className={cx(
                        "flex items-center gap-3 rounded-xl border px-3 py-2 text-sm transition",
                        isComplete
                          ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-100"
                          : isCurrent
                            ? "border-sky-400/35 bg-sky-400/10 text-sky-100"
                            : "border-white/10 bg-white/5 text-white/55",
                      )}
                    >
                      <span
                        className={cx(
                          "inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-semibold",
                          isComplete
                            ? "border-emerald-300/50 bg-emerald-400/20"
                            : isCurrent
                              ? "border-sky-300/50 bg-sky-400/20"
                              : "border-white/15 bg-white/5",
                        )}
                      >
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  );
                })}
              </ol>

              {showSlowConnectingHint && !joinError ? (
                <p className="mt-5 rounded-xl border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-sm text-sky-100">
                  Still connecting—this can take a moment on some networks.
                </p>
              ) : null}

              {joinError ? (
                <div className="mt-5 rounded-xl border border-rose-500/35 bg-rose-500/10 p-3 text-sm text-rose-100">
                  {joinError}
                </div>
              ) : null}

              <div className="mt-6 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onRetry}
                  disabled={retryingJoin || joining || isOffline}
                  className={cx(
                    "inline-flex h-10 items-center justify-center rounded-full border px-4 text-xs font-semibold uppercase tracking-[0.14em] transition",
                    "border-sky-300/50 bg-sky-400/20 text-sky-100 hover:bg-sky-400/30",
                    (retryingJoin || joining || isOffline) &&
                      "cursor-not-allowed opacity-60 hover:bg-inherit",
                  )}
                >
                  {retryingJoin ? "Retrying..." : "Try again"}
                </button>
                <button
                  type="button"
                  onClick={onBack}
                  className="inline-flex h-10 items-center justify-center rounded-full border border-white/25 bg-white/10 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-white transition hover:bg-white/20"
                >
                  Back to Studio
                </button>
              </div>
            </section>
          ) : (
            <section className="mt-5 grid gap-4 lg:grid-cols-[1.12fr_0.88fr]">
              <div className="rounded-3xl border border-white/10 bg-black/40 p-4 md:p-5">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/45">
                  <span>Camera preview</span>
                  <span>{cameraStatusText}</span>
                </div>
                <div className="mt-3 h-[280px] overflow-hidden rounded-2xl border border-white/10 bg-black/65 md:h-[320px]">
                  {cameraState === "ready" ? (
                    <video
                      ref={previewVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="h-full w-full scale-x-[-1] object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center text-sm text-white/65">
                      <Camera className="h-8 w-8 text-white/40" />
                      <p>Camera preview unavailable</p>
                    </div>
                  )}
                </div>
                {cameraNotice ? (
                  <p className="mt-3 text-sm text-white/70">{cameraNotice}</p>
                ) : null}

                <div className="mt-5">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/45">
                    <span>Microphone activity</span>
                    <span>{microphoneStatusText}</span>
                  </div>
                  <div className="mt-3 rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
                    {microphoneState === "ready" ? (
                      <div className="flex h-[46px] items-end gap-1.5">
                        {micBars.map((height, index) => (
                          <span
                            key={`mic-bar-${index}`}
                            className="w-2 rounded-full bg-emerald-300/85 transition-[height] duration-120"
                            style={{ height: `${height}px` }}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="flex h-[46px] items-center justify-center text-sm text-white/60">
                        Mic unavailable
                      </div>
                    )}
                  </div>
                  {microphoneNotice ? (
                    <p className="mt-2 text-sm text-white/70">{microphoneNotice}</p>
                  ) : null}
                </div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-black/40 p-4 md:p-5">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.2em] text-white/45">
                    Devices
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      void refreshDeviceLists();
                    }}
                    className="inline-flex h-9 items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70 transition hover:border-white/25 hover:text-white"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Refresh
                  </button>
                </div>

                <div className="mt-4 space-y-4">
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">
                      Microphone
                    </span>
                    <select
                      value={selectedAudioInputDeviceId ?? ""}
                      onChange={(event) => {
                        const next = event.target.value || null;
                        setSelectedAudioInputDeviceId(next);
                        void requestMicrophone(next);
                      }}
                      disabled={isInitializing || audioInputs.length === 0}
                      className="mt-1.5 w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition hover:border-white/20 focus:border-sky-400 focus:ring-2 focus:ring-sky-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {audioInputs.length === 0 ? (
                        <option value="">No microphone found</option>
                      ) : (
                        audioInputs.map((device, index) => (
                          <option key={device.deviceId} value={device.deviceId}>
                            {getDeviceLabel(device, index, "Microphone")}
                          </option>
                        ))
                      )}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">
                      Camera
                    </span>
                    <select
                      value={selectedVideoDeviceId ?? ""}
                      onChange={(event) => {
                        const next = event.target.value || null;
                        setSelectedVideoDeviceId(next);
                        void requestCamera(next);
                      }}
                      disabled={isInitializing || videoInputs.length === 0}
                      className="mt-1.5 w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition hover:border-white/20 focus:border-sky-400 focus:ring-2 focus:ring-sky-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {videoInputs.length === 0 ? (
                        <option value="">No camera found</option>
                      ) : (
                        videoInputs.map((device, index) => (
                          <option key={device.deviceId} value={device.deviceId}>
                            {getDeviceLabel(device, index, "Camera")}
                          </option>
                        ))
                      )}
                    </select>
                  </label>

                  {supportsSpeakerSelection ? (
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">
                        Speaker
                      </span>
                      <select
                        value={selectedAudioOutputDeviceId ?? ""}
                        onChange={(event) => {
                          setSelectedAudioOutputDeviceId(event.target.value || null);
                        }}
                        disabled={audioOutputs.length === 0}
                        className="mt-1.5 w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition hover:border-white/20 focus:border-sky-400 focus:ring-2 focus:ring-sky-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {audioOutputs.length === 0 ? (
                          <option value="">System default speaker</option>
                        ) : (
                          audioOutputs.map((device, index) => (
                            <option key={device.deviceId} value={device.deviceId}>
                              {getDeviceLabel(device, index, "Speaker")}
                            </option>
                          ))
                        )}
                      </select>
                    </label>
                  ) : null}
                </div>

                <div className="mt-5 space-y-2">
                  <button
                    type="button"
                    aria-pressed={joinMuted}
                    onClick={() => setJoinMuted((prev) => !prev)}
                    className={cx(
                      "flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-left text-sm transition",
                      joinMuted
                        ? "border-emerald-300/45 bg-emerald-500/10 text-emerald-100"
                        : "border-white/10 bg-white/5 text-white/80 hover:border-white/20",
                    )}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Mic className="h-4 w-4" />
                      Join muted
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-[0.12em]">
                      {effectiveJoinMuted ? "On" : "Off"}
                    </span>
                  </button>

                  <button
                    type="button"
                    aria-pressed={joinWithCameraOff}
                    onClick={() => setJoinWithCameraOff((prev) => !prev)}
                    className={cx(
                      "flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-left text-sm transition",
                      joinWithCameraOff
                        ? "border-emerald-300/45 bg-emerald-500/10 text-emerald-100"
                        : "border-white/10 bg-white/5 text-white/80 hover:border-white/20",
                    )}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Camera className="h-4 w-4" />
                      Join with camera off
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-[0.12em]">
                      {effectiveJoinWithCameraOff ? "On" : "Off"}
                    </span>
                  </button>
                </div>

                {forceAudioMuted || forceVideoMuted ? (
                  <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                    {forceAudioMuted && forceVideoMuted
                      ? "We will join with mic muted and camera off until permissions are available."
                      : forceAudioMuted
                        ? "We will join with your microphone muted until permission is available."
                        : "We will join with your camera off until permission is available."}
                  </p>
                ) : null}

                <div className="mt-6 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onJoin({
                        joinMuted,
                        joinWithCameraOff,
                        audioInputDeviceId: selectedAudioInputDeviceId,
                        videoDeviceId: selectedVideoDeviceId,
                        audioOutputDeviceId: selectedAudioOutputDeviceId,
                        forceAudioMuted,
                        forceVideoMuted,
                      })
                    }
                    disabled={joining || retryingJoin || isOffline}
                    className={cx(
                      "btn-primary h-10 px-5 text-xs uppercase tracking-[0.2em]",
                      (joining || retryingJoin || isOffline) &&
                        "cursor-not-allowed opacity-60",
                    )}
                  >
                    Join session
                  </button>
                  <button
                    type="button"
                    onClick={onBack}
                    className="btn-secondary h-10 gap-2 px-4 text-xs uppercase tracking-[0.18em]"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
