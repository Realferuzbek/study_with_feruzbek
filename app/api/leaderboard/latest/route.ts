export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { loadLatestLeaderboards } from "@/lib/leaderboard/loadLatest";
import { rateLimit } from "@/lib/rateLimit";

const DEFAULT_RATE_LIMIT_MAX = 120;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

function readPositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed > 0 ? Math.floor(parsed) : fallback;
}

function getClientIp(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return realIp?.trim() || "anon";
}

export async function GET(req: NextRequest) {
  const rateLimitMax = readPositiveInt(
    process.env.LEADERBOARD_PUBLIC_RPM,
    DEFAULT_RATE_LIMIT_MAX,
  );
  const rateLimitWindowMs = readPositiveInt(
    process.env.LEADERBOARD_PUBLIC_WINDOW_MS,
    DEFAULT_RATE_LIMIT_WINDOW_MS,
  );
  const throttle = rateLimit(
    `leaderboard-latest:${getClientIp(req)}`,
    rateLimitMax,
    rateLimitWindowMs,
  );
  if (!throttle.ok) {
    const retryAfter = Math.max(
      1,
      Math.ceil((throttle.resetAt - Date.now()) / 1000),
    );
    return NextResponse.json(
      { error: "Too many requests. Try again soon." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  try {
    const latest = await loadLatestLeaderboards();
    return NextResponse.json({ data: latest });
  } catch (error) {
    console.error("leaderboard latest: failed to load snapshots", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
