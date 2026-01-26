import { promises as fs } from "fs";
import path from "path";

const DOCS_DIR = path.join(process.cwd(), "content", "ai");
const CACHE_TTL_MS = 5 * 60 * 1000;
const MIN_CHUNK_CHARS = 900;
const MAX_CHUNK_CHARS = 1200;

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "to",
  "of",
  "for",
  "in",
  "on",
  "at",
  "with",
  "about",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "what",
  "who",
  "when",
  "where",
  "why",
  "how",
  "can",
  "could",
  "should",
  "would",
  "i",
  "me",
  "my",
  "we",
  "our",
  "you",
  "your",
  "it",
  "its",
]);

type LocalDocChunk = {
  id: string;
  title: string;
  url: string | undefined;
  chunk: string;
  similarity: number;
};

type IndexedChunk = {
  id: string;
  title: string;
  url?: string;
  chunk: string;
  chunkIndex: number;
  indexedAt: string;
  normalized: string;
};

type LocalDocsIndex = {
  docsCount: number;
  chunks: IndexedChunk[];
  loadedAt: number;
};

let cachedIndex: LocalDocsIndex | null = null;

export async function getLocalDocContexts(
  query: string,
): Promise<LocalDocChunk[]> {
  const index = await loadLocalDocs();
  if (!query || !query.trim()) return [];
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];
  const tokens = tokenize(normalizedQuery);
  if (!tokens.length) return [];

  const phrases = buildPhrases(tokens);
  const scored = index.chunks
    .map((chunk) => {
      const similarity = scoreChunk(
        chunk.normalized,
        tokens,
        phrases,
        normalizedQuery,
      );
      return similarity > 0
        ? {
            id: chunk.id,
            title: chunk.title,
            url: chunk.url,
            chunk: chunk.chunk,
            similarity,
          }
        : null;
    })
    .filter((entry): entry is LocalDocChunk => Boolean(entry))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 6);

  return scored;
}

export async function getLocalDocStats(): Promise<{
  files: number;
  chunks: number;
}> {
  const index = await loadLocalDocs();
  return { files: index.docsCount, chunks: index.chunks.length };
}

export async function getLocalDocIndex(): Promise<LocalDocsIndex> {
  return loadLocalDocs();
}

async function loadLocalDocs(): Promise<LocalDocsIndex> {
  const now = Date.now();
  if (cachedIndex && now - cachedIndex.loadedAt < CACHE_TTL_MS) {
    return cachedIndex;
  }

  let files: string[] = [];
  try {
    files = await listMarkdownFiles(DOCS_DIR);
  } catch {
    cachedIndex = { docsCount: 0, chunks: [], loadedAt: now };
    return cachedIndex;
  }

  const chunks: IndexedChunk[] = [];
  let docsCount = 0;
  for (const filePath of files) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const cleaned = stripFrontMatter(raw);
      const docTitle = extractMarkdownTitle(cleaned, filePath);
      const relative = path.relative(DOCS_DIR, filePath).replace(/\\/g, "/");
      const slug = relative.replace(/\.md$/i, "");
      const baseUrl = `local://content/ai/${slug}`;
      const stat = await fs.stat(filePath);
      const indexedAt = stat.mtime.toISOString();

      const sections = splitByHeadings(cleaned);
      const chunkBodies =
        sections.length > 0
          ? sections.flatMap((section) =>
              chunkSection(section, docTitle).map((chunk) => ({
                title: section.title ?? docTitle,
                text: chunk,
              })),
            )
          : chunkText(cleaned).map((chunk) => ({
              title: docTitle,
              text: chunk,
            }));

      docsCount += 1;
      chunkBodies.forEach((chunk, index) => {
        const normalized = normalizeText(chunk.text);
        if (!normalized) return;
        chunks.push({
          id: `${baseUrl}#${index}`,
          title: chunk.title,
          url: baseUrl,
          chunk: chunk.text,
          chunkIndex: index,
          indexedAt,
          normalized,
        });
      });
    } catch {
      // ignore local doc failures
    }
  }

  cachedIndex = {
    docsCount,
    chunks,
    loadedAt: now,
  };
  return cachedIndex;
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  let entries: Array<import("fs").Dirent> = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: string[] = [];
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await listMarkdownFiles(fullPath);
        results.push(...nested);
        return;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        results.push(fullPath);
      }
    }),
  );
  return results;
}

type Section = {
  title: string | null;
  body: string;
};

function splitByHeadings(content: string): Section[] {
  const lines = content.split(/\r?\n/);
  const sections: Section[] = [];
  let currentTitle: string | null = null;
  let buffer: string[] = [];
  let sawHeading = false;

  const push = () => {
    const body = buffer.join("\n").trim();
    if (body) {
      sections.push({ title: currentTitle, body });
    }
    buffer = [];
  };

  for (const line of lines) {
    const match = line.match(/^#{1,3}\s+(.+)$/);
    if (match) {
      sawHeading = true;
      push();
      currentTitle = match[1].trim();
      continue;
    }
    buffer.push(line);
  }
  push();

  if (!sawHeading) return [];
  return sections;
}

function chunkSection(section: Section, fallbackTitle: string): string[] {
  const heading = section.title ?? fallbackTitle;
  const body = section.body.trim();
  if (!body) return [];
  const combined = heading ? `${heading}\n${body}` : body;
  return chunkText(combined);
}

function chunkText(content: string): string[] {
  const normalized = normalizeWhitespace(content);
  if (!normalized) return [];
  if (normalized.length <= MAX_CHUNK_CHARS) {
    return [normalized];
  }

  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim());
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (!paragraph) continue;
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= MAX_CHUNK_CHARS) {
      current = candidate;
      continue;
    }
    if (current.length >= MIN_CHUNK_CHARS) {
      pushCurrent();
      current = paragraph;
      continue;
    }
    const pieces = splitBySize(paragraph, MIN_CHUNK_CHARS, MAX_CHUNK_CHARS);
    for (const piece of pieces) {
      const withCurrent = current ? `${current} ${piece}` : piece;
      if (withCurrent.length <= MAX_CHUNK_CHARS) {
        current = withCurrent;
      } else {
        pushCurrent();
        current = piece;
      }
    }
  }

  pushCurrent();
  return chunks.length ? chunks : splitBySize(normalized, MIN_CHUNK_CHARS, MAX_CHUNK_CHARS);
}

function splitBySize(
  text: string,
  minSize: number,
  maxSize: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxSize) {
      current = candidate;
      continue;
    }
    if (current.length >= minSize) {
      chunks.push(current.trim());
      current = word;
      continue;
    }
    chunks.push(current.trim());
    current = word;
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }
  return chunks.filter(Boolean);
}

function stripFrontMatter(content: string) {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  return content.slice(end + 4);
}

function extractMarkdownTitle(content: string, filePath: string) {
  const match = content.match(/^#\s+(.+)$/m);
  if (match && match[1]) return match[1].trim();
  return path.basename(filePath).replace(/\.md$/i, "");
}

function normalizeWhitespace(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  const matches = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const tokens = matches
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
  return Array.from(new Set(tokens));
}

function buildPhrases(tokens: string[]): string[] {
  const limited = tokens.slice(0, 12);
  const phrases: string[] = [];
  for (let i = 0; i < limited.length - 1; i += 1) {
    phrases.push(`${limited[i]} ${limited[i + 1]}`);
  }
  for (let i = 0; i < limited.length - 2; i += 1) {
    phrases.push(`${limited[i]} ${limited[i + 1]} ${limited[i + 2]}`);
  }
  return phrases;
}

function scoreChunk(
  normalizedChunk: string,
  tokens: string[],
  phrases: string[],
  normalizedQuery: string,
) {
  if (!normalizedChunk) return 0;
  let overlap = 0;
  tokens.forEach((token) => {
    if (normalizedChunk.includes(token)) {
      overlap += 1;
    }
  });
  if (!overlap) return 0;

  let score = overlap / tokens.length;
  let phraseBoost = 0;

  if (normalizedQuery.length > 6 && normalizedChunk.includes(normalizedQuery)) {
    phraseBoost += 0.35;
  }

  let phraseMatches = 0;
  for (const phrase of phrases) {
    if (normalizedChunk.includes(phrase)) {
      phraseMatches += 1;
    }
  }
  if (phraseMatches > 0) {
    phraseBoost += Math.min(0.3, phraseMatches * 0.08);
  }

  score = Math.min(1, score + phraseBoost);
  return score;
}
