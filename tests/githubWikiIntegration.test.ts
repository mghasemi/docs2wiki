import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GitHubWikiAdapter } from "../src/adapters/githubWikiAdapter.js";
import type { ConsolidationInput } from "../src/types.js";

function runGit(args: string[], cwd?: string): void {
  execFileSync("git", args, {
    cwd,
    stdio: "pipe",
  });
}

describe("GitHubWikiAdapter integration", () => {
  it("clones a local wiki repo and respects sidebar ordering", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "docs-unifier-wiki-integration-"));
    const bareWiki = resolve(root, "sample.wiki.git");
    const work = resolve(root, "work");

    runGit(["init", "--bare", bareWiki]);
    runGit(["clone", bareWiki, work]);
    runGit(["-C", work, "config", "user.email", "test@example.com"]);
    runGit(["-C", work, "config", "user.name", "Docs Unifier Test"]);

    await writeFile(resolve(work, "Home.md"), "# Home\n\nWelcome.\n", "utf8");
    await writeFile(resolve(work, "Setup.md"), "# Setup\n\nInstall steps.\n", "utf8");
    await writeFile(resolve(work, "_Sidebar.md"), "- [Setup](Setup)\n- [Home](Home)\n", "utf8");

    await mkdir(resolve(work, ".gitkeep-dir"), { recursive: true });

    runGit(["-C", work, "add", "."]);
    runGit(["-C", work, "commit", "-m", "seed wiki"]);
    runGit(["-C", work, "push", "origin", "HEAD"]);

    const input: ConsolidationInput = {
      sourceKind: "github-wiki",
      sourceValue: bareWiki,
      title: "Wiki",
      outMarkdownPath: resolve(root, "out.md"),
      outPdfPath: resolve(root, "out.pdf"),
      reportJsonPath: undefined,
      maxPages: 20,
      maxDepth: 1,
      skipPdf: true,
      strictStaleFallback: false,
      useCache: false,
      cacheDir: resolve(root, ".cache"),
      sourceCacheTtlMinutes: 60,
    };

    const adapter = new GitHubWikiAdapter();
    const fetched = await adapter.fetchPages(input);

    expect(fetched.adapter).toBe("github-wiki");
    expect(fetched.sourceCacheStatus).toBe("disabled");
    expect(fetched.pages.map((p) => p.title)).toEqual(["Setup", "Home"]);
  });
});
