import * as cheerio from "cheerio";
import { promises as fs } from "fs";
import path from "path";
import { embedBatch } from "./ai";
import { env, numeric, arrays } from "./env";
import { SnippetMeta, vector } from "./vector";

const MAX_CHARS_PER_CHUNK = 1200;
const MIN_CHARS_PER_CHUNK = 400;
const CHUNK_OVERLAP = 150;
const BASE_CHARS_PER_CHUNK = MAX_CHARS_PER_CHUNK - CHUNK_OVERLAP;

const allowedPaths = sanitizePaths(arrays.ALLOWED);
const blockedPaths = sanitizePaths(arrays.BLOCKED);

export type IndexStats = {
  pagesFetched: number;
  chunksIndexed: number;
  startedAt: string;
  finishedAt: string;
};

export async function reindexSite(): Promise<IndexStats> {
  const startedAt = new Date().toISOString();
  const base = normalize(env.SITE_BASE_URL);
  if (!base) {
    throw new Error("Invalid SITE_BASE_URL");
  }
  const { host } = new URL(base);

  const queue = new Set<string>();
  const visited = new Set<string>();

  const fromSitemap = await getSitemapUrls(base);
  if (fromSitemap.length) {
    fromSitemap.forEach((u) => {
      const normalized = normalize(u);
      if (normalized) queue.add(normalized);
    });
  } else {
    queue.add(base);
  }

  let depth = 0;
  let pagesFetched = 0;
  let chunksIndexed = 0;

  while (
    queue.size &&
    pagesFetched < numeric.MAX_PAGES &&
    depth <= numeric.MAX_DEPTH
  ) {
    const currentBatch = Array.from(queue).slice(0, 12);
    currentBatch.forEach((u) => queue.delete(u));

    await Promise.all(
      currentBatch.map(async (url) => {
        if (!url || visited.has(url)) return;
        visited.add(url);

        if (
          !shouldVisit(url, host) ||
          pagesFetched >= numeric.MAX_PAGES ||
          depth > numeric.MAX_DEPTH
        ) {
          return;
        }

        try {
          const res = await fetch(url, { next: { revalidate: 0 } });
          if (!res.ok) return;

          const html = await res.text();
          const { title, text } = extractTextAndTitle(html);
          const chunks = chunk(text);
          if (!chunks.length) return;

          const embeddings = await embedBatch(chunks);
          const now = new Date().toISOString();
          const payloads = embeddings.map((vec, i) => ({
            id: `${url}#${i}`,
            vector: vec,
            metadata: {
              url,
              title,
              chunk: chunks[i],
              chunkIndex: i,
              indexedAt: now,
            } as SnippetMeta,
          }));
          await vector.upsert(payloads);
          pagesFetched += 1;
          chunksIndexed += chunks.length;

          const $ = cheerio.load(html);
          $("a[href]").each((_, el) => {
            const href = $(el).attr("href");
            if (!href) return;
            const absolute = normalize(new URL(href, url).toString());
            if (
              absolute &&
              shouldVisit(absolute, host) &&
              !visited.has(absolute)
            ) {
              queue.add(absolute);
            }
          });
        } catch {
          // ignore fetch/index failures for individual pages
        }
      }),
    );

    depth += 1;
  }

  const localStats = await indexLocalDocs();
  pagesFetched += localStats.docsIndexed;
  chunksIndexed += localStats.chunksIndexed;

  const finishedAt = new Date().toISOString();
  return { pagesFetched, chunksIndexed, startedAt, finishedAt };
}

async function getSitemapUrls(base: string): Promise<string[]> {
  const candidates = new Set<string>();
  const root = base.replace(/\/$/, "");

  const sitemapUrl = `${root}/sitemap.xml`;
  const seenSitemaps = new Set<string>();
  const sitemapEntries = await extractSitemapUrls(sitemapUrl, seenSitemaps);
  sitemapEntries.forEach((url) => candidates.add(url));

  if (!candidates.size) {
    const robotsUrl = `${root}/robots.txt`;
    const robots = await fetchText(robotsUrl);
    if (robots) {
      const matches = robots
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.toLowerCase().startsWith("sitemap:"))
        .map((line) => line.split(":")[1]?.trim())
        .filter(Boolean);

      await Promise.all(
        matches.map(async (url) => {
          const entries = await extractSitemapUrls(url!, seenSitemaps);
          entries.forEach((entry) => candidates.add(entry));
        }),
      );
    }
  }

  return Array.from(candidates)
    .map((url) => normalize(url))
    .filter((url): url is string => Boolean(url));
}

async function extractSitemapUrls(
  url: string,
  visited: Set<string>,
): Promise<string[]> {
  if (!url || visited.has(url)) return [];
  visited.add(url);
  const xml = await fetchText(url);
  if (!xml) return [];
  const $ = cheerio.load(xml, { xmlMode: true });

  if ($("sitemapindex").length) {
    const nested = $("sitemap > loc")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    const results = await Promise.all(
      nested.map((child) => extractSitemapUrls(child, visited)),
    );
    return results.flat();
  }

  const urls = new Set<string>();
  $("url > loc, loc").each((_, el) => {
    const loc = $(el).text().trim();
    if (loc && !loc.endsWith(".xml")) {
      urls.add(loc);
    }
  });
  return Array.from(urls);
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractTextAndTitle(html: string) {
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim() || "Untitled";
  $("script, style, noscript, iframe").remove();
  const bodyText = $("body").text();
  const text = bodyText
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
  return { title, text };
}

async function indexLocalDocs(): Promise<{
  docsIndexed: number;
  chunksIndexed: number;
}> {
  const docsDir = path.join(process.cwd(), "content", "ai");
  let entries: Array<import("fs").Dirent> = [];
  try {
    entries = await fs.readdir(docsDir, { withFileTypes: true });
  } catch {
    return { docsIndexed: 0, chunksIndexed: 0 };
  }

  const markdownFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name);

  if (!markdownFiles.length) {
    return { docsIndexed: 0, chunksIndexed: 0 };
  }

  let docsIndexed = 0;
  let chunksIndexed = 0;

  for (const filename of markdownFiles) {
    try {
      const filePath = path.join(docsDir, filename);
      const raw = await fs.readFile(filePath, "utf8");
      const cleaned = stripFrontMatter(raw);
      const title = extractMarkdownTitle(cleaned, filename);
      const slug = filename.replace(/\.md$/i, "");
      const baseUrl = `local://content/ai/${slug}`;
      const text = cleaned.replace(/\s+/g, " ").trim();
      const chunks = chunk(text);
      if (!chunks.length) continue;

      const embeddings = await embedBatch(chunks);
      const now = new Date().toISOString();
      const payloads = embeddings.map((vec, i) => ({
        id: `${baseUrl}#${i}`,
        vector: vec,
        metadata: {
          url: baseUrl,
          title,
          chunk: chunks[i],
          chunkIndex: i,
          indexedAt: now,
        } as SnippetMeta,
      }));
      await vector.upsert(payloads);
      docsIndexed += 1;
      chunksIndexed += chunks.length;
    } catch {
      // ignore local doc failures
    }
  }

  return { docsIndexed, chunksIndexed };
}

function stripFrontMatter(content: string) {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  return content.slice(end + 4);
}

function extractMarkdownTitle(content: string, fallbackFilename: string) {
  const match = content.match(/^#\s+(.+)$/m);
  if (match && match[1]) return match[1].trim();
  return fallbackFilename.replace(/\.md$/i, "");
}

function chunk(text: string): string[] {
  if (!text) return [];

  const normalized = text.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
  if (!normalized) return [];

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const baseChunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed.length) {
      baseChunks.push(trimmed);
    }
    current = "";
  };

  for (const sentence of sentences) {
    if (!sentence) continue;
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= BASE_CHARS_PER_CHUNK) {
      current = candidate;
      continue;
    }

    if (current.length >= MIN_CHARS_PER_CHUNK) {
      pushCurrent();
      current = sentence;
      continue;
    }

    if (sentence.length > BASE_CHARS_PER_CHUNK) {
      const pieces = splitByLength(sentence, BASE_CHARS_PER_CHUNK);
      for (const piece of pieces) {
        const withCurrent = current ? `${current} ${piece}` : piece;
        if (withCurrent.length <= BASE_CHARS_PER_CHUNK) {
          current = withCurrent;
        } else {
          if (current) pushCurrent();
          current = piece;
          pushCurrent();
          current = "";
        }
      }
      continue;
    }

    current = candidate;
  }

  pushCurrent();

  const merged: string[] = [];
  for (const entry of baseChunks) {
    if (
      merged.length &&
      merged[merged.length - 1].length < MIN_CHARS_PER_CHUNK &&
      merged[merged.length - 1].length + entry.length <= BASE_CHARS_PER_CHUNK
    ) {
      merged[merged.length - 1] =
        `${merged[merged.length - 1]} ${entry}`.trim();
    } else {
      merged.push(entry);
    }
  }

  if (!merged.length) return [];

  const overlapped: string[] = [];
  merged.forEach((entry, index) => {
    if (index === 0) {
      overlapped.push(entry.slice(0, MAX_CHARS_PER_CHUNK));
      return;
    }
    const previous = overlapped[index - 1] ?? "";
    const tail = previous.slice(-CHUNK_OVERLAP);
    const maxBody = Math.max(MAX_CHARS_PER_CHUNK - tail.length - 1, 0);
    const trimmedBody =
      entry.length > maxBody ? entry.slice(0, maxBody) : entry;
    const candidate =
      tail.trim().length && trimmedBody
        ? `${tail} ${trimmedBody}`.trim()
        : (tail + trimmedBody).trim();
    overlapped.push(candidate.slice(0, MAX_CHARS_PER_CHUNK));
  });

  return overlapped;
}

function splitByLength(input: string, size: number) {
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    parts.push(input.slice(cursor, cursor + size));
    cursor += size;
  }
  return parts.map((p) => p.trim()).filter(Boolean);
}

function shouldVisit(urlString: string, host: string): boolean {
  try {
    const url = new URL(urlString);
    if (url.host !== host) return false;
    if (!["http:", "https:"].includes(url.protocol)) return false;

    const path = cleanPathname(url.pathname);
    if (blockedPaths.some((prefix) => path.startsWith(prefix))) return false;
    if (!allowedPaths.length) return true;
    return allowedPaths.some((prefix) => path.startsWith(prefix));
  } catch {
    return false;
  }
}

function normalize(input: string): string {
  try {
    const url = new URL(input);
    url.hash = "";
    const pathname =
      url.pathname !== "/" && url.pathname.endsWith("/")
        ? url.pathname.slice(0, -1)
        : url.pathname || "/";
    url.pathname = pathname || "/";
    return url.toString();
  } catch {
    return "";
  }
}

function sanitizePaths(paths: string[]): string[] {
  return paths
    .map((p) => p.replace(/^["']|["']$/g, "").trim())
    .filter(Boolean)
    .map((p) => (p.startsWith("/") ? p : `/${p}`));
}

function cleanPathname(pathname: string) {
  if (!pathname) return "/";
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}
