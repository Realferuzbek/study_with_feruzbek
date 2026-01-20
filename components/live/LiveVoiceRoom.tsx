"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Copy,
  Mic,
  MicOff,
  PhoneOff,
  Users,
  Video,
  VideoOff,
} from "lucide-react";
import {
  selectCameraStreamByPeerID,
  selectIsConnectedToRoom,
  selectIsLocalAudioEnabled,
  selectIsLocalVideoEnabled,
  selectLocalPeer,
  selectPeersWithAudioStatus,
  useHMSActions,
  useHMSStore,
} from "@100mslive/react-sdk";
import { csrfFetch } from "@/lib/csrf-client";

type LiveVoiceRoomProps = {
  roomId: string;
  user: {
    id: string;
    displayName?: string | null;
    name?: string | null;
    email?: string | null;
    isAdmin?: boolean | null;
  };
};

type RoomData = {
  id: string;
  title: string;
  description: string | null;
  visibility: "public" | "unlisted";
  status: "active" | "ended";
  created_by: string;
  created_at: string;
  max_size: number;
};

function initialsFromName(name: string) {
  const cleaned = name.trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/\s+/).slice(0, 2);
  return parts
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function buildInviteUrl(roomId: string) {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/feature/live/room/${roomId}`;
}

export default function LiveVoiceRoom({ roomId, user }: LiveVoiceRoomProps) {
  const router = useRouter();
  const hmsActions = useHMSActions();
  const isConnected = useHMSStore(selectIsConnectedToRoom);
  const peersWithAudio = useHMSStore(selectPeersWithAudioStatus);
  const isMicOn = useHMSStore(selectIsLocalAudioEnabled);
  const isCamOn = useHMSStore(selectIsLocalVideoEnabled);
  const localPeer = useHMSStore(selectLocalPeer);
  const localVideoTrack = useHMSStore(
    selectCameraStreamByPeerID(localPeer?.id ?? ""),
  );

  const [room, setRoom] = React.useState<RoomData | null>(null);
  const [roomError, setRoomError] = React.useState<string | null>(null);
  const [joinError, setJoinError] = React.useState<string | null>(null);
  const [joining, setJoining] = React.useState(false);
  const [role, setRole] = React.useState<"viewer" | "host" | "admin" | null>(
    null,
  );
  const [micBlocked, setMicBlocked] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [ending, setEnding] = React.useState(false);

  const joinRequested = React.useRef(false);
  const mediaConfigured = React.useRef(false);
  const previewRef = React.useRef<HTMLVideoElement | null>(null);

  const displayName =
    user.displayName || user.name || user.email || "Guest";

  React.useEffect(() => {
    let active = true;
    async function loadRoom() {
      setRoomError(null);
      try {
        const res = await fetch(`/api/voice/rooms/${roomId}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          const message = payload?.error ?? "Unable to load room.";
          if (active) setRoomError(message);
          return;
        }
        const data = await res.json();
        if (active) setRoom(data);
      } catch (err) {
        console.error(err);
        if (active) setRoomError("Unable to load room.");
      }
    }
    loadRoom();
    return () => {
      active = false;
    };
  }, [roomId]);

  React.useEffect(() => {
    if (joinRequested.current) return;
    joinRequested.current = true;
    (async () => {
      setJoining(true);
      setJoinError(null);
      try {
        const res = await csrfFetch("/api/voice/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          const message = payload?.error ?? "Unable to join room.";
          setJoinError(message);
          return;
        }
        const payload = await res.json();
        setRole(payload.role ?? "viewer");
        await hmsActions.join({
          userName: displayName,
          authToken: payload.token,
        });
      } catch (err) {
        console.error(err);
        setJoinError("Unable to join room.");
      } finally {
        setJoining(false);
      }
    })();
  }, [displayName, hmsActions, roomId]);

  React.useEffect(() => {
    if (!isConnected || mediaConfigured.current) return;
    mediaConfigured.current = true;
    hmsActions.setLocalVideoEnabled(false).catch(() => {});
    hmsActions
      .setLocalAudioEnabled(true)
      .then(() => setMicBlocked(false))
      .catch(() => setMicBlocked(true));
  }, [hmsActions, isConnected]);

  React.useEffect(() => {
    const videoElement = previewRef.current;
    if (!videoElement || !localVideoTrack?.id) return;
    hmsActions.attachVideo(localVideoTrack.id, videoElement);
    return () => {
      hmsActions.detachVideo(localVideoTrack.id, videoElement);
    };
  }, [hmsActions, localVideoTrack?.id]);

  const sortedPeers = React.useMemo(() => {
    const next = [...peersWithAudio];
    next.sort((a, b) => {
      if (a.peer.isLocal && !b.peer.isLocal) return -1;
      if (!a.peer.isLocal && b.peer.isLocal) return 1;
      return (a.peer.name || "").localeCompare(b.peer.name || "");
    });
    return next;
  }, [peersWithAudio]);

  async function handleCopyInvite() {
    const link = buildInviteUrl(roomId);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error(err);
    }
  }

  async function toggleMic() {
    try {
      await hmsActions.setLocalAudioEnabled(!isMicOn);
      setMicBlocked(false);
    } catch {
      setMicBlocked(true);
    }
  }

  async function toggleCam() {
    try {
      await hmsActions.setLocalVideoEnabled(!isCamOn);
    } catch (err) {
      console.error(err);
    }
  }

  async function leaveRoom() {
    try {
      await hmsActions.leave();
    } finally {
      router.push("/feature/live");
    }
  }

  async function endRoom() {
    setEnding(true);
    try {
      const res = await csrfFetch(`/api/voice/rooms/${roomId}`, {
        method: "PATCH",
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        const message = payload?.error ?? "Failed to end room.";
        setJoinError(message);
        return;
      }
      await hmsActions.leave();
      router.push("/feature/live");
    } catch (err) {
      console.error(err);
      setJoinError("Failed to end room.");
    } finally {
      setEnding(false);
    }
  }

  const showEndRoom = role === "host" || role === "admin";

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-6xl flex-col px-4 py-6 text-white">
      <header className="flex flex-col gap-4 border-b border-white/10 pb-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/feature/live")}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/70 transition hover:border-white/30 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Lobby
          </button>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-white/45">
              Voice room
            </p>
            <h1 className="text-2xl font-semibold">
              {room?.title ?? "Loading room..."}
            </h1>
            {room?.description ? (
              <p className="text-sm text-white/55">{room.description}</p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleCopyInvite}
            className="btn-secondary h-10 px-4 text-xs uppercase tracking-[0.2em]"
          >
            {copied ? "Invite copied" : "Copy invite link"}
          </button>
          <button
            type="button"
            onClick={leaveRoom}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-rose-500/40 bg-rose-500/10 px-4 text-xs font-semibold uppercase tracking-[0.2em] text-rose-200 transition hover:border-rose-400/60 hover:bg-rose-500/20"
          >
            <PhoneOff className="h-4 w-4" />
            Leave
          </button>
        </div>
      </header>

      {room?.status === "ended" ? (
        <div className="mt-6 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-5 text-sm text-rose-200">
          This room has ended.
        </div>
      ) : null}

      {roomError ? (
        <div className="mt-6 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-5 text-sm text-rose-200">
          {roomError}
        </div>
      ) : null}

      {joinError ? (
        <div className="mt-6 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-5 text-sm text-rose-200">
          {joinError}
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr,0.8fr]">
        <section className="rounded-[28px] border border-white/10 bg-white/5 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-white/50">
                Participants
              </p>
              <h2 className="text-lg font-semibold">
                {peersWithAudio.length} in room
              </h2>
            </div>
            <span className="pill">
              <Users className="h-3 w-3" />
              Live
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {sortedPeers.map((participant) => (
              <div
                key={participant.peer.id}
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`relative flex h-12 w-12 items-center justify-center rounded-full text-sm font-semibold uppercase ${
                      participant.isAudioEnabled
                        ? "bg-emerald-500/20 text-emerald-100 ring-2 ring-emerald-400/40"
                        : "bg-white/10 text-white/80 ring-1 ring-white/10"
                    }`}
                  >
                    {initialsFromName(participant.peer.name || "Guest")}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {participant.peer.name || "Guest"}
                      {participant.peer.isLocal ? " (You)" : ""}
                    </p>
                    <p className="text-xs text-white/50">
                      {participant.peer.roleName}
                    </p>
                  </div>
                </div>
                <div
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${
                    participant.isAudioEnabled
                      ? "bg-emerald-500/20 text-emerald-100"
                      : "bg-rose-500/20 text-rose-100"
                  }`}
                >
                  {participant.isAudioEnabled ? (
                    <>
                      <Mic className="h-3 w-3" />
                      Live
                    </>
                  ) : (
                    <>
                      <MicOff className="h-3 w-3" />
                      Muted
                    </>
                  )}
                </div>
              </div>
            ))}
            {peersWithAudio.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-center text-sm text-white/60">
                No one is here yet. Stay in the room and invite others.
              </div>
            ) : null}
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-[24px] border border-white/10 bg-white/5 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
            <p className="text-xs uppercase tracking-[0.3em] text-white/50">
              Your setup
            </p>
            <h3 className="mt-2 text-lg font-semibold">Voice first</h3>
            <p className="mt-2 text-sm text-white/60">
              Camera stays off unless you enable it. Use the mic button below to
              speak.
            </p>
            {micBlocked ? (
              <div className="mt-4 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-xs text-amber-100">
                Enable microphone access to speak. Check browser permissions and
                try again.
              </div>
            ) : null}
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/5 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
            <p className="text-xs uppercase tracking-[0.3em] text-white/50">
              Optional video
            </p>
            <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black/40">
              {isCamOn ? (
                <video
                  ref={previewRef}
                  autoPlay
                  muted
                  playsInline
                  className="h-48 w-full bg-black object-cover"
                />
              ) : (
                <div className="flex h-48 items-center justify-center text-sm text-white/50">
                  Camera is off
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/5 p-5 text-sm text-white/60 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
            <p className="font-semibold text-white">Status</p>
            <p className="mt-2">
              {joining
                ? "Connecting to room..."
                : isConnected
                  ? "Connected"
                  : "Waiting to connect"}
            </p>
          </div>
        </aside>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3 pb-10">
        <button
          type="button"
          onClick={toggleMic}
          className={`inline-flex h-12 items-center gap-2 rounded-full px-6 text-sm font-semibold transition ${
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
          className="inline-flex h-12 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 text-sm font-semibold text-white/80 transition hover:border-white/25 hover:text-white"
        >
          {isCamOn ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
          {isCamOn ? "Camera off" : "Camera on"}
        </button>

        {showEndRoom ? (
          <button
            type="button"
            onClick={endRoom}
            disabled={ending}
            className="inline-flex h-12 items-center gap-2 rounded-full border border-rose-500/40 bg-rose-500/10 px-6 text-sm font-semibold text-rose-200 transition hover:border-rose-400/60 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            End room
          </button>
        ) : null}
      </div>
    </div>
  );
}
