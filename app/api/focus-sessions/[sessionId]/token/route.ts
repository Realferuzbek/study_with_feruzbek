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
    .select("id, hms_room_id")
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

    if ((count ?? 0) >= 3) {
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
