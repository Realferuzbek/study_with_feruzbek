export type ReindexMode = "supabase" | "memory" | "disabled";

export type MemoryReindexState = {
  lastDeployId?: string;
  lockUntil?: number;
  inProgress?: boolean;
  lastError?: string | null;
  lastReindexedAt?: string | null;
};

const GLOBAL_KEY = "__studymateReindex";

const SCHEMA_ERROR_CODES = new Set(["42P01", "42703"]);

export function getMemoryReindexState(): MemoryReindexState {
  const globalObj = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: MemoryReindexState;
  };
  if (!globalObj[GLOBAL_KEY]) {
    globalObj[GLOBAL_KEY] = {};
  }
  return globalObj[GLOBAL_KEY]!;
}

export function updateMemoryReindexState(
  patch: Partial<MemoryReindexState>,
): MemoryReindexState {
  const state = getMemoryReindexState();
  Object.assign(state, patch);
  return state;
}

export function tryAcquireMemoryLock(params: {
  deployId: string;
  nowMs?: number;
  cooldownMs: number;
}): { ok: boolean; reason?: string; state: MemoryReindexState } {
  const nowMs = params.nowMs ?? Date.now();
  const state = getMemoryReindexState();
  const lockUntil = state.lockUntil ?? 0;
  const lockActive = lockUntil > nowMs;

  if (state.inProgress && lockActive) {
    return { ok: false, reason: "in_progress", state };
  }

  if (state.lastDeployId === params.deployId && lockActive) {
    return { ok: false, reason: "cooldown", state };
  }

  state.inProgress = true;
  state.lastDeployId = params.deployId;
  state.lockUntil = nowMs + params.cooldownMs;
  state.lastError = null;
  return { ok: true, state };
}

export function releaseMemoryLock(params: {
  error?: string | null;
  finishedAt?: string;
  nowMs?: number;
  cooldownMs: number;
}): MemoryReindexState {
  const nowMs = params.nowMs ?? Date.now();
  const state = getMemoryReindexState();
  state.inProgress = false;
  if (params.finishedAt) {
    state.lastReindexedAt = params.finishedAt;
  }
  if (params.error) {
    state.lastError = params.error;
  }
  state.lockUntil = nowMs + params.cooldownMs;
  return state;
}

export function isReindexSchemaMismatch(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code =
    (error as any).code ??
    (error as any).cause?.code ??
    (error as any).details?.code;
  if (code && SCHEMA_ERROR_CODES.has(String(code))) {
    return true;
  }

  const message = buildErrorMessage(error).toLowerCase();
  if (!message.includes("rag_reindex_state")) return false;
  return (
    message.includes("column") ||
    message.includes("schema") ||
    message.includes("relation") ||
    message.includes("does not exist") ||
    message.includes("undefined")
  );
}

export function buildErrorMessage(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const message =
      "message" in error && typeof (error as any).message === "string"
        ? (error as any).message
        : "";
    const details =
      "details" in error && typeof (error as any).details === "string"
        ? (error as any).details
        : "";
    const hint =
      "hint" in error && typeof (error as any).hint === "string"
        ? (error as any).hint
        : "";
    const code =
      "code" in error && typeof (error as any).code === "string"
        ? (error as any).code
        : "";
    return [message, details, hint, code].filter(Boolean).join(" ").trim();
  }
  return String(error);
}

export function truncateErrorMessage(message: string, max = 180) {
  if (!message) return "";
  if (message.length <= max) return message;
  return `${message.slice(0, max - 3)}...`;
}
