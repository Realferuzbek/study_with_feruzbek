import { NextRequest, NextResponse } from "next/server";
import { getPublicAiChatEnabled, isAiChatEnabled } from "@/lib/featureFlags";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { reindexSite } from "@/lib/rag/crawl";
import {
  buildErrorMessage,
  getMemoryReindexState,
  isReindexSchemaMismatch,
  releaseMemoryLock,
  tryAcquireMemoryLock,
  truncateErrorMessage,
  updateMemoryReindexState,
  type ReindexMode,
} from "@/lib/rag/reindexState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REINDEX_STATE_TABLE = "rag_reindex_state";
const REINDEX_ROW_ID = 1;
const REINDEX_LOCK_TTL_MS = 10 * 60 * 1000;
const REINDEX_COOLDOWN_MS = 10 * 60 * 1000;
const FALLBACK_DEPLOY_ID =
  process.env.DEPLOY_ID_FALLBACK ?? new Date().toISOString();

type AfterFn = (callback: () => void) => void;
let cachedAfter: AfterFn | null | undefined;

export async function GET(_req: NextRequest) {
  let enabled = false;
  let status: "online" | "disabled" | "error" = "disabled";
  let errorMessage: string | null = null;

  try {
    const publicEnabled = await getPublicAiChatEnabled();
    const fallbackEnabled = await isAiChatEnabled(false, { cache: false });
    enabled =
      typeof publicEnabled === "boolean" ? publicEnabled : fallbackEnabled;
    status = enabled ? "online" : "disabled";
  } catch (error) {
    console.error("[api/chat/status] failed to load availability", error);
    enabled = false;
    status = "error";
    errorMessage = "Unable to determine assistant status.";
  }

  const indexing = await getIndexingStatus();
  scheduleDeployReindex();

  return NextResponse.json(
    {
      live: enabled,
      enabled,
      status,
      indexing,
      ...(errorMessage ? { error: errorMessage } : {}),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function getIndexingStatus(): Promise<{
  mode: ReindexMode;
  lastError?: string;
  lastReindexedAt?: string | null;
}> {
  const memory = getMemoryReindexState();
  const resolvedUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !resolvedUrl) {
    return {
      mode: "disabled",
      lastError: memory.lastError
        ? truncateErrorMessage(memory.lastError)
        : undefined,
      lastReindexedAt: memory.lastReindexedAt ?? null,
    };
  }

  let sb: ReturnType<typeof supabaseAdmin> | null = null;
  try {
    sb = supabaseAdmin();
  } catch (error) {
    return {
      mode: "disabled",
      lastError: truncateErrorMessage(buildErrorMessage(error)),
      lastReindexedAt: memory.lastReindexedAt ?? null,
    };
  }

  const { data, error } = await sb
    .from(REINDEX_STATE_TABLE)
    .select("id, last_reindexed_at, last_error")
    .eq("id", REINDEX_ROW_ID)
    .limit(1);

  if (error) {
    const message = buildErrorMessage(error);
    if (isReindexSchemaMismatch(error)) {
      updateMemoryReindexState({ lastError: message });
      return {
        mode: "memory",
        lastError: truncateErrorMessage(message),
        lastReindexedAt: memory.lastReindexedAt ?? null,
      };
    }
    return {
      mode: "supabase",
      lastError: truncateErrorMessage(message),
      lastReindexedAt: null,
    };
  }

  const current = Array.isArray(data) ? data[0] : data;
  const lastError =
    typeof current?.last_error === "string" && current.last_error.trim()
      ? truncateErrorMessage(current.last_error)
      : undefined;

  return {
    mode: "supabase",
    lastError,
    lastReindexedAt: current?.last_reindexed_at ?? null,
  };
}

function scheduleDeployReindex() {
  const runner = () =>
    triggerDeployReindex().catch((error) =>
      console.error("[reindex] deploy trigger failed", error),
    );
  void resolveAfter().then((afterFn) => {
    if (afterFn) {
      afterFn(() => {
        void runner();
      });
      return;
    }
    if (typeof queueMicrotask === "function") {
      queueMicrotask(() => {
        void runner();
      });
      return;
    }
    setTimeout(() => {
      void runner();
    }, 0);
  });
}

async function triggerDeployReindex() {
  const resolvedUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !resolvedUrl) {
    return;
  }

  const deployId = resolveDeployId();
  const now = new Date();
  const nowIso = now.toISOString();
  const lockUntil = new Date(now.getTime() + REINDEX_LOCK_TTL_MS).toISOString();

  let sb: ReturnType<typeof supabaseAdmin> | null = null;
  try {
    sb = supabaseAdmin();
  } catch (error) {
    console.warn("[reindex] supabase client unavailable, using memory lock");
    updateMemoryReindexState({ lastError: buildErrorMessage(error) });
    await runMemoryReindex(deployId);
    return;
  }

  const { data: row, error } = await sb
    .from(REINDEX_STATE_TABLE)
    .select("id, last_deploy_id, in_progress, lock_until")
    .eq("id", REINDEX_ROW_ID)
    .limit(1);
  if (error) {
    if (isReindexSchemaMismatch(error)) {
      console.warn("[reindex] deploy lock schema mismatch, using memory lock");
      updateMemoryReindexState({ lastError: buildErrorMessage(error) });
      await runMemoryReindex(deployId);
      return;
    }
    console.warn("[reindex] failed to load deploy state", error);
    return;
  }

  const current = Array.isArray(row) ? row[0] : row;
  const lockExpired = current?.lock_until
    ? Date.parse(current.lock_until) <= now.getTime()
    : true;

  if (current?.last_deploy_id === deployId && !current?.in_progress) {
    return;
  }

  if (current?.in_progress && !lockExpired) {
    return;
  }

  let locked = false;
  if (current) {
    const { data: updated, error: updateError } = await sb
      .from(REINDEX_STATE_TABLE)
      .update({
        last_deploy_id: deployId,
        in_progress: true,
        lock_until: lockUntil,
        last_error: null,
        updated_at: nowIso,
      })
      .eq("id", REINDEX_ROW_ID)
      .or(
        `in_progress.is.null,in_progress.eq.false,lock_until.is.null,lock_until.lt.${nowIso}`,
      )
      .select("id");
    if (updateError) {
      if (isReindexSchemaMismatch(updateError)) {
        console.warn("[reindex] deploy lock schema mismatch, using memory lock");
        updateMemoryReindexState({ lastError: buildErrorMessage(updateError) });
        await runMemoryReindex(deployId);
        return;
      }
      console.warn("[reindex] failed to lock deploy state", updateError);
      return;
    }
    locked = Boolean(updated?.length);
  } else {
    const { data: inserted, error: insertError } = await sb
      .from(REINDEX_STATE_TABLE)
      .insert({
        id: REINDEX_ROW_ID,
        last_deploy_id: deployId,
        last_reindexed_at: null,
        in_progress: true,
        lock_until: lockUntil,
        last_error: null,
        updated_at: nowIso,
      })
      .select("id");
    if (insertError) {
      if (isReindexSchemaMismatch(insertError)) {
        console.warn("[reindex] deploy lock schema mismatch, using memory lock");
        updateMemoryReindexState({ lastError: buildErrorMessage(insertError) });
        await runMemoryReindex(deployId);
        return;
      }
      console.warn("[reindex] failed to create deploy state", insertError);
      return;
    }
    locked = Boolean(inserted?.length);
  }

  if (!locked) {
    return;
  }

  console.info(`[reindex] triggered on deploy ${deployId}`);
  void runDeployReindex({ sb, deployId });
}

function resolveDeployId() {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.NEXT_BUILD_ID ||
    process.env.NEXT_PUBLIC_BUILD_ID ||
    FALLBACK_DEPLOY_ID
  );
}

async function resolveAfter(): Promise<AfterFn | null> {
  if (cachedAfter !== undefined) return cachedAfter;
  try {
    const mod = (await import("next/server")) as { after?: AfterFn };
    cachedAfter = typeof mod.after === "function" ? mod.after : null;
  } catch {
    cachedAfter = null;
  }
  return cachedAfter;
}

async function runMemoryReindex(deployId: string) {
  const nowMs = Date.now();
  const lock = tryAcquireMemoryLock({
    deployId,
    nowMs,
    cooldownMs: REINDEX_COOLDOWN_MS,
  });
  if (!lock.ok) {
    return;
  }

  console.info(`[reindex] triggered in memory for deploy ${deployId}`);
  try {
    const stats = await reindexSite();
    const finishedAt = stats.finishedAt ?? new Date().toISOString();
    releaseMemoryLock({
      finishedAt,
      cooldownMs: REINDEX_COOLDOWN_MS,
    });
    console.info(`[reindex] completed in memory for deploy ${deployId}`, stats);
  } catch (error) {
    console.error(`[reindex] failed in memory for deploy ${deployId}`, error);
    releaseMemoryLock({
      error: buildErrorMessage(error),
      cooldownMs: REINDEX_COOLDOWN_MS,
    });
  }
}

async function runDeployReindex(params: {
  sb: ReturnType<typeof supabaseAdmin>;
  deployId: string;
}) {
  try {
    const stats = await reindexSite();
    const finishedAt = stats.finishedAt ?? new Date().toISOString();
    await params.sb
      .from(REINDEX_STATE_TABLE)
      .update({
        last_deploy_id: params.deployId,
        last_reindexed_at: finishedAt,
        in_progress: false,
        lock_until: null,
        last_error: null,
        updated_at: finishedAt,
      })
      .eq("id", REINDEX_ROW_ID);
    console.info(`[reindex] completed on deploy ${params.deployId}`, stats);
  } catch (error) {
    console.error(`[reindex] failed on deploy ${params.deployId}`, error);
    const failedAt = new Date().toISOString();
    await params.sb
      .from(REINDEX_STATE_TABLE)
      .update({
        in_progress: false,
        lock_until: null,
        last_error: error instanceof Error ? error.message : String(error),
        updated_at: failedAt,
      })
      .eq("id", REINDEX_ROW_ID);
  }
}
