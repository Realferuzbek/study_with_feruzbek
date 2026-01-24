export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { createHmsAuthToken, getDefaultHmsRole } from "@/lib/voice/hms";

type TokenRequest = {
  roomId?: string;
};

type RoomRow = {
  id: string;
  created_by: string;
  visibility: "public" | "unlisted";
  status: "active" | "ended";
  hms_room_id: string;
};

export async function POST(req: NextRequest) {
  const session = await auth();
  const user = session?.user as { id?: string; is_admin?: boolean } | undefined;
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: TokenRequest = {};
  try {
    payload = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const roomId = typeof payload.roomId === "string" ? payload.roomId : "";
  if (!roomId) {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("live_voice_rooms")
    .select("id, created_by, visibility, status, hms_room_id")
    .eq("id", roomId)
    .maybeSingle();

  if (error) {
    console.error("[voice rooms] token room lookup failed", error);
    return NextResponse.json(
      { error: "Failed to load room" },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const room = data as RoomRow;
  if (room.status !== "active") {
    return NextResponse.json(
      { error: "Room is no longer active" },
      { status: 410 },
    );
  }

  const isAdmin = user.is_admin === true;
  if (!isAdmin && room.created_by !== user.id) {
    const visible = room.visibility === "public" || room.visibility === "unlisted";
    if (!visible) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const role = getDefaultHmsRole();

  const accessKey = process.env.HMS_APP_ACCESS_KEY;
  const secret = process.env.HMS_APP_SECRET;
  if (!accessKey || !secret) {
    return NextResponse.json(
      { error: "100ms credentials missing" },
      { status: 500 },
    );
  }

  const token = createHmsAuthToken({
    accessKey,
    secret,
    roomId: room.hms_room_id,
    userId: user.id,
    role,
  });

  return NextResponse.json({ token, role });
}
