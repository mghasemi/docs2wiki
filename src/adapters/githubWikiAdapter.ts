import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { getSourceCacheEntry, setSourceCache } from "../cache/sourceCache.js";
import { ConsolidationInput, RawPage, SourceAdapter, SourceFetchResult } from "../types.js";
import { runCommand } from "../utils/process.js";

export function normalizeWikiUrl(input: string): string {
  if (input.endsWith(".wiki.git")) {
    return input;
  }
  if (input.endsWith(".wiki")) {
    return `${input}.git`;
  }
  if (input.endsWith(".git")) {
    return input.replace(/\.git$/, ".wiki.git");
  }
  return `${input}.wiki.git`;
}

function titleFromWikiFile(name: string): string {
  return basename(name, extname(name)).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function parseSidebarOrder(sidebarMarkdown: string): string[] {
  const result: string[] = [];
  const regex = /\[[^\]]+\]\(([^)]+)\)/g;

  let match: RegExpExecArray | null = regex.exec(sidebarMarkdown);
  while (match) {
    const target = match[1].trim();
    if (!target.startsWith("http")) {
      const page = target.replace(/^\//, "").replace(/\s+/g, "-");
      const withExt = page.toLowerCase().endsWith(".md") ? page : `${page}.md`;
      result.push(withExt);
    }
    match = regex.exec(sidebarMarkdown);
  }

  return result;
}

export function buildGitHubWikiSourceCacheKey(wikiUrl: string, maxPages: number): string {
  return `github-wiki:${wikiUrl}:${maxPages}`;
}

export class GitHubWikiAdapter implements SourceAdapter {
  async fetchPages(input: ConsolidationInput): Promise<SourceFetchResult> {
    const wikiUrl = normalizeWikiUrl(input.sourceValue);
    const sourceCacheKey = buildGitHubWikiSourceCacheKey(wikiUrl, input.maxPages);
    const cacheEntry = input.useCache ? await getSourceCacheEntry(input.cacheDir, sourceCacheKey) : undefined;

    if (cacheEntry && !cacheEntry.expired) {
      return {
        pages: cacheEntry.pages.slice(0, input.maxPages),
        adapter: "github-wiki",
        sourceCacheStatus: "hit",
        detail: "Source pages loaded from GitHub wiki adapter cache.",
      };
    }

    const checkoutDir = await mkdtemp(join(tmpdir(), "docs-unifier-wiki-"));

    const clone = await runCommand("git", ["clone", "--depth", "1", wikiUrl, checkoutDir]);
    if (clone.exitCode !== 0) {
      if (cacheEntry) {
        return {
          pages: cacheEntry.pages.slice(0, input.maxPages),
          adapter: "github-wiki",
          sourceCacheStatus: "stale-fallback",
          detail: "Git clone failed; reused stale cached GitHub wiki pages.",
          warnings: [
            {
              code: "SOURCE_STALE_FALLBACK_GITHUB_WIKI",
              message: "GitHub wiki clone failed; stale source cache was used.",
              severity: "warning",
            },
          ],
        };
      }
      throw new Error(`Failed to clone wiki repo: ${clone.stderr || clone.stdout}`);
    }

    const entries = await readdir(checkoutDir, { withFileTypes: true });
    const mdFiles = entries
      .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".md")
      .map((entry) => entry.name)
      .filter((name) => name !== "_Footer.md" && name !== "_Sidebar.md");

    const sidebarPath = resolve(checkoutDir, "_Sidebar.md");
    let sidebarOrder: string[] = [];
    try {
      const sidebar = await readFile(sidebarPath, "utf8");
      sidebarOrder = parseSidebarOrder(sidebar);
    } catch {
      sidebarOrder = [];
    }

    const rank = new Map<string, number>();
    sidebarOrder.forEach((name, i) => rank.set(name, i));

    const ordered = [...mdFiles].sort((a, b) => {
      const av = rank.get(a) ?? Number.MAX_SAFE_INTEGER;
      const bv = rank.get(b) ?? Number.MAX_SAFE_INTEGER;
      if (av !== bv) {
        return av - bv;
      }
      return a.localeCompare(b);
    });

    const pages: RawPage[] = [];
    for (const file of ordered.slice(0, input.maxPages)) {
      const body = await readFile(resolve(checkoutDir, file), "utf8");
      pages.push({
        id: `wiki:${file}`,
        title: titleFromWikiFile(file),
        sourceRef: file,
        body,
        format: "markdown",
        orderHint: rank.get(file) ?? Number.MAX_SAFE_INTEGER,
      });
    }

    if (input.useCache) {
      await setSourceCache(input.cacheDir, sourceCacheKey, pages, input.sourceCacheTtlMinutes);
    }

    return {
      pages,
      adapter: "github-wiki",
      sourceCacheStatus: input.useCache ? "miss" : "disabled",
      detail: input.useCache
        ? "GitHub wiki cloned and parsed, then cached."
        : "Source cache disabled; GitHub wiki cloned and parsed directly.",
    };
  }
}
