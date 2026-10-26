import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { consolidate } from "../src/consolidate.js";
import type { ConsolidationInput } from "../src/types.js";

describe("multi-source consolidation", () => {
  it("merges multiple local sources into one output", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "docs-unifier-multi-source-"));
    const sourceA = resolve(root, "source-a");
    const sourceB = resolve(root, "source-b");
    await mkdir(sourceA, { recursive: true });
    await mkdir(sourceB, { recursive: true });

    await writeFile(resolve(sourceA, "intro.md"), "# Intro A\n\nA content.", "utf8");
    await writeFile(resolve(sourceB, "guide.md"), "# Guide B\n\nB content.", "utf8");

    const outMd = resolve(root, "combined.md");
    const input: ConsolidationInput = {
      sourceKind: "local",
      sourceValue: sourceA,
      sources: [
        { sourceKind: "local", sourceValue: sourceA },
        { sourceKind: "local", sourceValue: sourceB },
      ],
      title: "Merged",
      outMarkdownPath: outMd,
      outPdfPath: resolve(root, "combined.pdf"),
      reportJsonPath: undefined,
      maxPages: 50,
      maxDepth: 3,
      skipPdf: true,
      strictStaleFallback: false,
      useCache: false,
      cacheDir: resolve(root, ".cache"),
      sourceCacheTtlMinutes: 60,
    };

    const result = await consolidate(input);
    expect(result.pagesProcessed).toBe(2);
    expect(result.sourceFetches).toHaveLength(2);
    expect(result.sourceFetches.every((f) => f.adapter === "local")).toBe(true);
  });
});
