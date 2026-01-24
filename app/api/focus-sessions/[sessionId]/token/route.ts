export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { createHmsAuthToken } from "@/lib/voice/hms";

type RouteContext = {
  params: { sessionId: string };
};

type FocusSessionRow = {
  id: string;
  hms_room_id: string;
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
  if (!focusSession.hms_room_id) {
    return NextResponse.json(
      { error: "Session room is missing" },
      { status: 500 },
    );
  }

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

  const { data: existingParticipant, error: participantError } = await sb
    .from("focus_session_participants")
    .select("id")
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (participantError) {
    console.error("[focus sessions] participant lookup failed", participantError);
    return NextResponse.json(
      { error: "Failed to join session" },
      { status: 500 },
    );
  }

  if (!existingParticipant) {
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

  const accessKey = process.env.HMS_APP_ACCESS_KEY;
  const secret = process.env.HMS_APP_SECRET;
  if (!accessKey || !secret) {
    return NextResponse.json(
      { error: "100ms credentials missing" },
      { status: 500 },
    );
  }

  const role = "peer";
  const token = createHmsAuthToken({
    accessKey,
    secret,
    roomId: focusSession.hms_room_id,
    userId: user.id,
    role,
  });

  return NextResponse.json({ token, role });
}
