"use client";

import React from "react";
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

type FocusmateSessionRoomProps = {
  sessionId: string;
  user: {
    id: string;
    displayName?: string | null;
    name?: string | null;
    email?: string | null;
  };
};

type VideoTileProps = {
  peerId: string;
  label: string;
  isLocal: boolean;
  className?: string;
};

function VideoTile({ peerId, label, isLocal, className }: VideoTileProps) {
  const cameraTrack = useHMSStore(selectCameraStreamByPeerID(peerId));
  const screenShare = useHMSStore(selectScreenSharesByPeerId(peerId));
  const trackId = screenShare?.video?.id ?? cameraTrack?.id;
  const { videoRef } = useVideo({ trackId });

  return (
    <div
      className={`relative overflow-hidden rounded-[28px] border border-white/10 bg-black/80 shadow-[0_20px_60px_rgba(0,0,0,0.45)] ${
        className ?? ""
      }`}
    >
      {trackId ? (
        <video
          ref={videoRef}
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
}: FocusmateSessionRoomProps) {
  const hmsActions = useHMSActions();
  const isConnected = useHMSStore(selectIsConnectedToRoom);
  const peers = useHMSStore(selectPeers);
  const localPeer = useHMSStore(selectLocalPeer);
  const isMicOn = useHMSStore(selectIsLocalAudioEnabled);
  const isCamOn = useHMSStore(selectIsLocalVideoEnabled);
  const isShareOn = useHMSStore(selectIsLocalScreenShared);

  const [joining, setJoining] = React.useState(false);
  const [joinError, setJoinError] = React.useState<string | null>(null);
  const [pipOverlayOn, setPipOverlayOn] = React.useState(false);
  const [pipVideoEl, setPipVideoEl] = React.useState<HTMLVideoElement | null>(
    null,
  );

  const joinRequested = React.useRef(false);

  const displayName =
    user.displayName || user.name || user.email || "Guest";

  React.useEffect(() => {
    if (joinRequested.current) return;
    joinRequested.current = true;

    let active = true;
    (async () => {
      setJoining(true);
      setJoinError(null);
      try {
        const storageKey = `focus-session-token:${sessionId}`;
        let authToken: string | null = null;
        if (typeof window !== "undefined") {
          authToken = window.sessionStorage.getItem(storageKey);
          if (authToken) {
            window.sessionStorage.removeItem(storageKey);
          }
        }

        const tryJoin = async (token: string) => {
          await hmsActions.join({
            userName: displayName,
            authToken: token,
          });
        };

        if (authToken) {
          try {
            await tryJoin(authToken);
            return;
          } catch (err) {
            console.error("[focus sessions] join with cached token failed", err);
            authToken = null;
          }
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
        if (active) setJoinError("Unable to join session.");
      } finally {
        if (active) setJoining(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [displayName, hmsActions, sessionId]);

  React.useEffect(() => {
    return () => {
      hmsActions.leave().catch(() => {});
    };
  }, [hmsActions]);

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

  async function toggleMic() {
    try {
      await hmsActions.setLocalAudioEnabled(!isMicOn);
    } catch (err) {
      console.error(err);
    }
  }

  async function toggleCam() {
    try {
      await hmsActions.setLocalVideoEnabled(!isCamOn);
    } catch (err) {
      console.error(err);
    }
  }

  async function toggleScreenShare() {
    try {
      await hmsActions.setScreenShareEnabled(!isShareOn);
    } catch (err) {
      console.error(err);
    }
  }

  async function togglePip() {
    const nextState = !pipOverlayOn;
    setPipOverlayOn(nextState);

    if (typeof document === "undefined") return;

    if (document.pictureInPictureElement) {
      try {
        await document.exitPictureInPicture();
      } catch (err) {
        console.error(err);
      }
      return;
    }

    if (!nextState || !pipVideoEl) return;
    if (document.pictureInPictureEnabled && pipVideoEl.requestPictureInPicture) {
      try {
        await pipVideoEl.requestPictureInPicture();
      } catch (err) {
        console.error(err);
      }
    }
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
              {joinError
                ? "Unable to join"
                : joining
                  ? "Connecting..."
                  : isConnected
                    ? "Live"
                    : "Waiting to connect"}
            </div>
          </div>

          {joinError ? (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
              {joinError}
            </div>
          ) : null}

          <div className="mx-auto w-full max-w-6xl">
            {peerCount === 0 ? (
              <div className="flex h-[52vh] items-center justify-center rounded-[28px] border border-white/10 bg-black/40 text-sm text-white/60 md:h-[60vh] lg:h-[66vh]">
                Connecting to the session...
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
            className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition ${
              isMicOn
                ? "bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"
                : "bg-rose-500/20 text-rose-100 hover:bg-rose-500/30"
            }`}
          >
            {isMicOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            {isMicOn ? "Mute" : "Unmute"}
          </button>

          <button
            type="button"
            onClick={toggleCam}
            className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition ${
              isCamOn
                ? "bg-white/10 text-white hover:bg-white/20"
                : "bg-white/10 text-white/70 hover:bg-white/20"
            }`}
          >
            {isCamOn ? (
              <VideoOff className="h-4 w-4" />
            ) : (
              <Video className="h-4 w-4" />
            )}
            {isCamOn ? "Camera off" : "Camera on"}
          </button>

          <button
            type="button"
            onClick={toggleScreenShare}
            className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition ${
              isShareOn
                ? "bg-indigo-500/20 text-indigo-100 hover:bg-indigo-500/30"
                : "bg-white/10 text-white/70 hover:bg-white/20"
            }`}
          >
            {isShareOn ? (
              <MonitorOff className="h-4 w-4" />
            ) : (
              <MonitorUp className="h-4 w-4" />
            )}
            {isShareOn ? "Stop share" : "Share screen"}
          </button>

          <button
            type="button"
            onClick={togglePip}
            className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition ${
              pipOverlayOn
                ? "bg-sky-500/20 text-sky-100 hover:bg-sky-500/30"
                : "bg-white/10 text-white/70 hover:bg-white/20"
            }`}
          >
            <PictureInPicture2 className="h-4 w-4" />
            PiP
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
