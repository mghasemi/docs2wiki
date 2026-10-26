import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import fg from "fast-glob";
import { getSourceCacheEntry, setSourceCache } from "../cache/sourceCache.js";
import { loadMkdocsProject, type MkdocsProject } from "./mkdocs.js";
import { ConsolidationInput, RawPage, SourceAdapter, SourceFetchResult } from "../types.js";

function titleFromPath(filePath: string): string {
  const name = basename(filePath, extname(filePath));
  return name.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function buildLocalFingerprint(rootDir: string, files: string[], mkdocs: MkdocsProject | null): Promise<string> {
  const digest = createHash("sha256");
  const sorted = [...files].sort((a, b) => a.localeCompare(b));

  for (const file of sorted) {
    const info = await stat(resolve(rootDir, file));
    digest.update(`${file}:${info.size}:${Math.floor(info.mtimeMs)}\n`);
  }

  if (mkdocs) {
    digest.update(`mkdocs:${mkdocs.docsDir}\n`);
    digest.update(await readFile(mkdocs.configPath));
  }

  return digest.digest("hex");
}

export class LocalAdapter implements SourceAdapter {
  async fetchPages(input: ConsolidationInput): Promise<SourceFetchResult> {
    const projectRoot = resolve(input.sourceValue);
    const mkdocs = await loadMkdocsProject(projectRoot);
    const rootDir = mkdocs?.docsDir ?? projectRoot;
    const files = await fg(["**/*.md", "**/*.markdown", "**/*.html", "**/*.htm", "**/*.rst"], {
      cwd: rootDir,
      onlyFiles: true,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
    });

    const fingerprint = await buildLocalFingerprint(rootDir, files, mkdocs);
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

    const known = new Set(files);
    const navEntries = (mkdocs?.nav ?? []).filter((entry) => known.has(entry.path));
    const order = [...new Set(navEntries.map((e) => e.path))];
    for (const file of [...files].sort((a, b) => a.localeCompare(b))) {
      if (!order.includes(file)) order.push(file);
    }
    const rank = new Map<string, number>();
    order.forEach((file, i) => rank.set(file, i));
    const navTitles = new Map<string, string>();
    for (const entry of navEntries) {
      if (entry.title && !navTitles.has(entry.path)) navTitles.set(entry.path, entry.title);
    }

    const pages: RawPage[] = [];
    for (const file of files) {
      const abs = resolve(rootDir, file);
      const content = await readFile(abs, "utf8");
      const ext = extname(file).toLowerCase();

      const format: RawPage["format"] =
        ext === ".html" || ext === ".htm" ? "html" : ext === ".rst" ? "rst" : "markdown";

      pages.push({
        id: `local:${file}`,
        title: navTitles.get(file) ?? titleFromPath(file),
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
