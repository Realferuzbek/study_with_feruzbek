export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

const MAX_PARTICIPANTS = 3;
const ALLOWED_STATUSES = ["scheduled", "active", "cancelled"] as const;

type HostProfile = {
  id: string;
  display_name?: string | null;
  name?: string | null;
};

function parseTimestamp(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return date;
}

function computeEndsAt(startsAt: Date, durationMinutes: number | null | undefined) {
  const duration = Number.isFinite(durationMinutes) ? Number(durationMinutes) : 0;
  return new Date(startsAt.getTime() + duration * 60_000);
}

function resolveHostDisplayName(profile: HostProfile | null) {
  const name = profile?.display_name ?? profile?.name ?? null;
  return name && name.trim().length > 0 ? name : "Focus Host";
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");
  const from = parseTimestamp(fromRaw);
  const to = parseTimestamp(toRaw);
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
      "id, host_id, start_at, end_at, duration_minutes, task, status, max_participants, room_id",
    )
    .gte("start_at", from.toISOString())
    .lte("start_at", to.toISOString())
    .in("status", [...ALLOWED_STATUSES])
    .order("start_at", { ascending: true });

  if (error) {
    console.error("[public sessions] list failed", error);
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
      console.error(
        "[public sessions] participant list failed",
        participantError,
      );
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
        .map((row) => row.host_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const hostMap = new Map<string, HostProfile>();

  if (hostIds.length > 0) {
    const { data: hosts, error: hostError } = await sb
      .from("users")
      .select("id, display_name, name")
      .in("id", hostIds);

    if (hostError) {
      console.error("[public sessions] host lookup failed", hostError);
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
      const startsAt = new Date(row.start_at);
      const endsAt = row.end_at
        ? new Date(row.end_at)
        : computeEndsAt(startsAt, row.duration_minutes);
      if (Number.isNaN(startsAt.valueOf()) || Number.isNaN(endsAt.valueOf())) {
        return null;
      }
      if (endsAt.getTime() < now.getTime()) {
        return null;
      }
      const hostProfile = hostMap.get(row.host_id) ?? null;
      return {
        id: row.id,
        session_id: row.id,
        start_at: startsAt.toISOString(),
        end_at: endsAt.toISOString(),
        task: row.task ?? "desk",
        status: row.status ?? "scheduled",
        max_participants: row.max_participants ?? MAX_PARTICIPANTS,
        participant_count: participantCounts.get(row.id) ?? 0,
        host_display_name: resolveHostDisplayName(hostProfile),
        room_id: row.room_id ?? null,
      };
    })
    .filter(
      (
        row,
      ): row is {
        id: string;
        session_id: string;
        start_at: string;
        end_at: string;
        task: string;
        status: string;
        max_participants: number;
        participant_count: number;
        host_display_name: string;
        room_id: string | null;
      } => Boolean(row),
    );

  const response = NextResponse.json({ sessions: payload });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
