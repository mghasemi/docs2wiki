import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { RawPage } from "../types.js";

export interface SourceCacheLookup {
  pages: RawPage[];
  expired: boolean;
}

interface SourceCacheEntry {
  expiresAt: string;
  pages: RawPage[];
}

interface SourceCacheIndex {
  entries: Record<string, SourceCacheEntry>;
}

const SOURCE_CACHE_FILE = "source-cache.json";

async function readIndex(path: string): Promise<SourceCacheIndex> {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text) as SourceCacheIndex;
    return parsed.entries ? parsed : { entries: {} };
  } catch {
    return { entries: {} };
  }
}

async function writeIndex(path: string, index: SourceCacheIndex): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(index, null, 2), "utf8");
}

export async function getSourceCacheEntry(cacheDir: string, key: string): Promise<SourceCacheLookup | undefined> {
  const path = resolve(cacheDir, SOURCE_CACHE_FILE);
  const index = await readIndex(path);
  const entry = index.entries[key];
  if (!entry) {
    return undefined;
  }

  return {
    pages: entry.pages,
    expired: new Date(entry.expiresAt).getTime() < Date.now(),
  };
}

export async function setSourceCache(
  cacheDir: string,
  key: string,
  pages: RawPage[],
  ttlMinutes: number,
): Promise<void> {
  const path = resolve(cacheDir, SOURCE_CACHE_FILE);
  const index = await readIndex(path);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  index.entries[key] = {
    expiresAt,
    pages,
  };
  await writeIndex(path, index);
}
