import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ConsolidationInput, SourceAdapter } from "../src/types.js";

const mockFetchPages = vi.fn();

vi.mock("../src/adapters/index.js", () => {
  return {
    pickAdapter: () => ({
      fetchPages: mockFetchPages,
    }) as SourceAdapter,
  };
});

import { consolidate } from "../src/consolidate.js";

describe("consolidate warnings", () => {
  it("adds stale fallback warning when source cache fallback is used", async () => {
    mockFetchPages.mockResolvedValue({
      pages: [
        {
          id: "mock:1",
          title: "Mock",
          sourceRef: "mock.md",
          body: "# Mock\n\ncontent",
          format: "markdown",
          orderHint: 0,
        },
      ],
      adapter: "local",
      sourceCacheStatus: "stale-fallback",
      detail: "Mock stale fallback",
    });

    const outDir = await mkdtemp(resolve(tmpdir(), "docs-unifier-consolidate-warning-"));
    const input: ConsolidationInput = {
      sourceKind: "local",
      sourceValue: outDir,
      title: "Mock",
      outMarkdownPath: resolve(outDir, "combined.md"),
      outPdfPath: resolve(outDir, "combined.pdf"),
      reportJsonPath: undefined,
      maxPages: 20,
      maxDepth: 2,
      skipPdf: true,
      useCache: false,
      cacheDir: resolve(outDir, ".cache"),
      sourceCacheTtlMinutes: 60,
    };

    const result = await consolidate(input);
    const markdown = await readFile(input.outMarkdownPath, "utf8");

    expect(result.sourceCacheStats.staleFallbacks).toBe(1);
    expect(result.sourceFetch.cacheStatus).toBe("stale-fallback");
    expect(result.sourceFetch.detail).toBe("Mock stale fallback");
    expect(result.warnings.some((w) => w.includes("stale source cache fallback"))).toBe(true);
    expect(result.warningDetails.some((w) => w.code === "SOURCE_STALE_FALLBACK")).toBe(true);
    expect(markdown).toContain("# Mock");
  });
});
