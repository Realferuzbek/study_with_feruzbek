import { z } from "zod";

import { embedBatch, openai } from "@/lib/rag/ai";
import { env } from "@/lib/rag/env";

export const ROUTER_TOOLS = [
  {
    name: "TOOL_TODAYS_MANTRA",
    description: "Return today's Motivation Vault mantra (public).",
    examples: [
      "what's today's mantra",
      "today's motivation",
      "daily mantra",
      "mantra for today",
      "motivation vault quote",
    ],
    requiresAuth: false,
  },
  {
    name: "TOOL_LIVE_SESSIONS",
    description: "Show joinable live sessions happening right now (public).",
    examples: [
      "what sessions are live now",
      "who is live right now",
      "any focus rooms live",
      "live sessions",
      "study rooms happening now",
    ],
    requiresAuth: false,
  },
  {
    name: "TOOL_LEADERBOARD_TOP_NOW",
    description:
      "Show the current top leaderboard (today, Asia/Tashkent, top 3) (public).",
    examples: [
      "who's top on the leaderboard right now",
      "leaderboard top now",
      "current top 3",
      "top of the leaderboard today",
      "leaderboard leaders right now",
    ],
    requiresAuth: false,
  },
  {
    name: "TOOL_MY_TASKS_TODAY",
    description: "Show my tasks due or scheduled today (signed-in only).",
    examples: [
      "what are my tasks today",
      "my tasks for today",
      "what should I do today",
      "tasks due today",
      "my to-do list today",
    ],
    requiresAuth: true,
  },
  {
    name: "TOOL_MY_NEXT_SESSION",
    description: "Show my next booked focus session (signed-in only).",
    examples: [
      "when is my next booked session",
      "my next focus session",
      "next session I joined",
      "upcoming session I booked",
    ],
    requiresAuth: true,
  },
  {
    name: "TOOL_MY_STREAK",
    description: "Show my current and longest streak (signed-in only).",
    examples: [
      "what's my streak",
      "am I on a streak",
      "current streak",
      "my streak status",
    ],
    requiresAuth: true,
  },
  {
    name: "TOOL_MY_WEEK_SUMMARY",
    description:
      "Summarize what I did this week: tasks, sessions, focus minutes (signed-in only).",
    examples: [
      "summarize what I did this week",
      "my weekly summary",
      "what did I do this week",
      "this week's progress",
    ],
    requiresAuth: true,
  },
] as const;

const TOOL_NAMES = ROUTER_TOOLS.map((tool) => tool.name) as [
  (typeof ROUTER_TOOLS)[number]["name"],
  ...(typeof ROUTER_TOOLS)[number]["name"][],
];

export type ToolName = (typeof ROUTER_TOOLS)[number]["name"];

export type RouterDecision =
  | { kind: "rag" }
  | { kind: "tool"; tool: ToolName };

export type RouterResult = RouterDecision & {
  source: "llm" | "embedding" | "fallback";
  score?: number;
};

const RouterSchema = z.union([
  z.object({ kind: z.literal("rag") }),
  z.object({
    kind: z.literal("tool"),
    tool: z.enum(TOOL_NAMES),
  }),
]);

type ToolIntent = {
  name: ToolName;
  description: string;
  examples: readonly string[];
  requiresAuth: boolean;
};

type IntentEmbedding = ToolIntent & { embedding: number[] };

const TOOL_SIMILARITY_THRESHOLD = 0.45;
let embeddingCache: Promise<IntentEmbedding[]> | null = null;

export function isToolAuthRequired(toolName: ToolName) {
  return ROUTER_TOOLS.find((tool) => tool.name === toolName)?.requiresAuth ?? false;
}

export async function routeIntent(
  input: string,
  embedding?: number[],
): Promise<RouterResult> {
  const trimmed = input.trim();
  if (!trimmed) {
    return { kind: "rag", source: "fallback" };
  }

  const llmDecision = await routeWithLlm(trimmed);
  if (llmDecision) {
    return { ...llmDecision, source: "llm" };
  }

  let vector = embedding;
  if (!vector?.length) {
    const [generated] = await embedBatch([trimmed]);
    vector = generated ?? [];
  }

  if (vector?.length) {
    const selection = await routeByEmbedding(vector);
    if (selection) {
      return {
        kind: "tool",
        tool: selection.name,
        source: "embedding",
        score: selection.score,
      };
    }
  }

  const keywordTool = routeByKeyword(trimmed);
  if (keywordTool) {
    return { kind: "tool", tool: keywordTool, source: "fallback" };
  }

  return { kind: "rag", source: "fallback" };
}

async function routeWithLlm(input: string): Promise<RouterDecision | null> {
  if (!openai) return null;

  const toolLines = ROUTER_TOOLS.map((tool) => {
    const examples = tool.examples.map((ex) => `"${ex}"`).join(", ");
    return `${tool.name}: ${tool.description} Examples: ${examples}`;
  }).join("\n");

  const systemMessage =
    "You are a router for the StudyMate (Focus Squad) assistant. " +
    "Pick a tool only when the question requires live app data or personal account data. " +
    "Use {\"kind\":\"rag\"} for StudyMate feature explanations, how-to questions, navigation help, " +
    "or anything unclear. " +
    "Only use TOOL_LEADERBOARD_TOP_NOW for questions about the current/top leaderboard right now or today " +
    "without a specific date. If the user asks about a specific date, history, yesterday, or last week, use rag.";

  const userPrompt = [
    "Choose exactly one JSON object and nothing else.",
    "Valid outputs:",
    '- {"kind":"rag"}',
    '- {"kind":"tool","tool":"TOOL_NAME"}',
    "",
    "Tools:",
    toolLines,
    "",
    `User message: ${input}`,
  ].join("\n");

  try {
    const model = env.OPENAI_GEN_MODEL;
    if (shouldUseResponsesApi(model)) {
      const response = await openai.responses.create({
        model,
        temperature: 0,
        input: [
          { role: "system", content: systemMessage },
          { role: "user", content: userPrompt },
        ],
      });
      const text = extractResponseText(response);
      return parseRouterResponse(text);
    }

    const completion = await openai.chat.completions.create({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userPrompt },
      ],
    });
    const text = completion.choices?.[0]?.message?.content ?? "";
    return parseRouterResponse(text);
  } catch (error) {
    console.warn("[ai-chat] router LLM failed", error);
    return null;
  }
}

function parseRouterResponse(text: string): RouterDecision | null {
  if (!text) return null;
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const candidate = extractJson(cleaned);
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate);
    const result = RouterSchema.safeParse(parsed);
    if (result.success) return result.data;
  } catch {
    return null;
  }
  return null;
}

function extractJson(text: string) {
  if (!text) return "";
  if (text.startsWith("{") && text.endsWith("}")) return text;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return "";
  return text.slice(start, end + 1);
}

const KEYWORD_TOOL_RULES: Array<{
  tool: ToolName;
  patterns: RegExp[];
}> = [
  {
    tool: "TOOL_TODAYS_MANTRA",
    patterns: [
      /\btoday.?s mantra\b/i,
      /\bmantra for today\b/i,
      /\bdaily (mantra|motivation|quote)\b/i,
      /\bquote of the day\b/i,
      /\btoday.?s (motivation|quote)\b/i,
    ],
  },
  {
    tool: "TOOL_LIVE_SESSIONS",
    patterns: [
      /\blive now\b/i,
      /\bright now\b.*\blive\b/i,
      /\bwho is live\b/i,
      /\bsessions?\s+live\b.*\bnow\b/i,
      /\bjoinable sessions?\b/i,
      /\blive rooms?\b.*\bnow\b/i,
    ],
  },
  {
    tool: "TOOL_LEADERBOARD_TOP_NOW",
    patterns: [
      /\bleaderboard\b.*\b(now|today|current)\b/i,
      /\b(top|leaders?)\b.*\bleaderboard\b.*\b(now|today|current)\b/i,
      /\bleaderboard top\b.*\b(now|today|current)\b/i,
    ],
  },
  {
    tool: "TOOL_MY_TASKS_TODAY",
    patterns: [
      /\bmy\b.*\btasks?\b/i,
      /\btasks?\b.*\btoday\b.*\bme\b/i,
    ],
  },
  {
    tool: "TOOL_MY_NEXT_SESSION",
    patterns: [
      /\bmy next session\b/i,
      /\bnext booked session\b/i,
      /\bnext session i\b/i,
      /\bupcoming session\b.*\bme\b/i,
    ],
  },
  {
    tool: "TOOL_MY_STREAK",
    patterns: [
      /\bmy streak\b/i,
      /\bcurrent streak\b/i,
      /\bstreak status\b/i,
    ],
  },
  {
    tool: "TOOL_MY_WEEK_SUMMARY",
    patterns: [
      /\bmy week(ly)? summary\b/i,
      /\bwhat did i do this week\b/i,
      /\bthis week'?s progress\b/i,
    ],
  },
];

function routeByKeyword(input: string): ToolName | null {
  for (const rule of KEYWORD_TOOL_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(input))) {
      return rule.tool;
    }
  }
  return null;
}

async function routeByEmbedding(
  inputEmbedding: number[],
): Promise<{ name: ToolName; score: number } | null> {
  const intents = await getIntentEmbeddings();
  if (!intents.length) return null;

  let best: { name: ToolName; score: number } | null = null;
  for (const intent of intents) {
    const score = cosineSimilarity(inputEmbedding, intent.embedding);
    if (!best || score > best.score) {
      best = { name: intent.name, score };
    }
  }

  if (best && best.score >= TOOL_SIMILARITY_THRESHOLD) {
    return best;
  }
  return null;
}

async function getIntentEmbeddings(): Promise<IntentEmbedding[]> {
  if (!embeddingCache) {
    embeddingCache = (async () => {
      try {
        const intentTexts = ROUTER_TOOLS.map(
          (intent) =>
            `${intent.name}: ${intent.description} Examples: ${intent.examples.join(
              " | ",
            )}`,
        );
        const vectors = await embedBatch(intentTexts);
        return ROUTER_TOOLS.map((intent, index) => ({
          ...intent,
          embedding: vectors[index] ?? [],
        }));
      } catch (error) {
        console.error("[ai-chat] router embedding failed", error);
        return [];
      }
    })();
  }
  return embeddingCache;
}

function cosineSimilarity(a: number[], b: number[]) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB) || 1;
  return dot / denom;
}

function shouldUseResponsesApi(model: string) {
  const normalized = model.toLowerCase();
  return (
    normalized.includes("gpt-5") ||
    normalized.includes("gpt-4.1") ||
    normalized.includes("gpt-4o") ||
    normalized.includes("o1") ||
    normalized.includes("o3")
  );
}

function extractResponseText(response: any): string {
  if (!response) return "";
  if (Array.isArray(response.output_text) && response.output_text.length > 0) {
    return response.output_text.join("\n").trim();
  }
  if (Array.isArray(response.output)) {
    const pieces = response.output.flatMap((item: any) =>
      Array.isArray(item?.content) ? item.content : [],
    );
    const text = pieces
      .map((piece: any) => {
        if (typeof piece?.text === "string") return piece.text;
        if (typeof piece?.content === "string") return piece.content;
        if (Array.isArray(piece?.content)) {
          return piece.content
            .map((inner: any) => {
              if (typeof inner === "string") return inner;
              if (typeof inner?.text === "string") return inner.text;
              return "";
            })
            .filter(Boolean)
            .join("");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}
