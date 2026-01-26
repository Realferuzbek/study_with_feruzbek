import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminGuard";
import { env } from "@/lib/rag/env";
import { isAiChatEnabled } from "@/lib/featureFlags";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getLocalDocStats } from "@/lib/rag/localDocs";
import {
  buildErrorMessage,
  getMemoryReindexState,
  isReindexSchemaMismatch,
  truncateErrorMessage,
} from "@/lib/rag/reindexState";

export async function GET() {
  const guard = await requireAdminSession();
  if (!guard.ok) {
    const message =
      guard.message === "unauthorized" ? "Unauthorized" : "Admin only";
    return NextResponse.json({ error: message }, { status: guard.status });
  }

  // Safe, non-secret diagnostics
  const supabasePublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  const supabaseServerUrl = supabasePublicUrl ?? process.env.SUPABASE_URL ?? null;

  const resolveHost = (value: string | null) => {
    if (!value) return null;
    try {
      return new URL(value).hostname;
    } catch {
      return null;
    }
  };

  const toOptionalError = (value: string) => {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  };

  const serverHost = resolveHost(supabaseServerUrl);
  const publicHost = resolveHost(supabasePublicUrl);

  const memoryState = getMemoryReindexState();
  let indexingMode: "supabase" | "memory" | "disabled" = "disabled";
  let indexingLastError: string | undefined;
  let indexingLastReindexedAt: string | null = memoryState.lastReindexedAt ?? null;

  if (process.env.SUPABASE_SERVICE_ROLE_KEY && supabaseServerUrl) {
    try {
      const sb = supabaseAdmin();
      const { data, error } = await sb
        .from("rag_reindex_state")
        .select("id, last_reindexed_at, last_error")
        .eq("id", 1)
        .limit(1);
      if (error) {
        const message = buildErrorMessage(error);
        if (isReindexSchemaMismatch(error)) {
          indexingMode = "memory";
          indexingLastError = toOptionalError(
            truncateErrorMessage(message || memoryState.lastError || ""),
          );
        } else {
          indexingMode = "supabase";
          indexingLastError = toOptionalError(truncateErrorMessage(message));
        }
      } else {
        const row = Array.isArray(data) ? data[0] : data;
        indexingMode = "supabase";
        indexingLastReindexedAt = row?.last_reindexed_at ?? null;
        indexingLastError =
          typeof row?.last_error === "string" && row.last_error.trim()
            ? toOptionalError(truncateErrorMessage(row.last_error))
            : undefined;
      }
    } catch (error) {
      indexingMode = "disabled";
      indexingLastError = toOptionalError(
        truncateErrorMessage(buildErrorMessage(error)),
      );
    }
  } else {
    indexingMode = "disabled";
    indexingLastError = memoryState.lastError
      ? toOptionalError(truncateErrorMessage(memoryState.lastError))
      : undefined;
  }

  const localDocs = await getLocalDocStats().catch(() => ({
    files: 0,
    chunks: 0,
  }));

  const diagnostics = {
    openai: {
      apiKeyPresent: Boolean(process.env.OPENAI_API_KEY),
      genModel: env.OPENAI_GEN_MODEL,
      embedModel: env.OPENAI_EMBED_MODEL,
      useMockAi:
        process.env.USE_MOCK_AI === "1" ||
        process.env.USE_MOCK_AI === "true" ||
        (env.OPENAI_API_KEY && env.OPENAI_API_KEY.toLowerCase() === "mock"),
    },
    upstash: {
      urlPresent: Boolean(process.env.UPSTASH_VECTOR_REST_URL),
      tokenPresent: Boolean(process.env.UPSTASH_VECTOR_REST_TOKEN),
      indexName: env.UPSTASH_INDEX_NAME,
      vectorDim: env.UPSTASH_VECTOR_DIM,
    },
    ragEnv: {
      siteBaseUrlPresent: Boolean(process.env.SITE_BASE_URL),
      indexerSecretPresent: Boolean(process.env.INDEXER_SECRET),
      upstashUrlPresent: Boolean(process.env.UPSTASH_VECTOR_REST_URL),
      upstashTokenPresent: Boolean(process.env.UPSTASH_VECTOR_REST_TOKEN),
      openaiKeyPresent: Boolean(process.env.OPENAI_API_KEY),
    },
    supabase: {
      serverHost,
      publicHost,
      mismatch: Boolean(serverHost && publicHost && serverHost !== publicHost),
      serverSource: supabaseServerUrl
        ? supabasePublicUrl
          ? "NEXT_PUBLIC_SUPABASE_URL"
          : "SUPABASE_URL"
        : null,
    },
    indexing: {
      mode: indexingMode,
      lastError: indexingLastError,
      lastReindexedAt: indexingLastReindexedAt,
    },
    localDocs,
    featureFlags: {
      aiChatEnabled: await isAiChatEnabled(true, { cache: false }),
    },
    runtime: {
      nodeEnv: process.env.NODE_ENV ?? null,
      vercelEnv: process.env.VERCEL_ENV ?? null,
    },
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json({ diagnostics });
}
