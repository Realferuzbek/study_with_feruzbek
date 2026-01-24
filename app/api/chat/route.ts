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
  getTodaysMantra,
} from "@/lib/ai-chat/tools";
import {
  isToolAuthRequired,
  routeTool,
  type ToolName,
} from "@/lib/ai-chat/toolRouter";
import { embedBatch, generateAnswer } from "@/lib/rag/ai";
import { vector, type SnippetMeta } from "@/lib/rag/vector";
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
    if (refusal === "personal" && !viewerId) {
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

    const toolSelection = await routeTool(embedding);
    if (toolSelection) {
      const toolName = toolSelection.name;
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

      const toolRetrieval = await queryContexts(embedding, {
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
          toolScore: toolSelection.score,
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
      retrieval = await queryContexts(embedding);
    } catch (error) {
      console.error("[api/chat] vector query failed", error);
      return NextResponse.json(
        { text: getErrorResponse(language), usedRag: false, language },
        { status: 500, headers: noCache() },
      );
    }

    const { contexts, bestScore, retrievalMs } = retrieval;

    const confident = contexts.length > 0 && bestScore >= SIMILARITY_THRESHOLD;

    if (!confident) {
      const reply = getOffTopicResponse(language);
      await persistLog({
        userId: viewerId,
        sessionId,
        language,
        input: inputRaw,
        reply,
        usedRag: false,
        metadata: {
          reason: "off_topic",
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
    case "getTodaysMantra":
      return getTodaysMantra();
    case "getLiveSessionsPublic":
      return getLiveSessionsPublic();
    case "getLeaderboardTopNowPublic":
      return getLeaderboardTopNowPublic();
    case "getMyTasksToday":
      return viewerId ? getMyTasksToday(viewerId) : null;
    case "getMyNextBookedSession":
      return viewerId ? getMyNextBookedSession(viewerId) : null;
    case "getMyStreak":
      return viewerId ? getMyStreak(viewerId) : { available: false, message: "not available yet" };
    case "getMyWeekSummary":
      return viewerId ? getMyWeekSummary(viewerId) : null;
    default:
      return null;
  }
}

function buildToolSnippet(toolName: ToolName, payload: any): ToolSnippet {
  switch (toolName) {
    case "getTodaysMantra": {
      if (!payload) {
        return {
          title: "Today's mantra",
          text: "Today's mantra is unavailable right now.",
        };
      }
      const index =
        typeof payload.index === "number" ? `#${payload.index + 1}` : "";
      const dateLabel = payload.dateLabel ?? payload.dateISO ?? "today";
      const quote = payload.quote ?? "";
      return {
        title: "Today's mantra",
        text: `Today's mantra (${dateLabel}) ${index}: ${quote}`.trim(),
      };
    }
    case "getLiveSessionsPublic": {
      const live = Array.isArray(payload?.live) ? payload.live : [];
      const upcoming = Array.isArray(payload?.upcoming) ? payload.upcoming : [];
      const lines = [`Live sessions now: ${live.length}`];
      live.forEach((session: any, index: number) => {
        const title = session?.title ?? "Focus session";
        lines.push(
          `Live ${index + 1}: ${title} | ${session.startsAt} to ${session.endsAt} | ${session.participantCount}/${session.maxParticipants} participants`,
        );
      });
      lines.push(`Upcoming sessions: ${upcoming.length}`);
      upcoming.forEach((session: any, index: number) => {
        const title = session?.title ?? "Focus session";
        lines.push(
          `Upcoming ${index + 1}: ${title} | ${session.startsAt} to ${session.endsAt} | ${session.participantCount}/${session.maxParticipants} participants`,
        );
      });
      return { title: "Live sessions", text: lines.join("\n") };
    }
    case "getLeaderboardTopNowPublic": {
      const entries = Array.isArray(payload?.entries) ? payload.entries : [];
      if (!entries.length) {
        return {
          title: "Leaderboard top",
          text: "No leaderboard snapshot is available right now.",
        };
      }
      const scope = payload?.scope ?? "latest";
      const periodStart = payload?.periodStart ?? "";
      const periodEnd = payload?.periodEnd ?? "";
      const period =
        periodStart && periodEnd ? `${periodStart} to ${periodEnd}` : periodStart || periodEnd || "latest period";
      const lines = [`Latest leaderboard (${scope}, ${period}):`];
      entries.forEach((entry: any) => {
        const minutes =
          typeof entry.minutes === "number" ? `${entry.minutes} min` : "minutes unavailable";
        lines.push(`#${entry.rank} ${entry.username} - ${minutes}`);
      });
      return { title: "Leaderboard top", text: lines.join("\n") };
    }
    case "getMyTasksToday": {
      const date = payload?.date ?? "today";
      const tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
      if (!tasks.length) {
        return {
          title: "Tasks today",
          text: `No tasks due or scheduled for ${date}.`,
        };
      }
      const lines = [`Tasks for ${date} (Asia/Tashkent):`];
      tasks.forEach((task: any) => {
        const due =
          task.dueDate ?? task.dueAt ?? task.dueStartDate ?? task.dueEndDate ?? "no due date";
        const scheduled = task.scheduledStart ?? task.scheduledEnd ?? "not scheduled";
        lines.push(
          `- ${task.title} [${task.status}] | due: ${due} | scheduled: ${scheduled}`,
        );
      });
      return { title: "Tasks today", text: lines.join("\n") };
    }
    case "getMyNextBookedSession": {
      if (!payload) {
        return {
          title: "Next booked session",
          text: "No upcoming booked sessions found.",
        };
      }
      const title = payload.title ?? "Focus session";
      const status = payload.status ?? "scheduled";
      return {
        title: "Next booked session",
        text: `Next booked session: ${title} | ${payload.startsAt} to ${payload.endsAt} | status: ${status}`,
      };
    }
    case "getMyStreak": {
      if (!payload?.available) {
        return {
          title: "Streak",
          text: payload?.message ?? "Streak data is not available yet.",
        };
      }
      return {
        title: "Streak",
        text: `Current streak: ${payload.current} days. Longest streak: ${payload.longest} days.`,
      };
    }
    case "getMyWeekSummary": {
      if (!payload) {
        return {
          title: "Weekly summary",
          text: "Weekly summary is not available yet.",
        };
      }
      const lines = [
        `Weekly summary (${payload.rangeStart} to ${payload.rangeEnd}):`,
        `Completed tasks: ${payload.completedTasks}`,
        payload.focusedMinutes === null
          ? "Focus time: not available yet"
          : `Focus time: ${payload.focusedMinutes} minutes`,
        `Sessions joined: ${payload.sessionsJoined}`,
      ];
      if (Array.isArray(payload.notes) && payload.notes.length) {
        lines.push("Notes:");
        payload.notes.forEach((note: string) => lines.push(`- ${note}`));
      }
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
  embedding: number[],
  options?: { allowFailure?: boolean },
): Promise<{ contexts: SnippetMeta[]; bestScore: number; retrievalMs: number }> {
  const retrievalStart = performance.now();
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
    const bestScore = sortedMatches.length
      ? (sortedMatches[0]?.score as number)
      : 0;
    const contexts = sortedMatches
      .slice(0, TOP_K)
      .map((match) => match.metadata as SnippetMeta);
    const retrievalMs = performance.now() - retrievalStart;
    return { contexts, bestScore, retrievalMs };
  } catch (error) {
    if (!options?.allowFailure) {
      throw error;
    }
    console.warn("[api/chat] vector query failed", error);
    const retrievalMs = performance.now() - retrievalStart;
    return { contexts: [], bestScore: 0, retrievalMs };
  }
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

type RefusalKind = "personal" | "admin";

const PERSONAL_PATTERNS: RegExp[] = [
  /\bmy\s+(stats|statistics|tasks?|habits?|minutes?|streak|profile|account|data|activity|history|sessions?)\b/i,
  /\bmy\s+(focus|study|timer|planner|goals?)\b/i,
  /\bhow\s+many\s+(minutes?|hours?)\b.*\b(i|me|my)\b/i,
  /\b(i|me|my)\s+(spent|studied|focused|tracked)\b/i,
  /\b(my|me)\s+(email|e-mail|phone|number|address)\b/i,
  /\b(email|e-mail)\b.*\b(my|me|mine|feruzbek)\b/i,
  /(^|\s)мо[йяеи]\s+(статистик|задач|привыч|минут|сер(ия|ии)|стрик|профил|аккаунт|данн|активн|истори)/i,
  /(^|\s)сколько\s+(минут|часов).*(я|мне|мой|моя|моё|мои)/i,
  /(^|\s)mening\s+(statistika|vazif|odat|daqiq|streak|profil|hisob|ma'lumot|malumot|faoliyat|tarix)/i,
  /(^|\s)necha\s+(daqiq|soat).*(men(ing|)?)/i,
];

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
  if (matchesAny(PERSONAL_PATTERNS, input)) return "personal";
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
