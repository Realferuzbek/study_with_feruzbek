import { DateTime } from "luxon";

import { withCanonicalRanks } from "@/lib/leaderboard/entries";
import { getTodayMotivationSnapshot } from "@/lib/motivation/today";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { todayTashkent } from "@/lib/tz";
import type { LeaderboardEntry } from "@/types/leaderboard";

const TASHKENT_TZ = "Asia/Tashkent";
const JOIN_OPEN_MINUTES = 10;
const JOIN_CLOSE_MINUTES = 5;
const SESSION_SCAN_HOURS = 24;
const DEFAULT_HOST_NAME = "Focus Host";

export type TodaysMantraPublicResult = {
  dateLabel: string;
  quoteIndex: number;
  text: string;
};

export type LiveSessionPublic = {
  id: string;
  topic: string | null;
  mode: string | null;
  startsAt: string;
  endsAt: string;
  creatorDisplayName: string | null;
};

export type LiveSessionsPublicResult = {
  sessions: LiveSessionPublic[];
  error?: string;
};

export type LeaderboardTopNowResult = {
  available: boolean;
  date: string;
  scope: string;
  periodStart: string | null;
  periodEnd: string | null;
  entries: Array<{
    rank: number;
    username: string;
    minutes: number | null;
  }>;
  message?: string;
};

export type TaskSummary = {
  title: string;
  status: string;
  dueDate: string | null;
  dueAt: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  source: "scheduler" | "daily";
};

export type TasksTodayResult = {
  date: string;
  tasks: TaskSummary[];
};

export type NextSessionResult = {
  id: string;
  startsAt: string;
  endsAt: string;
  topic: string | null;
  mode: string | null;
};

export type StreakResult = {
  current: number;
  longest: number;
  updatedAt: string | null;
};

export type WeekSummaryResult = {
  rangeStart: string;
  rangeEnd: string;
  completedTasks: number;
  completedTaskItems: number;
  completedDailyTasks: number;
  sessionsJoined: number;
  focusedMinutes: number;
};

type HostProfile = {
  id: string;
  display_name?: string | null;
  name?: string | null;
};

type FocusSessionRow = {
  id: string;
  creator_user_id?: string | null;
  starts_at: string;
  ends_at?: string | null;
  duration_minutes?: number | null;
  status?: string | null;
  task?: string | null;
  title?: string | null;
};

export async function getTodaysMantraPublic(): Promise<TodaysMantraPublicResult> {
  const snapshot = getTodayMotivationSnapshot();
  return {
    dateLabel: snapshot.dateLabel,
    quoteIndex: snapshot.index + 1,
    text: snapshot.quote,
  };
}

export async function getLiveSessionsPublic(
  now: Date = new Date(),
): Promise<LiveSessionsPublicResult> {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  if (!Number.isFinite(nowMs)) {
    return { sessions: [], error: "invalid_time" };
  }

  const scanStart = new Date(nowMs - SESSION_SCAN_HOURS * 60 * 60 * 1000);
  const scanEnd = new Date(nowMs + SESSION_SCAN_HOURS * 60 * 60 * 1000);

  let data: unknown = null;
  let sb: ReturnType<typeof supabaseAdmin> | null = null;
  try {
    sb = supabaseAdmin();
    const response = await sb
      .from("focus_sessions")
      .select(
        "id, creator_user_id, starts_at, ends_at, duration_minutes, status, task, title",
      )
      .gte("starts_at", scanStart.toISOString())
      .lte("starts_at", scanEnd.toISOString())
      .in("status", ["scheduled", "active"])
      .order("starts_at", { ascending: true })
      .limit(80);
    data = response.data;
    if (response.error) {
      console.error("[ai-chat] live sessions lookup failed", response.error);
      return { sessions: [], error: "lookup_failed" };
    }
  } catch (error) {
    console.error("[ai-chat] live sessions lookup failed", error);
    return { sessions: [], error: "lookup_failed" };
  }

  const sessions = (data ?? []) as FocusSessionRow[];
  const hostIds = Array.from(
    new Set(
      sessions
        .map((row) => row.creator_user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const hostMap = new Map<string, HostProfile>();

  if (hostIds.length > 0 && sb) {
    const { data: hosts, error: hostError } = await sb
      .from("users")
      .select("id, display_name, name")
      .in("id", hostIds);
    if (hostError) {
      console.error("[ai-chat] host lookup failed", hostError);
    } else {
      (hosts ?? []).forEach((row) => {
        if (row?.id) hostMap.set(row.id, row);
      });
    }
  }

  const liveSessions: LiveSessionPublic[] = [];

  sessions.forEach((row) => {
    const startsAt = new Date(row.starts_at);
    if (Number.isNaN(startsAt.valueOf())) return;
    const endsAt = resolveEndsAt(startsAt, row.ends_at, row.duration_minutes);
    if (!endsAt) return;

    const joinOpenAt = new Date(
      startsAt.getTime() - JOIN_OPEN_MINUTES * 60 * 1000,
    );
    const joinCloseAt = new Date(
      endsAt.getTime() + JOIN_CLOSE_MINUTES * 60 * 1000,
    );

    if (nowDate < joinOpenAt || nowDate > joinCloseAt) return;

    const hostProfile = hostMap.get(row.creator_user_id ?? "") ?? null;
    liveSessions.push({
      id: row.id,
      topic: row.title ?? row.task ?? null,
      mode: row.task ?? null,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      creatorDisplayName: resolveHostDisplayName(hostProfile),
    });
  });

  liveSessions.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return { sessions: liveSessions };
}

export async function getLeaderboardTopNowPublic(): Promise<LeaderboardTopNowResult> {
  const date = todayTashkent();
  const sb = supabaseAdmin();

  try {
    const { data, error } = await sb
      .from("leaderboards")
      .select("scope, period_start, period_end, posted_at, entries")
      .eq("scope", "day")
      .lte("period_start", date)
      .gte("period_end", date)
      .order("posted_at", { ascending: false })
      .order("period_end", { ascending: false })
      .limit(1);

    if (error || !data?.length) {
      if (error) console.error("[ai-chat] leaderboard lookup failed", error);
      return {
        available: false,
        date,
        scope: "day",
        periodStart: null,
        periodEnd: null,
        entries: [],
        message: "not available yet",
      };
    }

    const row = data[0] as {
      scope: string | null;
      period_start: string | null;
      period_end: string | null;
      entries: LeaderboardEntry[] | null;
    };

    const entries = Array.isArray(row.entries)
      ? withCanonicalRanks(row.entries)
      : [];
    const top = entries.slice(0, 3).map((entry) => ({
      rank: entry.rank,
      username: entry.username,
      minutes: Number.isFinite(entry.minutes)
        ? Math.round(entry.minutes)
        : entry.minutes ?? null,
    }));

    if (!top.length) {
      return {
        available: false,
        date,
        scope: row.scope ?? "day",
        periodStart: row.period_start ?? null,
        periodEnd: row.period_end ?? null,
        entries: [],
        message: "not available yet",
      };
    }

    return {
      available: true,
      date,
      scope: row.scope ?? "day",
      periodStart: row.period_start ?? null,
      periodEnd: row.period_end ?? null,
      entries: top,
    };
  } catch (error) {
    console.error("[ai-chat] leaderboard top lookup failed", error);
    return {
      available: false,
      date,
      scope: "day",
      periodStart: null,
      periodEnd: null,
      entries: [],
      message: "not available yet",
    };
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
  const schedulerTasks = await fetchSchedulerTasks(
    sb,
    userId,
    dateKey,
    startIso,
    endIso,
  );
  const dailyTasks = await fetchLegacyDailyTasks(sb, userId, dateKey);

  return { date: dateKey, tasks: [...schedulerTasks, ...dailyTasks] };
}

export async function getMyNextBookedSession(
  userId: string,
  now: Date = new Date(),
): Promise<NextSessionResult | null> {
  const nowIso = now.toISOString();
  const sb = supabaseAdmin();

  try {
    const { data, error } = await sb
      .from("focus_session_participants")
      .select(
        "session_id, focus_sessions ( id, starts_at, ends_at, duration_minutes, status, task, title )",
      )
      .eq("user_id", userId)
      .gte("focus_sessions.starts_at", nowIso)
      .in("focus_sessions.status", ["scheduled", "active"])
      .order("focus_sessions.starts_at", { ascending: true })
      .limit(1);

    if (error) {
      console.error("[ai-chat] next session lookup failed", error);
      return null;
    }

    const row = data?.[0];
    const session = (row as any)?.focus_sessions as FocusSessionRow | null;
    if (!session) return null;

    const startsAt = new Date(session.starts_at);
    if (Number.isNaN(startsAt.valueOf())) return null;
    const endsAt = resolveEndsAt(
      startsAt,
      session.ends_at,
      session.duration_minutes,
    );
    if (!endsAt) return null;

    return {
      id: session.id,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      topic: session.title ?? session.task ?? null,
      mode: session.task ?? null,
    };
  } catch (error) {
    console.error("[ai-chat] next session lookup failed", error);
    return null;
  }
}

export async function getMyStreak(userId: string): Promise<StreakResult> {
  const sb = supabaseAdmin();
  try {
    const { data, error } = await sb
      .from("streaks")
      .select("current_streak,longest_streak,updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return {
      current: Number(data?.current_streak ?? 0),
      longest: Number(data?.longest_streak ?? 0),
      updatedAt: data?.updated_at ?? null,
    };
  } catch (error) {
    console.warn("[ai-chat] streak lookup failed", error);
    return { current: 0, longest: 0, updatedAt: null };
  }
}

export async function getMyWeekSummary(
  userId: string,
): Promise<WeekSummaryResult> {
  const now = DateTime.now().setZone(TASHKENT_TZ);
  const rangeStart = now.startOf("week");
  const rangeEnd = now.endOf("day");
  const startIso = rangeStart.toUTC().toISO();
  const endIso = rangeEnd.toUTC().toISO();
  const startDate = rangeStart.toISODate() ?? "";
  const endDate = rangeEnd.toISODate() ?? "";

  const sb = supabaseAdmin();

  const [taskItemCount, legacyTaskCount, sessionStats] = await Promise.all([
    fetchCompletedTaskItemCount(sb, userId, startIso, endIso),
    fetchLegacyCompletedTaskCount(sb, userId, startDate, endDate),
    fetchSessionStats(sb, userId, startIso, endIso),
  ]);

  return {
    rangeStart: startDate,
    rangeEnd: endDate,
    completedTasks: taskItemCount + legacyTaskCount,
    completedTaskItems: taskItemCount,
    completedDailyTasks: legacyTaskCount,
    sessionsJoined: sessionStats.sessionsJoined,
    focusedMinutes: sessionStats.focusedMinutes,
  };
}

async function fetchSchedulerTasks(
  sb: ReturnType<typeof supabaseAdmin>,
  userId: string,
  dateKey: string,
  startIso: string | null,
  endIso: string | null,
): Promise<TaskSummary[]> {
  if (!startIso || !endIso) return [];

  const { data, error } = await sb
    .from("task_items")
    .select(
      "title,status,due_date,due_at,scheduled_start,scheduled_end",
    )
    .eq("user_id", userId)
    .or(
      [
        `due_date.eq.${dateKey}`,
        `and(due_at.gte.${startIso},due_at.lte.${endIso})`,
        `and(scheduled_start.gte.${startIso},scheduled_start.lte.${endIso})`,
        "status.eq.in_progress",
      ].join(","),
    )
    .order("scheduled_start", { ascending: true, nullsFirst: false })
    .order("due_at", { ascending: true, nullsFirst: false });

  if (error) {
    console.error("[ai-chat] tasks today lookup failed", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    title: row.title ?? "Untitled task",
    status: row.status ?? "planned",
    dueDate: row.due_date ?? null,
    dueAt: row.due_at ?? null,
    scheduledStart: row.scheduled_start ?? null,
    scheduledEnd: row.scheduled_end ?? null,
    source: "scheduler" as const,
  }));
}

async function fetchLegacyDailyTasks(
  sb: ReturnType<typeof supabaseAdmin>,
  userId: string,
  dateKey: string,
): Promise<TaskSummary[]> {
  const { data, error } = await sb
    .from("tasks")
    .select("id, content, is_done, for_date")
    .eq("user_id", userId)
    .eq("for_date", dateKey);

  if (error) {
    console.error("[ai-chat] legacy tasks lookup failed", error);
    const fallback = await fetchLegacyTasksFallback(sb, userId, dateKey);
    return fallback;
  }

  return (data ?? []).map((row) => ({
    title: row.content ?? "Daily task",
    status: row.is_done ? "done" : "pending",
    dueDate: row.for_date ?? dateKey,
    dueAt: null,
    scheduledStart: null,
    scheduledEnd: null,
    source: "daily" as const,
  }));
}

async function fetchCompletedTaskItemCount(
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

async function fetchLegacyCompletedTaskCount(
  sb: ReturnType<typeof supabaseAdmin>,
  userId: string,
  startDate: string,
  endDate: string,
) {
  if (!startDate || !endDate) return 0;
  const { count, error } = await sb
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_done", true)
    .gte("for_date", startDate)
    .lte("for_date", endDate);
  if (error) {
    console.error("[ai-chat] legacy task count failed", error);
    return fetchLegacyCompletedTaskCountFallback(
      sb,
      userId,
      startDate,
      endDate,
    );
  }
  return count ?? 0;
}

async function fetchLegacyTasksFallback(
  sb: ReturnType<typeof supabaseAdmin>,
  userId: string,
  dateKey: string,
) {
  const { data, error } = await sb
    .from("tasks")
    .select("id, content, for_date")
    .eq("user_id", userId)
    .eq("for_date", dateKey);
  if (error) {
    console.error("[ai-chat] legacy tasks fallback failed", error);
    return [];
  }
  const taskIds = (data ?? []).map((row) => row.id).filter(Boolean);
  const reviewMap = await fetchTaskReviewStatusMap(sb, taskIds);
  return (data ?? []).map((row) => ({
    title: row.content ?? "Daily task",
    status: reviewMap.get(row.id) === "completed" ? "done" : "pending",
    dueDate: row.for_date ?? dateKey,
    dueAt: null,
    scheduledStart: null,
    scheduledEnd: null,
    source: "daily" as const,
  }));
}

async function fetchLegacyCompletedTaskCountFallback(
  sb: ReturnType<typeof supabaseAdmin>,
  userId: string,
  startDate: string,
  endDate: string,
) {
  const { data, error } = await sb
    .from("tasks")
    .select("id, for_date")
    .eq("user_id", userId)
    .gte("for_date", startDate)
    .lte("for_date", endDate);
  if (error) {
    console.error("[ai-chat] legacy task fallback failed", error);
    return 0;
  }
  const taskIds = (data ?? []).map((row) => row.id).filter(Boolean);
  if (!taskIds.length) return 0;
  const reviewMap = await fetchTaskReviewStatusMap(sb, taskIds);
  let count = 0;
  taskIds.forEach((id) => {
    if (reviewMap.get(id) === "completed") count += 1;
  });
  return count;
}

async function fetchTaskReviewStatusMap(
  sb: ReturnType<typeof supabaseAdmin>,
  taskIds: string[],
) {
  const map = new Map<string, string>();
  if (!taskIds.length) return map;
  const { data, error } = await sb
    .from("task_reviews")
    .select("task_id, status")
    .in("task_id", taskIds);
  if (error) {
    console.error("[ai-chat] task review lookup failed", error);
    return map;
  }
  (data ?? []).forEach((row) => {
    if (row?.task_id) {
      map.set(row.task_id, row.status ?? "");
    }
  });
  return map;
}

async function fetchSessionStats(
  sb: ReturnType<typeof supabaseAdmin>,
  userId: string,
  startIso: string | null,
  endIso: string | null,
): Promise<{ sessionsJoined: number; focusedMinutes: number }> {
  if (!startIso || !endIso) return { sessionsJoined: 0, focusedMinutes: 0 };

  const { data, error } = await sb
    .from("focus_session_participants")
    .select(
      "session_id, focus_sessions ( starts_at, ends_at, duration_minutes, status )",
    )
    .eq("user_id", userId)
    .gte("focus_sessions.starts_at", startIso)
    .lte("focus_sessions.starts_at", endIso);

  if (error) {
    console.error("[ai-chat] weekly sessions lookup failed", error);
    return { sessionsJoined: 0, focusedMinutes: 0 };
  }

  let sessionsJoined = 0;
  let focusedMinutes = 0;

  (data ?? []).forEach((row) => {
    const session = (row as any)?.focus_sessions as FocusSessionRow | null;
    if (!session) return;
    if (session.status === "cancelled") return;
    sessionsJoined += 1;
    const duration = Number(session.duration_minutes ?? 0);
    if (Number.isFinite(duration) && duration > 0) {
      focusedMinutes += duration;
      return;
    }
    const startsAt = new Date(session.starts_at);
    const endsAt = session.ends_at ? new Date(session.ends_at) : null;
    if (endsAt && !Number.isNaN(startsAt.valueOf()) && !Number.isNaN(endsAt.valueOf())) {
      const diff = (endsAt.getTime() - startsAt.getTime()) / 60_000;
      if (diff > 0) focusedMinutes += diff;
    }
  });

  return { sessionsJoined, focusedMinutes: Math.round(focusedMinutes) };
}

function resolveHostDisplayName(profile: HostProfile | null) {
  const name = profile?.display_name ?? profile?.name ?? null;
  return name && name.trim().length > 0 ? name : DEFAULT_HOST_NAME;
}

function resolveEndsAt(
  startsAt: Date,
  endsAtRaw?: string | null,
  durationMinutes?: number | null,
) {
  if (endsAtRaw) {
    const parsed = new Date(endsAtRaw);
    if (!Number.isNaN(parsed.valueOf())) return parsed;
  }
  const duration = Number.isFinite(durationMinutes)
    ? Number(durationMinutes)
    : null;
  if (!duration || duration <= 0) return null;
  return new Date(startsAt.getTime() + duration * 60_000);
}
