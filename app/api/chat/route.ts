export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { performance } from "perf_hooks";
import { auth } from "@/lib/auth";
import { detectLanguage } from "@/lib/ai-chat/language";
import type { SupportedLanguage } from "@/lib/ai-chat/language";
import { detectGreeting, getGreetingReply } from "@/lib/ai-chat/greetings";
import {
  getErrorResponse,
  getModerationResponse,
  getOffTopicResponse,
  getAdminRefusalResponse,
  getSignInRequiredResponse,
  getNotIndexedYetResponse,
} from "@/lib/ai-chat/messages";
import {
  isLeaderboardIntent,
  maybeHandleLeaderboardQuestion,
} from "@/lib/ai-chat/leaderboard";
import { moderateInput } from "@/lib/ai-chat/moderation";
import {
  extractMemoryEntries,
  getMemoryPreference,
  getUserMemories,
  upsertUserMemories,
} from "@/lib/ai-chat/memory";
import type { MemoryEntry } from "@/lib/ai-chat/memory";
import { saveChatLog } from "@/lib/ai-chat/logging";
import { redactForStorage } from "@/lib/ai-chat/redaction";
import type { RedactionStatus } from "@/lib/ai-chat/redaction";
import {
  getLeaderboardTopNowPublic,
  getLiveSessionsPublic,
  getMyNextBookedSession,
  getMyStreak,
  getMyTasksToday,
  getMyWeekSummary,
  getTodaysMantraPublic,
} from "@/lib/ai-chat/tools";
import {
  isToolAuthRequired,
  routeIntent,
  type ToolName,
} from "@/lib/ai-chat/router";
import { embedBatch, generateAnswer } from "@/lib/rag/ai";
import { vector, type SnippetMeta } from "@/lib/rag/vector";
import { getLocalDocContexts } from "@/lib/rag/localDocs";
import { rateLimit } from "@/lib/rateLimit";
import { isAiChatEnabled } from "@/lib/featureFlags";

const SIMILARITY_THRESHOLD = 0.35;
const TOP_K = 5;

type ChatRequestBody = {
  input?: unknown;
  userId?: unknown;
  sessionId?: unknown;
};

export async function POST(req: Request) {
  const startedAt = performance.now();
  try {
    const body = (await req.json().catch(() => ({}))) as ChatRequestBody;
    const inputRaw =
      typeof body.input === "string" ? body.input.trim() : undefined;
    if (!inputRaw) {
      return NextResponse.json(
        { error: "Missing input" },
        { status: 400, headers: noCache() },
      );
    }

    const sessionIdRaw =
      typeof body.sessionId === "string" ? body.sessionId : null;
    const sessionId = sessionIdRaw && isUuid(sessionIdRaw) ? sessionIdRaw : null;
    if (!sessionId) {
      return NextResponse.json(
        { error: "Invalid session" },
        { status: 400, headers: noCache() },
      );
    }

    const session = await auth();
    const viewerId =
      typeof (session?.user as any)?.id === "string"
        ? String((session?.user as any).id)
        : null;

    const forwardedFor =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const rateKey = `ai-chat:${sessionId}:${forwardedFor ?? "anon"}`;
    const throttle = rateLimit(rateKey, 12, 60_000);
    if (!throttle.ok) {
      return NextResponse.json(
        { error: "Too many requests. Try again in a minute." },
        { status: 429, headers: noCache() },
      );
    }

    const normalizedInput = inputRaw.toLowerCase().trim();
    const languageDetection = detectLanguage(inputRaw);
    const language = languageDetection.code;

    const aiEnabled = await isAiChatEnabled(false, { cache: false });
    if (!aiEnabled) {
      return NextResponse.json(
        { text: getPausedReply(language), usedRag: false, language },
        { status: 503, headers: noCache() },
      );
    }

    const greetingMatch = detectGreeting(inputRaw);
    if (greetingMatch) {
      const reply = getGreetingReply(greetingMatch ?? language);
      await persistLog({
        userId: viewerId,
        sessionId,
        language,
        input: inputRaw,
        reply,
        usedRag: false,
        metadata: { reason: "greeting", usedTools: false },
      });
      return NextResponse.json(
        { text: reply, usedRag: false, language },
        { headers: noCache() },
      );
    }

    const moderation = await moderateInput(inputRaw);
    if (!moderation.ok) {
      const reply = getModerationResponse(language);
      await persistLog({
        userId: viewerId,
        sessionId,
        language,
        input: inputRaw,
        reply,
        usedRag: false,
        metadata: {
          reason: "moderation",
          category: moderation.category,
          usedTools: false,
        },
      });
      return NextResponse.json(
        { text: reply, usedRag: false, language },
        { headers: noCache() },
      );
    }

    const refusal = classifyRefusal(normalizedInput);
    if (refusal === "admin") {
      const reply = getAdminRefusalResponse(language);
      await persistLog({
        userId: viewerId,
        sessionId,
        language,
        input: inputRaw,
        reply,
        usedRag: false,
        metadata: {
          reason: "admin_request",
          usedTools: false,
        },
      });
      return NextResponse.json(
        { text: reply, usedRag: false, language },
        { headers: noCache() },
      );
    }

    const leaderboardIntent = isLeaderboardIntent(normalizedInput);
    const offTopic =
      isGeneralKnowledgeIntent(normalizedInput) &&
      !leaderboardIntent &&
      !isFocusSquadIntent(normalizedInput);
    if (offTopic) {
      const reply = getOffTopicResponse(language);
      await persistLog({
        userId: viewerId,
        sessionId,
        language,
        input: inputRaw,
        reply,
        usedRag: false,
        metadata: { reason: "off_topic_intent", usedTools: false },
      });
      return NextResponse.json(
        { text: reply, usedRag: false, language },
        { headers: noCache() },
      );
    }

    const embedStart = performance.now();
    const [embedding] = await embedBatch([inputRaw]);
    const embedMs = performance.now() - embedStart;
    if (!embedding || !embedding.length) {
      return NextResponse.json(
        { text: getErrorResponse(language), usedRag: false, language },
        { status: 500, headers: noCache() },
      );
    }

    const routeSelection = await routeIntent(inputRaw, embedding);
    if (routeSelection.kind === "tool") {
      const toolName = routeSelection.tool;
      if (isToolAuthRequired(toolName) && !viewerId) {
        const reply = getSignInRequiredResponse(language);
        await persistLog({
          userId: viewerId,
          sessionId,
          language,
          input: inputRaw,
          reply,
          usedRag: false,
          metadata: {
            reason: "personal_sign_in_required",
            usedTools: false,
            toolName,
          },
        });
        return NextResponse.json(
          { text: reply, usedRag: false, language },
          { headers: noCache() },
        );
      }

      const toolStart = performance.now();
      const toolResult = await runTool(toolName, viewerId);
      const toolMs = performance.now() - toolStart;
      const toolSnippet = buildToolSnippet(toolName, toolResult);
      const toolContext = buildToolContext(toolName, toolSnippet);

      const toolRetrieval = await queryContexts(inputRaw, embedding, {
        allowFailure: true,
      });
      const ragContexts =
        toolRetrieval.bestScore >= SIMILARITY_THRESHOLD
          ? toolRetrieval.contexts
          : [];
      const contexts = [toolContext, ...ragContexts];

      const memoryState = viewerId
        ? await safeGetMemories(viewerId)
        : { list: [], enabled: false };
      const memories = memoryState.list;

      const preGenEnabled = await isAiChatEnabled(false, { cache: false });
      if (!preGenEnabled) {
        return NextResponse.json(
          { text: getPausedReply(language), usedRag: false, language },
          { status: 503, headers: noCache() },
        );
      }

      const generationStart = performance.now();
      const answer = await generateAnswer({
        question: inputRaw,
        language,
        contexts,
        memory: memories,
      });
      const generationMs = performance.now() - generationStart;

      const postGenEnabled = await isAiChatEnabled(false, { cache: false });
      if (!postGenEnabled) {
        return NextResponse.json(
          { text: getPausedReply(language), usedRag: false, language },
          { status: 503, headers: noCache() },
        );
      }

      const logEntry = await persistLog({
        userId: viewerId,
        sessionId,
        language,
        input: inputRaw,
        reply: answer,
        usedRag: true,
        metadata: {
          usedTools: true,
          toolName,
          toolScore: routeSelection.score ?? null,
          toolSource: routeSelection.source,
          toolMs,
          matches: toolRetrieval.contexts.length,
          bestScore: toolRetrieval.bestScore,
          embedMs,
          retrievalMs: toolRetrieval.retrievalMs,
          generationMs,
          languageConfidence: languageDetection.confidence,
          memoryUsed: memories.length,
        },
      });

      if (viewerId && memoryState.enabled) {
        const memoryHints = extractMemoryEntries(inputRaw);
        if (memoryHints.length) {
          safeRemember(viewerId, memoryHints);
        }
      }

      const totalMs = performance.now() - startedAt;
      console.info("[api/chat] timings", {
        embedMs: Number(embedMs.toFixed(1)),
        retrievalMs: Number(toolRetrieval.retrievalMs.toFixed(1)),
        generationMs: Number(generationMs.toFixed(1)),
        totalMs: Number(totalMs.toFixed(1)),
        usedRag: true,
        usedTools: true,
        toolName,
        toolSource: routeSelection.source,
        language,
        bestScore: Number(
          toolRetrieval.bestScore?.toFixed?.(3) ?? toolRetrieval.bestScore,
        ),
      });

      return NextResponse.json(
        {
          text: answer,
          usedRag: true,
          language,
          chatId: logEntry?.id ?? null,
        },
        { headers: noCache() },
      );
    }

    const leaderboardTool = await maybeHandleLeaderboardQuestion({
      input: inputRaw,
      language,
    });
    if (leaderboardTool.handled) {
      const reply = leaderboardTool.text ?? getErrorResponse(language);
      await persistLog({
        userId: viewerId,
        sessionId,
        language,
        input: inputRaw,
        reply,
        usedRag: false,
        metadata: {
          usedTools: false,
          ...(leaderboardTool.metadata ?? { reason: "leaderboard" }),
        },
      });
      return NextResponse.json(
        { text: reply, usedRag: false, language },
        { headers: noCache() },
      );
    }

    let retrieval: Awaited<ReturnType<typeof queryContexts>>;
    try {
      retrieval = await queryContexts(inputRaw, embedding);
    } catch (error) {
      console.error("[api/chat] vector query failed", error);
      return NextResponse.json(
        { text: getErrorResponse(language), usedRag: false, language },
        { status: 500, headers: noCache() },
      );
    }

    const { contexts, bestScore, retrievalMs } = retrieval;

    if (!contexts.length) {
      const reply = getNotIndexedYetResponse(language);
      await persistLog({
        userId: viewerId,
        sessionId,
        language,
        input: inputRaw,
        reply,
        usedRag: false,
        metadata: {
          reason: "not_indexed",
          matches: contexts.length,
          bestScore,
          embedMs,
          retrievalMs,
          usedTools: false,
        },
      });
      return NextResponse.json(
        { text: reply, usedRag: false, language },
        { headers: noCache() },
      );
    }

    const memoryState = viewerId
      ? await safeGetMemories(viewerId)
      : { list: [], enabled: false };
    const memories = memoryState.list;

    const preGenEnabled = await isAiChatEnabled(false, { cache: false });
    if (!preGenEnabled) {
      return NextResponse.json(
        { text: getPausedReply(language), usedRag: false, language },
        { status: 503, headers: noCache() },
      );
    }

    const generationStart = performance.now();
    const answer = await generateAnswer({
      question: inputRaw,
      language,
      contexts,
      memory: memories,
    });
    const generationMs = performance.now() - generationStart;

    const postGenEnabled = await isAiChatEnabled(false, { cache: false });
    if (!postGenEnabled) {
      return NextResponse.json(
        { text: getPausedReply(language), usedRag: false, language },
        { status: 503, headers: noCache() },
      );
    }

    const logEntry = await persistLog({
      userId: viewerId,
      sessionId,
      language,
      input: inputRaw,
      reply: answer,
      usedRag: true,
      metadata: {
        matches: contexts.length,
        bestScore,
        embedMs,
        retrievalMs,
        generationMs,
        languageConfidence: languageDetection.confidence,
        memoryUsed: memories.length,
        usedTools: false,
      },
    });

    if (viewerId && memoryState.enabled) {
      const memoryHints = extractMemoryEntries(inputRaw);
      if (memoryHints.length) {
        safeRemember(viewerId, memoryHints);
      }
    }

    const totalMs = performance.now() - startedAt;
    console.info("[api/chat] timings", {
      embedMs: Number(embedMs.toFixed(1)),
      retrievalMs: Number(retrievalMs.toFixed(1)),
      generationMs: Number(generationMs.toFixed(1)),
      totalMs: Number(totalMs.toFixed(1)),
      usedRag: true,
      language,
      bestScore: Number(bestScore?.toFixed?.(3) ?? bestScore),
    });

    return NextResponse.json(
      {
        text: answer,
        usedRag: true,
        language,
        chatId: logEntry?.id ?? null,
      },
      { headers: noCache() },
    );
  } catch (error) {
    console.error("[api/chat] failure", error);
    return NextResponse.json(
      {
        text: getErrorResponse("en"),
        usedRag: false,
        language: "en",
      },
      { status: 500, headers: noCache() },
    );
  }
}

async function safeGetMemories(userId: string) {
  try {
    const enabled = await getMemoryPreference(userId);
    if (!enabled) {
      return { list: [], enabled: false };
    }
    const list = await getUserMemories(userId);
    return { list, enabled: true };
  } catch {
    return { list: [], enabled: true };
  }
}

function safeRemember(userId: string, entries: MemoryEntry[]) {
  upsertUserMemories(userId, entries).catch((error) =>
    console.warn("[ai-chat] failed to store memories", error),
  );
}

type ToolSnippet = {
  title: string;
  text: string;
};

async function runTool(toolName: ToolName, viewerId: string | null) {
  switch (toolName) {
    case "TOOL_TODAYS_MANTRA":
      return getTodaysMantraPublic();
    case "TOOL_LIVE_SESSIONS":
      return getLiveSessionsPublic();
    case "TOOL_LEADERBOARD_TOP_NOW":
      return getLeaderboardTopNowPublic();
    case "TOOL_MY_TASKS_TODAY":
      return viewerId ? getMyTasksToday(viewerId) : null;
    case "TOOL_MY_NEXT_SESSION":
      return viewerId ? getMyNextBookedSession(viewerId) : null;
    case "TOOL_MY_STREAK":
      return viewerId ? getMyStreak(viewerId) : null;
    case "TOOL_MY_WEEK_SUMMARY":
      return viewerId ? getMyWeekSummary(viewerId) : null;
    default:
      return null;
  }
}

function buildToolSnippet(toolName: ToolName, payload: any): ToolSnippet {
  switch (toolName) {
    case "TOOL_TODAYS_MANTRA": {
      if (!payload) {
        return {
          title: "Today's mantra",
          text: "Today's mantra is unavailable right now. You can check the Motivation Vault page.",
        };
      }
      const index =
        typeof payload.quoteIndex === "number" ? `#${payload.quoteIndex}` : "";
      const dateLabel = payload.dateLabel ?? "today";
      const quote = payload.text ?? "";
      return {
        title: "Today's mantra",
        text: `Today's mantra (${dateLabel}) ${index}: ${quote}`.trim(),
      };
    }
    case "TOOL_LIVE_SESSIONS": {
      if (payload?.error) {
        return {
          title: "Live sessions",
          text: "Live sessions are unavailable right now. Please try again soon.",
        };
      }
      const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
      if (!sessions.length) {
        return {
          title: "Live sessions",
          text: "No joinable live sessions right now. Check Live Stream Studio for upcoming rooms.",
        };
      }
      const lines = [`Joinable sessions right now: ${sessions.length}`];
      sessions.forEach((session: any, index: number) => {
        const topic = session?.topic ?? "Focus session";
        const mode = session?.mode ? `mode: ${session.mode}` : "mode: not set";
        const host = session?.creatorDisplayName
          ? `host: ${session.creatorDisplayName}`
          : "host: Focus Host";
        lines.push(
          `${index + 1}. ${topic} | ${session.startsAt} to ${session.endsAt} | ${mode} | ${host}`,
        );
      });
      return { title: "Live sessions", text: lines.join("\n") };
    }
    case "TOOL_LEADERBOARD_TOP_NOW": {
      if (!payload?.available) {
        return {
          title: "Leaderboard top",
          text: "No leaderboard snapshot is available yet. Check Leaderboard -> History.",
        };
      }
      const entries = Array.isArray(payload?.entries) ? payload.entries : [];
      if (!entries.length) {
        return {
          title: "Leaderboard top",
          text: "No leaderboard snapshot is available yet. Check Leaderboard -> History.",
        };
      }
      const scope = payload?.scope ?? "day";
      const periodStart = payload?.periodStart ?? payload?.date ?? "";
      const periodEnd = payload?.periodEnd ?? "";
      const period =
        periodStart && periodEnd
          ? `${periodStart} to ${periodEnd}`
          : periodStart || periodEnd || "latest period";
      const lines = [`Leaderboard top right now (${scope}, ${period}):`];
      entries.forEach((entry: any) => {
        const minutes =
          typeof entry.minutes === "number"
            ? `${entry.minutes} min`
            : "minutes unavailable";
        lines.push(`#${entry.rank} ${entry.username} - ${minutes}`);
      });
      return { title: "Leaderboard top", text: lines.join("\n") };
    }
    case "TOOL_MY_TASKS_TODAY": {
      const date = payload?.date ?? "today";
      const tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
      if (!tasks.length) {
        return {
          title: "Tasks today",
          text: `No tasks due or scheduled for ${date}. You can check Task Scheduler for details.`,
        };
      }
      const lines = [`Tasks for ${date} (Asia/Tashkent):`];
      tasks.forEach((task: any) => {
        const due = task.dueAt ?? task.dueDate ?? "no due date";
        const scheduled = task.scheduledStart ?? task.scheduledEnd ?? "not scheduled";
        const source = task.source ? `source: ${task.source}` : "source: unknown";
        lines.push(
          `- ${task.title} [${task.status}] | due: ${due} | scheduled: ${scheduled} | ${source}`,
        );
      });
      return { title: "Tasks today", text: lines.join("\n") };
    }
    case "TOOL_MY_NEXT_SESSION": {
      if (!payload) {
        return {
          title: "Next booked session",
          text: "No upcoming booked sessions found. Check Live Stream Studio for sessions.",
        };
      }
      const title = payload.topic ?? "Focus session";
      const mode = payload.mode ? `mode: ${payload.mode}` : "mode: not set";
      return {
        title: "Next booked session",
        text: `Next booked session: ${title} | ${payload.startsAt} to ${payload.endsAt} | ${mode}`,
      };
    }
    case "TOOL_MY_STREAK": {
      if (!payload) {
        return {
          title: "Streak",
          text: "Streak data is not available yet. Check your profile or dashboard.",
        };
      }
      return {
        title: "Streak",
        text: `Current streak: ${payload.current} days. Longest streak: ${payload.longest} days.`,
      };
    }
    case "TOOL_MY_WEEK_SUMMARY": {
      if (!payload) {
        return {
          title: "Weekly summary",
          text: "Weekly summary is not available yet. Check your dashboard for progress.",
        };
      }
      const lines = [
        `Weekly summary (${payload.rangeStart} to ${payload.rangeEnd}):`,
        `Completed tasks: ${payload.completedTasks}`,
        `Focus time: ${payload.focusedMinutes} minutes`,
        `Sessions joined: ${payload.sessionsJoined}`,
        `Task Scheduler done: ${payload.completedTaskItems}`,
        `Daily tasks done: ${payload.completedDailyTasks}`,
      ];
      return { title: "Weekly summary", text: lines.join("\n") };
    }
    default:
      return { title: "Tool result", text: "" };
  }
}

function buildToolContext(toolName: ToolName, snippet: ToolSnippet): SnippetMeta {
  return {
    url: `tool://${toolName}`,
    title: snippet.title,
    chunk: snippet.text,
    chunkIndex: 0,
    indexedAt: new Date().toISOString(),
  };
}

async function queryContexts(
  input: string,
  embedding: number[],
  options?: { allowFailure?: boolean },
): Promise<{ contexts: SnippetMeta[]; bestScore: number; retrievalMs: number }> {
  const retrievalStart = performance.now();
  let contexts: SnippetMeta[] = [];
  let bestScore = 0;
  let vectorFailed = false;
  try {
    const result: any = await vector.query({
      vector: embedding,
      topK: TOP_K,
      includeMetadata: true,
    });
    const matches: Array<{ score?: number; metadata?: SnippetMeta }> = Array.isArray(
      result?.matches,
    )
      ? result.matches
      : [];
    const validMatches = matches.filter(
      (match) =>
        match &&
        typeof match.score === "number" &&
        match.metadata?.chunk &&
        match.metadata?.url,
    );
    const sortedMatches = [...validMatches].sort(
      (a, b) => (b.score ?? 0) - (a.score ?? 0),
    );
    bestScore = sortedMatches.length
      ? (sortedMatches[0]?.score as number)
      : 0;
    contexts = sortedMatches
      .slice(0, TOP_K)
      .map((match) => match.metadata as SnippetMeta);
  } catch (error) {
    vectorFailed = true;
    if (!options?.allowFailure) {
      console.warn("[api/chat] vector query failed", error);
    }
  }

  if (!contexts.length) {
    const localMatches = await getLocalDocContexts(input);
    if (localMatches.length) {
      bestScore = Math.max(...localMatches.map((match) => match.similarity));
      contexts = localMatches.map((match, index) => ({
        url: match.url ?? `local-docs://${match.id}`,
        title: match.title,
        chunk: match.chunk,
        chunkIndex: resolveChunkIndex(match.id, index),
        indexedAt: new Date().toISOString(),
      }));
    } else if (vectorFailed && !options?.allowFailure) {
      console.warn("[api/chat] vector query failed with no local fallback");
    }
  }

  const retrievalMs = performance.now() - retrievalStart;
  return { contexts, bestScore, retrievalMs };
}

function resolveChunkIndex(id: string, fallback: number) {
  const hashIndex = id.lastIndexOf("#");
  if (hashIndex === -1) return fallback;
  const raw = Number(id.slice(hashIndex + 1));
  return Number.isFinite(raw) ? raw : fallback;
}

async function persistLog(params: {
  userId: string | null;
  sessionId: string;
  language: SupportedLanguage;
  input: string;
  reply: string;
  usedRag: boolean;
  metadata?: Record<string, unknown>;
}) {
  const redactedInput = redactForStorage(params.input);
  const redactedReply = redactForStorage(params.reply);
  const status: RedactionStatus =
    redactedInput.status === "failed" || redactedReply.status === "failed"
      ? "failed"
      : redactedInput.status === "redacted" || redactedReply.status === "redacted"
        ? "redacted"
        : "skipped";
  return saveChatLog({
    userId: params.userId,
    sessionId: params.sessionId,
    language: params.language,
    input: redactedInput.value,
    reply: redactedReply.value,
    usedRag: params.usedRag,
    metadata: params.metadata,
    redactionStatus: status,
  });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

type RefusalKind = "admin";

const ADMIN_PATTERNS: RegExp[] = [
  /\badmin\b/i,
  /\badmin\s+(panel|controls|dashboard)\b/i,
  /\badmin\b.*\btoggle\b/i,
  /\btoggle\b.*\badmin\b/i,
  /\bbackend\b/i,
  /\binternal\b/i,
  /\bconfig(uration)?\b/i,
  /\benv(ironment)?\b/i,
  /\bdiagnostic(s)?\b/i,
  /\bserver\s+logs?\b/i,
  /\blog\s+export\b/i,
  /\bapi\s*key\b/i,
  /\bsecret\s+key\b/i,
  /\bservice\s*role\b/i,
  /\b(access|service|admin)\s+token\b/i,
  /\bsupabase\b/i,
  /\bvercel\b/i,
  /\bendpoint\b/i,
  /\/api\/[a-z0-9/_-]+/i,
  /\breindex\b/i,
  /\bfeature\s+flags?\b/i,
  /(^|\s)админ/i,
  /(^|\s)внутренн/i,
  /(^|\s)(конфиг|настройк)/i,
  /(^|\s)секрет/i,
  /(^|\s)ключ(\s|$)/i,
  /(^|\s)логи?(\s|$)/i,
  /(^|\s)диагностик/i,
  /(^|\s)(эндпоинт|endpoint)/i,
  /(^|\s)ichki/i,
  /(^|\s)maxfiy/i,
  /(^|\s)kalit/i,
  /(^|\s)sozlam/i,
  /(^|\s)server/i,
  /(^|\s)log/i,
  /(^|\s)diagnostika/i,
];

const GENERAL_KNOWLEDGE_PATTERNS: RegExp[] = [
  /\bwhat\s+is\b/i,
  /\bwho\s+is\b/i,
  /\bdefine\b/i,
  /\bexplain\b/i,
  /\bhistory\s+of\b/i,
  /\bmeaning\s+of\b/i,
  /\bwhen\s+did\b/i,
  /\bwhere\s+is\b/i,
  /\bcapital\s+of\b/i,
  /\bweather\b/i,
  /\bforecast\b/i,
  /\bnews\b/i,
  /\bpolitics?\b/i,
  /\bpresident\b/i,
  /\bprime\s+minister\b/i,
  /\bwar\b/i,
  /\bquantum\b/i,
  /\bphysics\b/i,
  /\bchemistry\b/i,
  /\bbiology\b/i,
  /\bmath\b/i,
  /\balgebra\b/i,
  /\bcalculus\b/i,
  /\bgeometry\b/i,
  /\bmovie\b/i,
  /\bfilm\b/i,
  /\bmusic\b/i,
  /\bsong\b/i,
  /\bbook\b/i,
  /\bnovel\b/i,
  /\bfootball\b/i,
  /\bsoccer\b/i,
  /\bbasketball\b/i,
  /\brecipe\b/i,
  /\bcook\b/i,
  /\bfood\b/i,
  /\bdiet\b/i,
  /\bbitcoin\b/i,
  /\bcrypto\b/i,
  /\bstock\b/i,
  /\bmarket\b/i,
];

const FOCUS_SQUAD_PATTERNS: RegExp[] = [
  /\bfocus\s+squad\b/i,
  /\bstudymate\b/i,
  /\bdashboard\b/i,
  /\b(timer|pomodoro|focus\s+timer|break)\b/i,
  /\bmotivation\b/i,
  /\bmantra\b/i,
  /\bmotivation\s+vault\b/i,
  /\bleaderboard\b/i,
  /\brankings?\b/i,
  /\bstreaks?\b/i,
  /\btasks?\b/i,
  /\bhabits?\b/i,
  /\btask\s+scheduler\b/i,
  /\bplanner\b/i,
  /\bcommunity\b/i,
  /\blive\s+stream\b/i,
  /\blive\s+sessions?\b/i,
  /\bfocus\s+sessions?\b/i,
  /\blive\s+(room|rooms|session|sessions)\b/i,
  /\bstudy\s+session\b/i,
  /\baccountability\b/i,
  /\bpremium\b/i,
  /\bsubscription\b/i,
  /\bpricing\b/i,
  /\bfeatures?\b/i,
  /\bask\s+ai\b/i,
  /\bassistant\b/i,
  /\/leaderboard\b/i,
  /\/dashboard\b/i,
  /\/community\b/i,
  /\/feature\b/i,
  /\/feature\/motivation\b/i,
];

function classifyRefusal(input: string): RefusalKind | null {
  if (matchesAny(ADMIN_PATTERNS, input)) return "admin";
  return null;
}

function isGeneralKnowledgeIntent(input: string) {
  return matchesAny(GENERAL_KNOWLEDGE_PATTERNS, input);
}

function isFocusSquadIntent(input: string) {
  return matchesAny(FOCUS_SQUAD_PATTERNS, input);
}

function matchesAny(patterns: RegExp[], input: string) {
  return patterns.some((pattern) => pattern.test(input));
}

function noCache() {
  return { "Cache-Control": "no-store" };
}

function getPausedReply(language: SupportedLanguage) {
  if (language === "uz") {
    return "AI hozirda dam olmoqda — administratorlar uni yaqinda qayta ishga tushiradilar ✨";
  }
  if (language === "ru") {
    return "Ассистент временно на паузе — админы скоро вернут его в строй ✨";
  }
  return "The assistant is taking a quick break while admins make updates. Check back soon ✨";
}
