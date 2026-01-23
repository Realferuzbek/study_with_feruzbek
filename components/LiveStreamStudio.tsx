"use client";

import React from "react";
import type { HMSMessage, HMSPeer } from "@100mslive/react-sdk";
import {
  selectBroadcastMessages,
  selectCameraStreamByPeerID,
  selectIsConnectedToRoom,
  selectIsLocalAudioEnabled,
  selectIsLocalScreenShared,
  selectIsLocalVideoEnabled,
  selectPeers,
  selectPermissions,
  useHMSActions,
  useHMSStore,
} from "@100mslive/react-sdk";
import { csrfFetch } from "@/lib/csrf-client";

type Role = "admin" | "host" | "viewer";

const roleToRoomCode: Record<Role, string | undefined> = {
  admin:
    process.env.NEXT_PUBLIC_HMS_ROOM_CODE_ADMIN ||
    process.env.HMS_ROOM_CODE_ADMIN,
  host:
    process.env.NEXT_PUBLIC_HMS_ROOM_CODE_HOST ||
    process.env.HMS_ROOM_CODE_HOST,
  viewer:
    process.env.NEXT_PUBLIC_HMS_ROOM_CODE_VIEWER ||
    process.env.HMS_ROOM_CODE_VIEWER,
};

export default function LiveStreamStudio() {
  const hmsActions = useHMSActions();
  const isConnected = useHMSStore(selectIsConnectedToRoom);
  const peers = useHMSStore(selectPeers);
  const perms = useHMSStore(selectPermissions);
  const isMicOn = useHMSStore(selectIsLocalAudioEnabled);
  const isCamOn = useHMSStore(selectIsLocalVideoEnabled);
  const isShareOn = useHMSStore(selectIsLocalScreenShared);
  const messages = useHMSStore(selectBroadcastMessages);

  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<Role>("viewer");
  const [joining, setJoining] = React.useState(false);
  const [chat, setChat] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  async function join() {
    try {
      setJoining(true);
      setError(null);
      const roomCode = roleToRoomCode[role];
      if (!roomCode) {
        throw new Error(
          `Room code missing for ${role}. Add it to your environment variables.`,
        );
      }

      const fallbackId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `guest-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
      const userId = (name || "").trim() || fallbackId;

      const res = await csrfFetch("/api/100ms/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          roomCode,
          role,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        const message = payload?.error ?? "Failed to join the room.";
        throw new Error(message);
      }

      const payload = await res.json();
      if (!payload?.token) {
        throw new Error("Missing auth token.");
      }

      await hmsActions.join({ userName: name || "Guest", authToken: payload.token });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to join the room.";
      setError(message);
      console.error(err);
    } finally {
      setJoining(false);
    }
  }

  async function leave() {
    await hmsActions.leave();
  }

  async function toggleMic() {
    await hmsActions.setLocalAudioEnabled(!isMicOn);
  }

  async function toggleCam() {
    await hmsActions.setLocalVideoEnabled(!isCamOn);
  }

  async function toggleShare() {
    await hmsActions.setScreenShareEnabled(!isShareOn);
  }

  async function sendChat() {
    if (!chat.trim()) return;
    await hmsActions.sendBroadcastMessage(chat.trim());
    setChat("");
  }

  async function hardMuteAll() {
    await hmsActions.setRemoteTracksEnabled({
      enabled: false,
      type: "audio",
    });
  }

  async function endRoomForAll() {
    await hmsActions.endRoom(true, "Session ended by admin");
  }

  return (
    <div className="p-6 max-w-6xl mx-auto text-white">
      {!isConnected ? (
        <div className="space-y-4 max-w-xl">
          <h1 className="text-3xl font-semibold">Live Stream Studio</h1>
          <p className="text-neutral-300">
            Join with your preferred role to start broadcasting or viewing the
            live session.
          </p>
          <input
            className="bg-neutral-800 px-3 py-2 rounded w-full"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex gap-3">
            {(["viewer", "host", "admin"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={`px-3 py-2 rounded capitalize ${
                  role === r ? "bg-indigo-600" : "bg-neutral-700"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <button
            onClick={join}
            disabled={joining}
            className="bg-green-600 px-4 py-2 rounded disabled:opacity-50"
          >
            {joining ? "Joining..." : "Join Room"}
          </button>
          {error ? <p className="text-rose-400 text-sm">{error}</p> : null}
          {!roleToRoomCode[role] ? (
            <p className="text-yellow-400 text-xs">
              Add the room code for the selected role to `.env.local` and
              redeploy to enable joining.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 space-y-3">
            <div>
              <h2 className="text-xl font-medium">
                Participants ({peers.length})
              </h2>
              <p className="text-sm text-neutral-400">
                Share controls below to manage your mic, camera, and screen
                share.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {peers.map((peer) => (
                <PeerTile key={peer.id} peer={peer} />
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="bg-neutral-800 p-3 rounded">
              <div className="font-semibold mb-2">Controls</div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="bg-neutral-700 px-3 py-2 rounded"
                  onClick={toggleMic}
                >
                  {isMicOn ? "Mute" : "Unmute"}
                </button>
                <button
                  className="bg-neutral-700 px-3 py-2 rounded"
                  onClick={toggleCam}
                >
                  {isCamOn ? "Camera Off" : "Camera On"}
                </button>
                <button
                  className="bg-neutral-700 px-3 py-2 rounded"
                  onClick={toggleShare}
                >
                  {isShareOn ? "Stop Share" : "Share Screen"}
                </button>
                <button
                  className="bg-red-600 px-3 py-2 rounded"
                  onClick={leave}
                >
                  Leave
                </button>
              </div>

              {(perms?.endRoom || perms?.mute || perms?.removeOthers) && (
                <div className="mt-4 border-t border-neutral-700 pt-3 space-y-2">
                  <div className="font-semibold">Admin</div>
                  <button
                    className="bg-rose-600 px-3 py-2 rounded w-full"
                    onClick={hardMuteAll}
                  >
                    Hard mute everyone
                  </button>
                  <button
                    className="bg-rose-700 px-3 py-2 rounded w-full"
                    onClick={endRoomForAll}
                  >
                    End room for everyone
                  </button>
                </div>
              )}
            </div>

            <div className="bg-neutral-800 p-3 rounded">
              <div className="font-semibold mb-2">Chat</div>
              <div className="h-64 overflow-auto bg-neutral-900 p-2 rounded text-sm mb-2">
                {messages.length === 0 ? (
                  <p className="text-neutral-500">No messages yet.</p>
                ) : (
                  messages.map((m: HMSMessage) => (
                    <div key={m.id} className="mb-1">
                      <span className="text-neutral-400">{m.senderName}: </span>
                      <span>{m.message}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-neutral-900 px-2 py-2 rounded"
                  placeholder="Type message…"
                  value={chat}
                  onChange={(e) => setChat(e.target.value)}
                />
                <button
                  className="bg-indigo-600 px-3 py-2 rounded"
                  onClick={sendChat}
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PeerTile({ peer }: { peer: HMSPeer }) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const hmsActions = useHMSActions();
  const videoTrack = useHMSStore(selectCameraStreamByPeerID(peer.id));

  React.useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || !videoTrack?.id) return;

    (async () => {
      await hmsActions.attachVideo(videoTrack.id, videoElement);
    })();

    return () => {
      hmsActions.detachVideo(videoTrack.id, videoElement);
    };
  }, [hmsActions, videoTrack?.id]);

  return (
    <div className="bg-black rounded overflow-hidden border border-neutral-800">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={peer.isLocal}
        className="w-full aspect-video bg-black"
      />
      <div className="p-2 text-sm flex justify-between">
        <span>{peer.name || "Guest"}</span>
        <span className="text-neutral-500">{peer.roleName}</span>
      </div>
    </div>
  );
}
