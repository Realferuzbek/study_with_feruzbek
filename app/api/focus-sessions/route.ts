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
  task?: string;
  title?: string;
};

const ALLOWED_DURATIONS = new Set([30, 60, 120]);
const ALLOWED_TASKS = new Set(["desk", "moving", "anything"]);
const MAX_PARTICIPANTS = 3;
const DEFAULT_TITLE = "Focus Session";

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

function parseTask(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!ALLOWED_TASKS.has(normalized)) return null;
  return normalized;
}

function parseTitle(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 140) : null;
}

function isStartAtLeastOneMinuteFromNow(startsAt: Date) {
  return startsAt.getTime() >= Date.now() + 60_000;
}

function computeEndsAt(startsAt: Date, durationMinutes: number) {
  return new Date(startsAt.getTime() + durationMinutes * 60_000);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  const user = session?.user as { id?: string } | undefined;
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");
  const from = parseStartsAt(fromRaw);
  const to = parseStartsAt(toRaw);
  if (!from || !to) {
    return NextResponse.json(
      { error: "from and to are required" },
      { status: 400 },
    );
  }
  if (from.getTime() > to.getTime()) {
    return NextResponse.json(
      { error: "from must be before to" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("focus_sessions")
    .select(
      "id, creator_user_id, starts_at, ends_at, duration_minutes, task, status, max_participants, hms_room_id",
    )
    .gte("starts_at", from.toISOString())
    .lte("starts_at", to.toISOString())
    .in("status", ["scheduled", "active", "cancelled"])
    .order("starts_at", { ascending: true });

  if (error) {
    console.error("[focus sessions] list failed", error);
    return NextResponse.json(
      { error: "Failed to load sessions" },
      { status: 500 },
    );
  }

  const sessions = data ?? [];
  const sessionIds = sessions.map((row) => row.id);
  const participantCounts = new Map<string, number>();

  if (sessionIds.length > 0) {
    const { data: participants, error: participantError } = await sb
      .from("focus_session_participants")
      .select("session_id")
      .in("session_id", sessionIds);

    if (participantError) {
      console.error("[focus sessions] participant list failed", participantError);
      return NextResponse.json(
        { error: "Failed to load sessions" },
        { status: 500 },
      );
    }

    participants?.forEach((row) => {
      const current = participantCounts.get(row.session_id) ?? 0;
      participantCounts.set(row.session_id, current + 1);
    });
  }

  const hostIds = Array.from(
    new Set(
      sessions
        .map((row) => row.creator_user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const hostMap = new Map<string, { id: string; display_name?: string | null; name?: string | null }>();

  if (hostIds.length > 0) {
    const { data: hosts, error: hostError } = await sb
      .from("users")
      .select("id, display_name, name")
      .in("id", hostIds);

    if (hostError) {
      console.error("[focus sessions] host lookup failed", hostError);
      return NextResponse.json(
        { error: "Failed to load sessions" },
        { status: 500 },
      );
    }

    (hosts ?? []).forEach((row) => {
      if (row?.id) {
        hostMap.set(row.id, row);
      }
    });
  }

  const now = new Date();
  const payload = sessions
    .map((row) => {
      const startsAt = new Date(row.starts_at);
      const endsAt = row.ends_at
        ? new Date(row.ends_at)
        : computeEndsAt(
            startsAt,
            Number.isFinite(row.duration_minutes)
              ? Number(row.duration_minutes)
              : 0,
          );
      if (Number.isNaN(startsAt.valueOf()) || Number.isNaN(endsAt.valueOf())) {
        return null;
      }
      if (endsAt.getTime() < now.getTime()) {
        return null;
      }
      const hostProfile = hostMap.get(row.creator_user_id ?? "") ?? null;
      const hostDisplayName =
        hostProfile?.display_name ?? hostProfile?.name ?? "Focus Host";
      return {
        id: row.id,
        task: row.task ?? "desk",
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        status: row.status ?? "scheduled",
        host_id: row.creator_user_id,
        host_display_name: hostDisplayName,
        participant_count: participantCounts.get(row.id) ?? 0,
        max_participants: row.max_participants ?? MAX_PARTICIPANTS,
        room_id: row.hms_room_id ?? null,
      };
    })
    .filter(
      (row): row is {
        id: string;
        task: string;
        starts_at: string;
        ends_at: string;
        status: string;
        host_id: string;
        host_display_name: string;
        participant_count: number;
        max_participants: number;
        room_id: string | null;
      } => Boolean(row),
    );

  const response = NextResponse.json({ sessions: payload });
  response.headers.set("Cache-Control", "no-store");
  return response;
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

  if (!isStartAtLeastOneMinuteFromNow(startsAt)) {
    return NextResponse.json(
      { error: "starts_at must be at least 1 minute in the future" },
      { status: 400 },
    );
  }

  const durationMinutes = parseDurationMinutes(
    payload.duration_minutes ?? payload.durationMinutes,
  );
  if (!durationMinutes || !ALLOWED_DURATIONS.has(durationMinutes)) {
    return NextResponse.json(
      { error: "duration_minutes must be 30, 60, or 120" },
      { status: 400 },
    );
  }

  const endsAt = computeEndsAt(startsAt, durationMinutes);
  const task = parseTask(payload.task) ?? "desk";
  const title = parseTitle(payload.title) ?? DEFAULT_TITLE;

  const sb = supabaseAdmin();

  const overlapFilter = {
    start: startsAt.toISOString(),
    end: endsAt.toISOString(),
  };

  const { data: hostOverlap, error: hostOverlapError } = await sb
    .from("focus_sessions")
    .select("id")
    .eq("creator_user_id", user.id)
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
      { error: "You already have a session booked." },
      { status: 409 },
    );
  }

  const { data: participantRows, error: participantLookupError } = await sb
    .from("focus_session_participants")
    .select("session_id")
    .eq("user_id", user.id);

  if (participantLookupError) {
    console.error(
      "[focus sessions] participant lookup failed",
      participantLookupError,
    );
    return NextResponse.json(
      { error: "Failed to validate session" },
      { status: 500 },
    );
  }

  const participantSessionIds =
    participantRows?.map((row) => row.session_id) ?? [];

  if (participantSessionIds.length > 0) {
    const { data: participantOverlap, error: participantOverlapError } = await sb
      .from("focus_sessions")
      .select("id")
      .in("id", participantSessionIds)
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
        { error: "You already have a session booked." },
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

  const { data: inserted, error } = await sb
    .from("focus_sessions")
    .insert({
      creator_user_id: user.id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      duration_minutes: durationMinutes,
      hms_room_id: created.id,
      task,
      title,
      status: "scheduled",
      max_participants: MAX_PARTICIPANTS,
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

  const { error: participantError } = await sb
    .from("focus_session_participants")
    .upsert(
      { session_id: inserted.id, user_id: user.id },
      { onConflict: "session_id,user_id" },
    );

  if (participantError) {
    console.error("[focus sessions] host insert failed", participantError);
    await sb.from("focus_sessions").delete().eq("id", inserted.id);
    return NextResponse.json(
      { error: "Failed to store session" },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: inserted.id });
}
