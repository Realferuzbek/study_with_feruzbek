export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseServer";
import {
  type HmsRole,
  buildHmsRoomName,
  createHmsAuthToken,
  createHmsManagementToken,
  resolveHmsRole,
} from "@/lib/voice/hms";

type RouteContext = {
  params: { sessionId: string };
};

type FocusSessionRow = {
  id: string;
  room_id?: string | null;
  start_at: string;
  end_at?: string | null;
  duration_minutes?: number | null;
  status?: string | null;
  max_participants?: number | null;
  host_id?: string | null;
};

function isJoinableStatus(status: string | null | undefined) {
  return status === "scheduled" || status === "active";
}

function resolvePublishableRole(
  value: string | undefined,
  fallback: "host" | "peer",
): HmsRole {
  const resolved = resolveHmsRole(value ?? fallback);
  return resolved === "viewer" ? fallback : resolved;
}

export async function POST(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  const user = session?.user as { id?: string } | undefined;
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionId = context.params.sessionId;
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("focus_sessions")
    .select(
      "id, room_id, start_at, end_at, duration_minutes, status, max_participants, host_id",
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    console.error("[focus sessions] lookup failed", error);
    return NextResponse.json(
      { error: "Failed to load session" },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const focusSession = data as FocusSessionRow;
  const startsAt = new Date(focusSession.start_at);
  const endsAt = focusSession.end_at
    ? new Date(focusSession.end_at)
    : new Date(
        startsAt.getTime() +
          (focusSession.duration_minutes ?? 0) * 60 * 1000,
      );

  if (Number.isNaN(startsAt.valueOf()) || Number.isNaN(endsAt.valueOf())) {
    return NextResponse.json(
      { error: "Session time is invalid" },
      { status: 500 },
    );
  }

  const status = (focusSession.status ?? "scheduled").toLowerCase();
  if (!isJoinableStatus(status)) {
    return NextResponse.json(
      { error: "Session is not available" },
      { status: 409 },
    );
  }

  const isHost = Boolean(focusSession.host_id && focusSession.host_id === user.id);
  if (!isHost) {
    const { data: participantRow, error: participantLookupError } = await sb
      .from("focus_session_participants")
      .select("role")
      .eq("session_id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (participantLookupError) {
      console.error(
        "[focus sessions] participant reservation lookup failed",
        participantLookupError,
      );
      return NextResponse.json(
        { error: "Failed to verify reservation" },
        { status: 500 },
      );
    }

    const reservationRole =
      typeof participantRow?.role === "string"
        ? participantRow.role.toLowerCase()
        : null;
    const hasParticipantReservation =
      Boolean(participantRow) &&
      (reservationRole === null || reservationRole === "participant");
    if (!hasParticipantReservation) {
      return NextResponse.json(
        {
          error:
            "Reserve a spot first (reservations close 5 minutes before start).",
        },
        { status: 403 },
      );
    }
  }

  const now = new Date();
  const joinOpenAt = new Date(startsAt.getTime() - 10 * 60 * 1000);
  if (now < joinOpenAt) {
    return NextResponse.json(
      { error: "Join window has not opened yet" },
      { status: 403 },
    );
  }

  if (now > endsAt) {
    return NextResponse.json(
      { error: "Session has ended" },
      { status: 409 },
    );
  }

  const accessKey = process.env.HMS_APP_ACCESS_KEY;
  const secret = process.env.HMS_APP_SECRET;
  if (!accessKey || !secret) {
    return NextResponse.json(
      { error: "100ms credentials missing" },
      { status: 500 },
    );
  }

  let roomId = focusSession.room_id ?? null;
  if (!roomId) {
    const roomName = buildHmsRoomName("focus-session", focusSession.id);
    const managementToken = createHmsManagementToken(accessKey, secret);
    const templateId = process.env.HMS_TEMPLATE_ID;

    const createPayload: Record<string, unknown> = {
      name: roomName,
      description: "Focus session",
      region: "auto",
      size: focusSession.max_participants ?? 3,
    };
    if (templateId) createPayload.template_id = templateId;

    const response = await fetch("https://api.100ms.live/v2/rooms", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${managementToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(createPayload),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("[focus sessions] 100ms room create failed", detail);
      return NextResponse.json(
        { error: "Failed to create 100ms room" },
        { status: 502 },
      );
    }

    const created = (await response.json()) as { id?: string };
    if (!created?.id) {
      return NextResponse.json(
        { error: "100ms room creation failed" },
        { status: 502 },
      );
    }

    const { data: updated, error: updateError } = await sb
      .from("focus_sessions")
      .update({ room_id: created.id })
      .eq("id", sessionId)
      .is("room_id", null)
      .select("room_id")
      .maybeSingle();

    if (updateError) {
      console.error("[focus sessions] room update failed", updateError);
      return NextResponse.json(
        { error: "Failed to prepare session room" },
        { status: 500 },
      );
    }

    if (updated?.room_id) {
      roomId = updated.room_id;
    } else {
      const { data: existing, error: existingError } = await sb
        .from("focus_sessions")
        .select("room_id")
        .eq("id", sessionId)
        .maybeSingle();

      if (existingError || !existing?.room_id) {
        console.error("[focus sessions] room lookup failed", existingError);
        return NextResponse.json(
          { error: "Failed to prepare session room" },
          { status: 500 },
        );
      }

      roomId = existing.room_id;
    }
  }

  if (!roomId) {
    return NextResponse.json(
      { error: "Session room is missing" },
      { status: 500 },
    );
  }

  if (isHost) {
    const { error: hostRowError } = await sb
      .from("focus_session_participants")
      .upsert(
        { session_id: sessionId, user_id: user.id, role: "host" },
        { onConflict: "session_id,user_id" },
      );

    if (hostRowError) {
      console.error("[focus sessions] host participant upsert failed", hostRowError);
      return NextResponse.json(
        { error: "Failed to join session" },
        { status: 500 },
      );
    }
  }

  const hostRole = resolvePublishableRole(
    process.env.FOCUS_SESSION_HOST_HMS_ROLE,
    "host",
  );
  const participantRole = resolvePublishableRole(
    process.env.FOCUS_SESSION_PARTICIPANT_HMS_ROLE,
    "peer",
  );
  const role = isHost ? hostRole : participantRole;

  const token = createHmsAuthToken({
    accessKey,
    secret,
    roomId,
    userId: user.id,
    role,
  });

  return NextResponse.json({ token, role });
}
