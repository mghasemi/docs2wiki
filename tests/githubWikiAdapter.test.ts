import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { setSourceCache } from "../src/cache/sourceCache.js";
import { GitHubWikiAdapter } from "../src/adapters/githubWikiAdapter.js";
import {
  buildGitHubWikiSourceCacheKey,
  normalizeWikiUrl,
  parseSidebarOrder,
} from "../src/adapters/githubWikiAdapter.js";
import type { ConsolidationInput } from "../src/types.js";

vi.mock("../src/utils/process.js", () => {
  return {
    runCommand: vi.fn(async () => ({
      stdout: "",
      stderr: "simulated git clone failure",
      exitCode: 1,
    })),
  };
});

describe("GitHubWikiAdapter helpers", () => {
  it("normalizes common repo/wiki URL forms", () => {
    expect(normalizeWikiUrl("https://github.com/org/repo")).toBe(
      "https://github.com/org/repo.wiki.git",
    );
    expect(normalizeWikiUrl("https://github.com/org/repo.git")).toBe(
      "https://github.com/org/repo.wiki.git",
    );
    expect(normalizeWikiUrl("https://github.com/org/repo.wiki")).toBe(
      "https://github.com/org/repo.wiki.git",
    );
    expect(normalizeWikiUrl("https://github.com/org/repo.wiki.git")).toBe(
      "https://github.com/org/repo.wiki.git",
    );
  });

  it("parses sidebar markdown links in declared order", () => {
    const sidebar = [
      "- [Home](Home)",
      "- [Setup](setup-guide)",
      "- [Nested](docs/usage.md)",
      "- [External](https://example.com)",
    ].join("\n");

    expect(parseSidebarOrder(sidebar)).toEqual(["Home.md", "setup-guide.md", "docs/usage.md"]);
  });

  it("builds deterministic source cache key", () => {
    const url = "https://github.com/org/repo.wiki.git";
    expect(buildGitHubWikiSourceCacheKey(url, 200)).toBe("github-wiki:https://github.com/org/repo.wiki.git:200");
  });

  it("falls back to stale cache when clone fails", async () => {
    const wikiUrl = "https://github.com/org/repo.wiki.git";
    const cacheDir = await mkdtemp(resolve(tmpdir(), "docs-unifier-wiki-stale-cache-"));
    const key = buildGitHubWikiSourceCacheKey(wikiUrl, 50);

    await setSourceCache(
      cacheDir,
      key,
      [
        {
          id: "wiki:Home.md",
          title: "Home",
          sourceRef: "Home.md",
          body: "# Cached Home",
          format: "markdown",
          orderHint: 0,
        },
      ],
      -1,
    );

    const input: ConsolidationInput = {
      sourceKind: "github-wiki",
      sourceValue: "https://github.com/org/repo",
      title: "Wiki",
      outMarkdownPath: "out.md",
      outPdfPath: "out.pdf",
      reportJsonPath: undefined,
      maxPages: 50,
      maxDepth: 2,
      skipPdf: true,
      useCache: true,
      cacheDir,
      sourceCacheTtlMinutes: 60,
    };

    const adapter = new GitHubWikiAdapter();
    const fetched = await adapter.fetchPages(input);

    expect(fetched.adapter).toBe("github-wiki");
    expect(fetched.sourceCacheStatus).toBe("stale-fallback");
    expect((fetched.warnings ?? []).length).toBeGreaterThan(0);
    expect(fetched.pages.map((p) => p.title)).toEqual(["Home"]);
  });
});
