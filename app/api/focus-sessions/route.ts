export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { buildHmsRoomName, createHmsManagementToken } from "@/lib/voice/hms";

type CreateFocusSessionPayload = {
  starts_at?: string;
  startsAt?: string;
  duration_minutes?: number;
  durationMinutes?: number;
};

function parseStartsAt(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return date;
}

function parseDurationMinutes(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const duration = Math.floor(value);
    return duration > 0 ? duration : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    const duration = Math.floor(parsed);
    return duration > 0 ? duration : null;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const user = session?.user as { id?: string } | undefined;
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: CreateFocusSessionPayload = {};
  try {
    payload = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const startsAt = parseStartsAt(payload.starts_at ?? payload.startsAt);
  if (!startsAt) {
    return NextResponse.json(
      { error: "starts_at is required" },
      { status: 400 },
    );
  }

  const durationMinutes = parseDurationMinutes(
    payload.duration_minutes ?? payload.durationMinutes,
  );
  if (!durationMinutes) {
    return NextResponse.json(
      { error: "duration_minutes is required" },
      { status: 400 },
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

  const roomName = buildHmsRoomName("focus-session", user.id);
  const managementToken = createHmsManagementToken(accessKey, secret);
  const templateId = process.env.HMS_TEMPLATE_ID;

  const createPayload: Record<string, unknown> = {
    name: roomName,
    description: "Focus session",
    region: "auto",
    size: 3,
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

  const sb = supabaseAdmin();
  const { data: inserted, error } = await sb
    .from("focus_sessions")
    .insert({
      creator_user_id: user.id,
      starts_at: startsAt.toISOString(),
      duration_minutes: durationMinutes,
      hms_room_id: created.id,
    })
    .select("id")
    .single();

  if (error || !inserted?.id) {
    console.error("[focus sessions] insert failed", error);
    return NextResponse.json(
      { error: "Failed to store session" },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: inserted.id });
}
