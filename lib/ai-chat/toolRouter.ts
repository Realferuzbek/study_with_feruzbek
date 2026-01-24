import { embedBatch } from "@/lib/rag/ai";

export type ToolName =
  | "getTodaysMantra"
  | "getLiveSessionsPublic"
  | "getLeaderboardTopNowPublic"
  | "getMyTasksToday"
  | "getMyNextBookedSession"
  | "getMyStreak"
  | "getMyWeekSummary";

type ToolIntent = {
  name: ToolName;
  description: string;
  examples: string[];
  requiresAuth: boolean;
};

const TOOL_INTENTS: ToolIntent[] = [
  {
    name: "getTodaysMantra",
    description:
      "Return the daily mantra from the Motivation Vault for today.",
    examples: [
      "what is today's mantra",
      "today's mantra",
      "daily mantra",
      "motivation vault quote",
      "mantra for today",
    ],
    requiresAuth: false,
  },
  {
    name: "getLiveSessionsPublic",
    description:
      "Show live study sessions happening now and the next upcoming sessions.",
    examples: [
      "what sessions are live now",
      "live sessions right now",
      "are any study rooms live",
      "upcoming focus sessions",
      "what is live in the live stream studio",
    ],
    requiresAuth: false,
  },
  {
    name: "getLeaderboardTopNowPublic",
    description:
      "Show the top users on the latest leaderboard snapshot right now.",
    examples: [
      "who is top on the leaderboard right now",
      "leaderboard top 3",
      "current leaderboard leaders",
      "top of the leaderboard",
      "leaderboard now",
    ],
    requiresAuth: false,
  },
  {
    name: "getMyTasksToday",
    description:
      "Return my tasks that are due or scheduled today in my account.",
    examples: [
      "what are my tasks today",
      "my tasks for today",
      "tasks due today",
      "what should I do today",
      "my task list today",
    ],
    requiresAuth: true,
  },
  {
    name: "getMyNextBookedSession",
    description:
      "Return the next focus session I have booked or created.",
    examples: [
      "when is my next booked session",
      "my next focus session",
      "next session I joined",
      "upcoming session I booked",
    ],
    requiresAuth: true,
  },
  {
    name: "getMyStreak",
    description: "Return my current and longest streak.",
    examples: ["what is my streak", "my streak status", "current streak"],
    requiresAuth: true,
  },
  {
    name: "getMyWeekSummary",
    description:
      "Summarize my last 7 days of activity, including tasks, focus minutes, and sessions.",
    examples: [
      "summarize what I did this week",
      "my weekly summary",
      "weekly progress",
      "what did I do in the last 7 days",
    ],
    requiresAuth: true,
  },
];

type IntentEmbedding = ToolIntent & { embedding: number[] };

const TOOL_SIMILARITY_THRESHOLD = 0.45;
let embeddingCache: Promise<IntentEmbedding[]> | null = null;

export function isToolAuthRequired(toolName: ToolName) {
  return TOOL_INTENTS.find((intent) => intent.name === toolName)?.requiresAuth;
}

export async function routeTool(
  inputEmbedding: number[],
): Promise<{ name: ToolName; score: number } | null> {
  if (!inputEmbedding?.length) return null;
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
        const intentTexts = TOOL_INTENTS.map(
          (intent) =>
            `${intent.name}: ${intent.description} Examples: ${intent.examples.join(
              " | ",
            )}`,
        );
        const vectors = await embedBatch(intentTexts);
        return TOOL_INTENTS.map((intent, index) => ({
          ...intent,
          embedding: vectors[index] ?? [],
        }));
      } catch (error) {
        console.error("[ai-chat] intent embedding failed", error);
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
