import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import fg from "fast-glob";
import yaml from "js-yaml";
import { getSourceCacheEntry, setSourceCache } from "../cache/sourceCache.js";
import { ConsolidationInput, RawPage, SourceAdapter, SourceFetchResult } from "../types.js";

interface MkdocsConfig {
  nav?: unknown[];
}

function titleFromPath(filePath: string): string {
  const name = basename(filePath, extname(filePath));
  return name.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function flattenMkdocsNav(nav: unknown[] | undefined, files: string[], out: string[]): void {
  if (!nav) {
    return;
  }

  for (const item of nav) {
    if (typeof item === "string") {
      out.push(item.replace(/^\.\//, ""));
      continue;
    }

    if (typeof item === "object" && item) {
      for (const value of Object.values(item as Record<string, unknown>)) {
        if (typeof value === "string") {
          out.push(value.replace(/^\.\//, ""));
        } else if (Array.isArray(value)) {
          flattenMkdocsNav(value, files, out);
        }
      }
    }
  }

  for (const file of files) {
    if (!out.includes(file)) {
      out.push(file);
    }
  }
}

async function readMkdocsOrder(rootDir: string, files: string[]): Promise<string[] | null> {
  const mkdocsPath = resolve(rootDir, "mkdocs.yml");
  try {
    const text = await readFile(mkdocsPath, "utf8");
    const config = yaml.load(text) as MkdocsConfig;
    const ordered: string[] = [];
    flattenMkdocsNav(config?.nav, files, ordered);
    return ordered;
  } catch {
    return null;
  }
}

async function buildLocalFingerprint(rootDir: string, files: string[]): Promise<string> {
  const digest = createHash("sha256");
  const sorted = [...files].sort((a, b) => a.localeCompare(b));

  for (const file of sorted) {
    const info = await stat(resolve(rootDir, file));
    digest.update(`${file}:${info.size}:${Math.floor(info.mtimeMs)}\n`);
  }

  try {
    const mkdocsInfo = await stat(resolve(rootDir, "mkdocs.yml"));
    digest.update(`mkdocs.yml:${mkdocsInfo.size}:${Math.floor(mkdocsInfo.mtimeMs)}\n`);
  } catch {
    // mkdocs file is optional
  }

  return digest.digest("hex");
}

export class LocalAdapter implements SourceAdapter {
  async fetchPages(input: ConsolidationInput): Promise<SourceFetchResult> {
    const rootDir = resolve(input.sourceValue);
    const files = await fg(["**/*.md", "**/*.markdown", "**/*.html", "**/*.htm", "**/*.rst"], {
      cwd: rootDir,
      onlyFiles: true,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
    });

    const fingerprint = await buildLocalFingerprint(rootDir, files);
    const sourceCacheKey = `local:${rootDir}:${input.maxPages}:${fingerprint}`;

    if (input.useCache) {
      const cached = await getSourceCacheEntry(input.cacheDir, sourceCacheKey);
      if (cached && !cached.expired) {
        return {
          pages: cached.pages.slice(0, input.maxPages),
          adapter: "local",
          sourceCacheStatus: "hit",
          detail: "Source pages loaded from local adapter cache.",
        };
      }
    }

    const order = (await readMkdocsOrder(rootDir, files)) ?? [...files].sort((a, b) => a.localeCompare(b));
    const rank = new Map<string, number>();
    order.forEach((file, i) => rank.set(file, i));

    const pages: RawPage[] = [];
    for (const file of files) {
      const abs = resolve(rootDir, file);
      const content = await readFile(abs, "utf8");
      const ext = extname(file).toLowerCase();

      const format: RawPage["format"] =
        ext === ".html" || ext === ".htm" ? "html" : ext === ".rst" ? "rst" : "markdown";

      pages.push({
        id: `local:${file}`,
        title: titleFromPath(file),
        sourceRef: file,
        body: content,
        format,
        orderHint: rank.get(file) ?? Number.MAX_SAFE_INTEGER,
      });
    }

    pages.sort((a, b) => (a.orderHint ?? 0) - (b.orderHint ?? 0));
    const limited = pages.slice(0, input.maxPages);

    if (input.useCache) {
      await setSourceCache(input.cacheDir, sourceCacheKey, limited, input.sourceCacheTtlMinutes);
    }

    return {
      pages: limited,
      adapter: "local",
      sourceCacheStatus: input.useCache ? "miss" : "disabled",
      detail: input.useCache
        ? "Source pages read from filesystem and cached."
        : "Source cache disabled; pages read directly from filesystem.",
    };
  }
}
