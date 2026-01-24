export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseServer";
import {
  buildHmsRoomName,
  createHmsAuthToken,
  createHmsManagementToken,
  getDefaultHmsRole,
} from "@/lib/voice/hms";

type RouteContext = {
  params: { sessionId: string };
};

type FocusSessionRow = {
  id: string;
  hms_room_id?: string | null;
  starts_at: string;
  ends_at?: string | null;
  duration_minutes?: number | null;
  status?: string | null;
  max_participants?: number | null;
  creator_user_id?: string | null;
};

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
      "id, hms_room_id, starts_at, ends_at, duration_minutes, status, max_participants, creator_user_id",
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

  const startsAt = new Date(focusSession.starts_at);
  const endsAt = focusSession.ends_at
    ? new Date(focusSession.ends_at)
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

  const status = focusSession.status ?? "scheduled";
  if (status === "cancelled" || status === "completed") {
    return NextResponse.json(
      { error: "Session is not available" },
      { status: 409 },
    );
  }

  const now = new Date();
  const joinOpenAt = new Date(startsAt.getTime() - 10 * 60 * 1000);
  const joinCloseAt = new Date(endsAt.getTime() + 5 * 60 * 1000);

  if (now < joinOpenAt) {
    return NextResponse.json(
      { error: "Join window has not opened yet" },
      { status: 403 },
    );
  }

  if (now > joinCloseAt) {
    return NextResponse.json(
      { error: "Session has ended" },
      { status: 409 },
    );
  }

  const overlapFilter = {
    start: startsAt.toISOString(),
    end: endsAt.toISOString(),
  };
  const nowIso = now.toISOString();

  const { data: hostActive, error: hostActiveError } = await sb
    .from("focus_sessions")
    .select("id")
    .eq("creator_user_id", user.id)
    .neq("id", sessionId)
    .lte("starts_at", nowIso)
    .gt("ends_at", nowIso)
    .in("status", ["scheduled", "active"])
    .limit(1);

  if (hostActiveError) {
    console.error("[focus sessions] active check failed", hostActiveError);
    return NextResponse.json(
      { error: "Failed to validate session" },
      { status: 500 },
    );
  }

  if ((hostActive ?? []).length > 0) {
    return NextResponse.json(
      { error: "You already have an active session." },
      { status: 409 },
    );
  }

  const { data: hostOverlap, error: hostOverlapError } = await sb
    .from("focus_sessions")
    .select("id")
    .eq("creator_user_id", user.id)
    .neq("id", sessionId)
    .lt("starts_at", overlapFilter.end)
    .gt("ends_at", overlapFilter.start)
    .in("status", ["scheduled", "active"])
    .limit(1);

  if (hostOverlapError) {
    console.error("[focus sessions] overlap check failed", hostOverlapError);
    return NextResponse.json(
      { error: "Failed to validate session" },
      { status: 500 },
    );
  }

  if ((hostOverlap ?? []).length > 0) {
    return NextResponse.json(
      { error: "You already have another session at this time." },
      { status: 409 },
    );
  }

  const { data: participantRows, error: participantLookupError } = await sb
    .from("focus_session_participants")
    .select("session_id")
    .eq("user_id", user.id);

  if (participantLookupError) {
    console.error("[focus sessions] participant lookup failed", participantLookupError);
    return NextResponse.json(
      { error: "Failed to validate session" },
      { status: 500 },
    );
  }

  const participantSessionIds =
    participantRows?.map((row) => row.session_id) ?? [];
  const isAlreadyParticipant = participantSessionIds.includes(sessionId);
  const otherParticipantIds = participantSessionIds.filter(
    (id) => id !== sessionId,
  );

  if (otherParticipantIds.length > 0) {
    const { data: participantActive, error: participantActiveError } = await sb
      .from("focus_sessions")
      .select("id")
      .in("id", otherParticipantIds)
      .lte("starts_at", nowIso)
      .gt("ends_at", nowIso)
      .in("status", ["scheduled", "active"])
      .limit(1);

    if (participantActiveError) {
      console.error(
        "[focus sessions] participant active check failed",
        participantActiveError,
      );
      return NextResponse.json(
        { error: "Failed to validate session" },
        { status: 500 },
      );
    }

    if ((participantActive ?? []).length > 0) {
      return NextResponse.json(
        { error: "You already have an active session." },
        { status: 409 },
      );
    }

    const { data: participantOverlap, error: participantOverlapError } = await sb
      .from("focus_sessions")
      .select("id")
      .in("id", otherParticipantIds)
      .lt("starts_at", overlapFilter.end)
      .gt("ends_at", overlapFilter.start)
      .in("status", ["scheduled", "active"])
      .limit(1);

    if (participantOverlapError) {
      console.error(
        "[focus sessions] participant overlap failed",
        participantOverlapError,
      );
      return NextResponse.json(
        { error: "Failed to validate session" },
        { status: 500 },
      );
    }

    if ((participantOverlap ?? []).length > 0) {
      return NextResponse.json(
        { error: "You already have another session at this time." },
        { status: 409 },
      );
    }
  }

  const accessKey = process.env.HMS_APP_ACCESS_KEY;
  const secret = process.env.HMS_APP_SECRET;
  if (!accessKey || !secret) {
    return NextResponse.json(
      { error: "100ms credentials missing" },
      { status: 500 },
    );
  }

  let roomId = focusSession.hms_room_id ?? null;

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
      .update({ hms_room_id: created.id })
      .eq("id", sessionId)
      .is("hms_room_id", null)
      .select("hms_room_id")
      .maybeSingle();

    if (updateError) {
      console.error("[focus sessions] room update failed", updateError);
      return NextResponse.json(
        { error: "Failed to prepare session room" },
        { status: 500 },
      );
    }

    if (updated?.hms_room_id) {
      roomId = updated.hms_room_id;
    } else {
      const { data: existing, error: existingError } = await sb
        .from("focus_sessions")
        .select("hms_room_id")
        .eq("id", sessionId)
        .maybeSingle();

      if (existingError || !existing?.hms_room_id) {
        console.error("[focus sessions] room lookup failed", existingError);
        return NextResponse.json(
          { error: "Failed to prepare session room" },
          { status: 500 },
        );
      }

      roomId = existing.hms_room_id;
    }
  }

  if (!roomId) {
    return NextResponse.json(
      { error: "Session room is missing" },
      { status: 500 },
    );
  }

  if (!isAlreadyParticipant) {
    const maxParticipants = focusSession.max_participants ?? 3;
    const { count, error: countError } = await sb
      .from("focus_session_participants")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId);

    if (countError) {
      console.error("[focus sessions] participant count failed", countError);
      return NextResponse.json(
        { error: "Failed to join session" },
        { status: 500 },
      );
    }

    if ((count ?? 0) >= maxParticipants) {
      return NextResponse.json(
        { error: "Session is full" },
        { status: 409 },
      );
    }

    const { error: insertError } = await sb
      .from("focus_session_participants")
      .upsert(
        { session_id: sessionId, user_id: user.id },
        { onConflict: "session_id,user_id" },
      );

    if (insertError) {
      console.error("[focus sessions] participant insert failed", insertError);
      return NextResponse.json(
        { error: "Failed to join session" },
        { status: 500 },
      );
    }
  }

  const role = getDefaultHmsRole();
  const token = createHmsAuthToken({
    accessKey,
    secret,
    roomId,
    userId: user.id,
    role,
  });

  return NextResponse.json({ token, role });
}
