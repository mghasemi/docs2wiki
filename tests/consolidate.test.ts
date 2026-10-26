import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { consolidate } from "../src/consolidate.js";
import type { ConsolidationInput } from "../src/types.js";

describe("consolidate", () => {
  it("generates one markdown output from local fixture when skipPdf is true", async () => {
    const fixture = resolve("tests/fixtures/local-ordered");
    const outMd = resolve(".tmp/combined.md");
    const cacheDir = await mkdtemp(resolve(tmpdir(), "docs-unifier-consolidate-cache-"));

    const input: ConsolidationInput = {
      sourceKind: "local",
      sourceValue: fixture,
      title: "Combined Fixture",
      outMarkdownPath: outMd,
      outPdfPath: resolve(".tmp/combined.pdf"),
      maxPages: 20,
      maxDepth: 4,
      skipPdf: true,
      useCache: true,
      cacheDir,
      sourceCacheTtlMinutes: 60,
    };

    const result = await consolidate(input);
    const markdown = await readFile(outMd, "utf8");

    expect(result.pagesProcessed).toBe(4);
    expect(result.pdfPath).toBeUndefined();
    expect(result.fromCache).toBe(false);
    expect(result.sourceFetch.adapter).toBe("local");
    expect(markdown).toContain("# Combined Fixture");
    expect(markdown).toContain("## Intro");
    expect(markdown).toContain("## Setup");
    expect(markdown).toContain("[setup](#setup)");
  });

  it("returns cache hit on unchanged repeated local run", async () => {
    const fixture = resolve("tests/fixtures/local-ordered");
    const cacheDir = await mkdtemp(resolve(tmpdir(), "docs-unifier-cache-"));
    const outMd = resolve(".tmp/cache-check.md");

    const input: ConsolidationInput = {
      sourceKind: "local",
      sourceValue: fixture,
      title: "Cache Fixture",
      outMarkdownPath: outMd,
      outPdfPath: resolve(".tmp/cache-check.pdf"),
      maxPages: 20,
      maxDepth: 4,
      skipPdf: true,
      useCache: true,
      cacheDir,
      sourceCacheTtlMinutes: 60,
    };

    const first = await consolidate(input);
    expect(first.fromCache).toBe(false);

    const original = await readFile(outMd, "utf8");
    await writeFile(outMd, `${original}\nCACHE-MARKER`, "utf8");

    const second = await consolidate(input);
    expect(second.fromCache).toBe(true);
    expect(second.sourceFetch.adapter).toBe("local");

    const after = await readFile(outMd, "utf8");
    expect(after).toContain("CACHE-MARKER");
  });
});
