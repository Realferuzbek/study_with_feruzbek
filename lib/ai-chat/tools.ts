import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { loadLatestLeaderboards } from "@/lib/leaderboard/loadLatest";
import { getTodayMotivationSnapshot } from "@/lib/motivation/today";

const TASHKENT_TZ = "Asia/Tashkent";
const DEFAULT_MAX_PARTICIPANTS = 3;

export type LiveSessionSummary = {
  startsAt: string;
  endsAt: string;
  title: string | null;
  topic: string | null;
  participantCount: number;
  maxParticipants: number;
};

export type LiveSessionsResult = {
  live: LiveSessionSummary[];
  upcoming: LiveSessionSummary[];
};

export type LeaderboardTopResult = {
  scope: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  entries: Array<{
    rank: number;
    username: string;
    minutes: number | null;
  }>;
};

export type TaskSummary = {
  title: string;
  status: string;
  dueDate: string | null;
  dueAt: string | null;
  dueStartDate: string | null;
  dueEndDate: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
};

export type TasksTodayResult = {
  date: string;
  tasks: TaskSummary[];
};

export type NextSessionResult = {
  startsAt: string;
  endsAt: string;
  title: string | null;
  topic: string | null;
  status: string | null;
};

export type StreakResult =
  | {
      available: true;
      current: number;
      longest: number;
      updatedAt: string | null;
    }
  | { available: false; message: string };

export type WeekSummaryResult = {
  rangeStart: string;
  rangeEnd: string;
  completedTasks: number;
  focusedMinutes: number | null;
  sessionsJoined: number;
  notes: string[];
};

export async function getTodaysMantra() {
  const snapshot = getTodayMotivationSnapshot();
  return {
    quote: snapshot.quote,
    index: snapshot.index,
    dateLabel: snapshot.dateLabel,
    dateISO: snapshot.dateISO,
  };
}

export async function getLiveSessionsPublic(): Promise<LiveSessionsResult> {
  const now = new Date();
  const nowMs = now.getTime();
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("focus_sessions")
    .select(
      "id, starts_at, ends_at, duration_minutes, status, title, task, max_participants",
    )
    .in("status", ["active", "scheduled"])
    .order("starts_at", { ascending: true })
    .limit(40);

  if (error) {
    console.error("[ai-chat] live sessions lookup failed", error);
    return { live: [], upcoming: [] };
  }

  const sessions = data ?? [];
  const sessionIds = sessions.map((row) => row.id);
  const participantCounts = new Map<string, number>();

  if (sessionIds.length) {
    const { data: participants, error: participantError } = await sb
      .from("focus_session_participants")
      .select("session_id")
      .in("session_id", sessionIds);

    if (!participantError) {
      participants?.forEach((row) => {
        const current = participantCounts.get(row.session_id) ?? 0;
        participantCounts.set(row.session_id, current + 1);
      });
    }
  }

  const live: LiveSessionSummary[] = [];
  const upcoming: LiveSessionSummary[] = [];

  sessions.forEach((row) => {
    const startsAt = new Date(row.starts_at);
    if (Number.isNaN(startsAt.valueOf())) return;
    const endsAt = row.ends_at
      ? new Date(row.ends_at)
      : new Date(
          startsAt.getTime() + Number(row.duration_minutes ?? 0) * 60_000,
        );
    if (Number.isNaN(endsAt.valueOf())) return;
    if (endsAt.getTime() < nowMs) return;

    const summary: LiveSessionSummary = {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      title: row.title ?? row.task ?? null,
      topic: row.task ?? null,
      participantCount: participantCounts.get(row.id) ?? 0,
      maxParticipants: row.max_participants ?? DEFAULT_MAX_PARTICIPANTS,
    };

    const isLive =
      row.status === "active" ||
      (startsAt.getTime() <= nowMs && endsAt.getTime() > nowMs);
    if (isLive) {
      live.push(summary);
    } else if (startsAt.getTime() > nowMs) {
      upcoming.push(summary);
    }
  });

  live.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  upcoming.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return { live, upcoming };
}

export async function getLeaderboardTopNowPublic(): Promise<LeaderboardTopResult> {
  try {
    const snapshots = await loadLatestLeaderboards();
    const preferredScopes = ["day", "week", "month"] as const;
    let selected =
      snapshots.day ?? snapshots.week ?? snapshots.month ?? null;
    if (!selected) {
      for (const scope of preferredScopes) {
        if (snapshots[scope]) {
          selected = snapshots[scope];
          break;
        }
      }
    }

    if (!selected) {
      return { scope: null, periodStart: null, periodEnd: null, entries: [] };
    }

    const sorted = [...(selected.entries ?? [])].sort(
      (a, b) => a.rank - b.rank,
    );
    const top = sorted.slice(0, 3).map((entry) => ({
      rank: entry.rank,
      username: entry.username,
      minutes: Number.isFinite(entry.minutes)
        ? Math.round(entry.minutes)
        : entry.minutes ?? null,
    }));

    return {
      scope: selected.scope ?? null,
      periodStart: selected.period_start ?? null,
      periodEnd: selected.period_end ?? null,
      entries: top,
    };
  } catch (error) {
    console.error("[ai-chat] leaderboard top lookup failed", error);
    return { scope: null, periodStart: null, periodEnd: null, entries: [] };
  }
}

export async function getMyTasksToday(
  userId: string,
): Promise<TasksTodayResult> {
  const dayStart = DateTime.now().setZone(TASHKENT_TZ).startOf("day");
  const dayEnd = dayStart.endOf("day");
  const dateKey = dayStart.toFormat("yyyy-LL-dd");
  const startIso = dayStart.toUTC().toISO();
  const endIso = dayEnd.toUTC().toISO();

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("task_items")
    .select(
      "title,status,due_date,due_at,due_start_date,due_end_date,scheduled_start,scheduled_end",
    )
    .eq("user_id", userId)
    .or(
      [
        `due_date.eq.${dateKey}`,
        `and(due_start_date.lte.${dateKey},due_end_date.gte.${dateKey})`,
        `and(due_start_date.eq.${dateKey},due_end_date.is.null)`,
        `and(due_end_date.eq.${dateKey},due_start_date.is.null)`,
        `and(due_at.gte.${startIso},due_at.lte.${endIso})`,
        `and(scheduled_start.gte.${startIso},scheduled_start.lte.${endIso})`,
      ].join(","),
    )
    .order("scheduled_start", { ascending: true, nullsFirst: false })
    .order("due_at", { ascending: true, nullsFirst: false });

  if (error) {
    console.error("[ai-chat] tasks today lookup failed", error);
    return { date: dateKey, tasks: [] };
  }

  const tasks = (data ?? []).map((row) => ({
    title: row.title,
    status: row.status ?? "planned",
    dueDate: row.due_date ?? null,
    dueAt: row.due_at ?? null,
    dueStartDate: row.due_start_date ?? null,
    dueEndDate: row.due_end_date ?? null,
    scheduledStart: row.scheduled_start ?? null,
    scheduledEnd: row.scheduled_end ?? null,
  }));

  return { date: dateKey, tasks };
}

export async function getMyNextBookedSession(
  userId: string,
): Promise<NextSessionResult | null> {
  const sb = supabaseAdmin();
  const nowIso = new Date().toISOString();

  const [{ data: created }, { data: participantRows }] = await Promise.all([
    sb
      .from("focus_sessions")
      .select(
        "id, starts_at, ends_at, duration_minutes, status, title, task",
      )
      .eq("creator_user_id", userId)
      .gte("starts_at", nowIso)
      .in("status", ["active", "scheduled"])
      .order("starts_at", { ascending: true })
      .limit(1),
    sb
      .from("focus_session_participants")
      .select("session_id")
      .eq("user_id", userId),
  ]);

  let participantSession: any = null;
  if (participantRows?.length) {
    const sessionIds = participantRows.map((row) => row.session_id);
    const { data: sessions } = await sb
      .from("focus_sessions")
      .select(
        "id, starts_at, ends_at, duration_minutes, status, title, task",
      )
      .in("id", sessionIds)
      .gte("starts_at", nowIso)
      .in("status", ["active", "scheduled"])
      .order("starts_at", { ascending: true })
      .limit(1);
    participantSession = sessions?.[0] ?? null;
  }

  const createdSession = created?.[0] ?? null;
  const nextSession = pickSoonestSession(createdSession, participantSession);
  if (!nextSession) return null;

  const startsAt = new Date(nextSession.starts_at);
  const endsAt = nextSession.ends_at
    ? new Date(nextSession.ends_at)
    : new Date(
        startsAt.getTime() +
          Number(nextSession.duration_minutes ?? 0) * 60_000,
      );
  if (Number.isNaN(startsAt.valueOf()) || Number.isNaN(endsAt.valueOf())) {
    return null;
  }

  return {
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    title: nextSession.title ?? nextSession.task ?? null,
    topic: nextSession.task ?? null,
    status: nextSession.status ?? null,
  };
}

export async function getMyStreak(userId: string): Promise<StreakResult> {
  const sb = supabaseAdmin();
  try {
    const { data, error } = await sb
      .from("streaks")
      .select("current_streak,longest_streak,updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return {
      available: true,
      current: Number(data?.current_streak ?? 0),
      longest: Number(data?.longest_streak ?? 0),
      updatedAt: data?.updated_at ?? null,
    };
  } catch (error) {
    console.warn("[ai-chat] streak lookup unavailable", error);
    return { available: false, message: "not available yet" };
  }
}

export async function getMyWeekSummary(
  userId: string,
): Promise<WeekSummaryResult> {
  const now = DateTime.now().setZone(TASHKENT_TZ);
  const rangeStart = now.minus({ days: 7 }).startOf("day");
  const rangeEnd = now.endOf("day");
  const startIso = rangeStart.toUTC().toISO();
  const endIso = rangeEnd.toUTC().toISO();

  const sb = supabaseAdmin();

  const [completedTasksCount, sessionsJoinedCount, focusMinutes] =
    await Promise.all([
      fetchCompletedTaskCount(sb, userId, startIso, endIso),
      fetchSessionsJoinedCount(sb, userId, startIso, endIso),
      fetchFocusMinutes(sb, userId, rangeStart.toMillis(), rangeEnd.toMillis()),
    ]);

  const notes = [
    `Completed tasks: ${completedTasksCount}`,
    focusMinutes === null
      ? "Focus time: not available yet"
      : `Focus time: ${focusMinutes} minutes`,
    `Sessions joined: ${sessionsJoinedCount}`,
  ];

  return {
    rangeStart: rangeStart.toFormat("yyyy-LL-dd"),
    rangeEnd: rangeEnd.toFormat("yyyy-LL-dd"),
    completedTasks: completedTasksCount,
    focusedMinutes: focusMinutes,
    sessionsJoined: sessionsJoinedCount,
    notes,
  };
}

async function fetchCompletedTaskCount(
  sb: ReturnType<typeof supabaseAdmin>,
  userId: string,
  startIso: string | null,
  endIso: string | null,
) {
  if (!startIso || !endIso) return 0;
  const { count, error } = await sb
    .from("task_items")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("completed_at", startIso)
    .lte("completed_at", endIso);
  if (error) {
    console.error("[ai-chat] completed task count failed", error);
    return 0;
  }
  return count ?? 0;
}

async function fetchSessionsJoinedCount(
  sb: ReturnType<typeof supabaseAdmin>,
  userId: string,
  startIso: string | null,
  endIso: string | null,
) {
  if (!startIso || !endIso) return 0;
  const { count, error } = await sb
    .from("focus_session_participants")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("joined_at", startIso)
    .lte("joined_at", endIso);
  if (error) {
    console.error("[ai-chat] sessions joined count failed", error);
    return 0;
  }
  return count ?? 0;
}

async function fetchFocusMinutes(
  sb: ReturnType<typeof supabaseAdmin>,
  userId: string,
  rangeStartMs: number,
  rangeEndMs: number,
): Promise<number | null> {
  try {
    const { data, error } = await sb
      .from("usage_sessions")
      .select("started_at,last_seen_at")
      .eq("user_id", userId)
      .gte("last_seen_at", new Date(rangeStartMs).toISOString())
      .lte("started_at", new Date(rangeEndMs).toISOString());
    if (error) throw error;

    let totalMinutes = 0;
    (data ?? []).forEach((row) => {
      const start = new Date(row.started_at).getTime();
      const end = new Date(row.last_seen_at).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
        return;
      const clampedStart = Math.max(start, rangeStartMs);
      const clampedEnd = Math.min(end, rangeEndMs);
      if (clampedEnd <= clampedStart) return;
      totalMinutes += (clampedEnd - clampedStart) / 60_000;
    });
    return Math.round(totalMinutes);
  } catch (error) {
    console.warn("[ai-chat] focus minutes unavailable", error);
    return null;
  }
}

function pickSoonestSession(a: any, b: any) {
  if (!a && !b) return null;
  if (a && !b) return a;
  if (b && !a) return b;
  const aStart = new Date(a.starts_at).getTime();
  const bStart = new Date(b.starts_at).getTime();
  if (!Number.isFinite(aStart)) return b;
  if (!Number.isFinite(bStart)) return a;
  return aStart <= bStart ? a : b;
}
