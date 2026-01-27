type Bucket = {
  ts: number;
  count: number;
  expiresAt: number;
};

type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
const PRUNE_INTERVAL_MS = 60_000;
const MAX_BUCKETS = 5_000;
let lastPruneAt = 0;

function pruneExpired(now: number) {
  if (now - lastPruneAt < PRUNE_INTERVAL_MS && buckets.size < MAX_BUCKETS) {
    return;
  }
  lastPruneAt = now;
  for (const [key, bucket] of buckets) {
    if (bucket.expiresAt <= now) {
      buckets.delete(key);
    }
  }
}

export function rateLimit(
  key: string,
  max = 30,
  perMs = 60_000,
): RateLimitResult {
  const now = Date.now();
  pruneExpired(now);
  const item = buckets.get(key);
  if (!item || item.expiresAt <= now) {
    const resetAt = now + perMs;
    buckets.set(key, { ts: now, count: 1, expiresAt: resetAt });
    return { ok: true, remaining: Math.max(0, max - 1), resetAt };
  }
  item.count++;
  const remaining = Math.max(0, max - item.count);
  return {
    ok: item.count <= max,
    remaining,
    resetAt: item.expiresAt,
  };
}
