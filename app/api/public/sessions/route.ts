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
      "id, creator_user_id, starts_at, ends_at, duration_minutes, task, status, max_participants, hms_room_id",
    )
    .gte("starts_at", from.toISOString())
    .lte("starts_at", to.toISOString())
    .in("status", [...ALLOWED_STATUSES])
    .order("starts_at", { ascending: true });

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
        .map((row) => row.creator_user_id)
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
      const startsAt = new Date(row.starts_at);
      const endsAt = row.ends_at
        ? new Date(row.ends_at)
        : computeEndsAt(startsAt, row.duration_minutes);
      if (Number.isNaN(startsAt.valueOf()) || Number.isNaN(endsAt.valueOf())) {
        return null;
      }
      if (endsAt.getTime() < now.getTime()) {
        return null;
      }
      const hostProfile = hostMap.get(row.creator_user_id) ?? null;
      return {
        id: row.id,
        session_id: row.id,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        task: row.task ?? "desk",
        status: row.status ?? "scheduled",
        max_participants: row.max_participants ?? MAX_PARTICIPANTS,
        participant_count: participantCounts.get(row.id) ?? 0,
        host_display_name: resolveHostDisplayName(hostProfile),
        room_id: row.hms_room_id ?? null,
      };
    })
    .filter(
      (
        row,
      ): row is {
        id: string;
        session_id: string;
        starts_at: string;
        ends_at: string;
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
