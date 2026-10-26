import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { RawPage, WarningDetail } from "../types.js";

interface CacheEntry {
  sourceDigest: string;
  pagesProcessed: number;
  warnings: string[];
  warningDetails: WarningDetail[];
  updatedAt: string;
}

interface CacheIndex {
  entries: Record<string, CacheEntry>;
}

const CACHE_FILE = "cache-index.json";

async function readCacheFile(path: string): Promise<CacheIndex> {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text) as CacheIndex;
    return parsed.entries ? parsed : { entries: {} };
  } catch {
    return { entries: {} };
  }
}

async function writeCacheFile(path: string, index: CacheIndex): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(index, null, 2), "utf8");
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function buildCacheKey(input: {
  sourceKind: string;
  sourceValue: string;
  sources?: Array<{ sourceKind: string; sourceValue: string }>;
  title: string;
  outMarkdownPath: string;
  outPdfPath: string;
  maxPages: number;
  maxDepth: number;
  skipPdf: boolean;
}): string {
  return hashText(
    JSON.stringify({
      sourceKind: input.sourceKind,
      sourceValue: input.sourceValue,
      sources: input.sources ?? null,
      title: input.title,
      outMarkdownPath: input.outMarkdownPath,
      outPdfPath: input.outPdfPath,
      maxPages: input.maxPages,
      maxDepth: input.maxDepth,
      skipPdf: input.skipPdf,
    }),
  );
}

export function buildSourceDigest(rawPages: RawPage[]): string {
  const serial = rawPages.map((p) => ({
    id: p.id,
    title: p.title,
    sourceRef: p.sourceRef,
    body: p.body,
    format: p.format,
    orderHint: p.orderHint ?? null,
  }));
  return hashText(JSON.stringify(serial));
}

export async function getCacheEntry(cacheDir: string, key: string): Promise<CacheEntry | undefined> {
  const indexPath = resolve(cacheDir, CACHE_FILE);
  const index = await readCacheFile(indexPath);
  return index.entries[key];
}

export async function setCacheEntry(cacheDir: string, key: string, entry: CacheEntry): Promise<void> {
  const indexPath = resolve(cacheDir, CACHE_FILE);
  const index = await readCacheFile(indexPath);
  index.entries[key] = entry;
  await writeCacheFile(indexPath, index);
}
