import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalAdapter } from "../src/adapters/localAdapter.js";
import type { ConsolidationInput } from "../src/types.js";

describe("LocalAdapter", () => {
  it("uses mkdocs nav order and detects formats", async () => {
    const fixture = resolve("tests/fixtures/local-ordered");
    const input: ConsolidationInput = {
      sourceKind: "local",
      sourceValue: fixture,
      title: "Fixture",
      outMarkdownPath: resolve(".tmp/local.md"),
      outPdfPath: resolve(".tmp/local.pdf"),
      maxPages: 50,
      maxDepth: 3,
      skipPdf: true,
      useCache: true,
      cacheDir: resolve(".cache"),
      sourceCacheTtlMinutes: 60,
    };

    const adapter = new LocalAdapter();
    const fetched = await adapter.fetchPages(input);
    const pages = fetched.pages;

    expect(pages.length).toBe(4);
    expect(fetched.adapter).toBe("local");
    expect(fetched.sourceCacheStatus === "hit" || fetched.sourceCacheStatus === "miss").toBe(true);
    expect(pages.map((p) => p.sourceRef)).toEqual([
      "intro.md",
      "guide/setup.md",
      "api.html",
      "notes.rst",
    ]);

    const formats = new Map(pages.map((p) => [p.sourceRef, p.format]));
    expect(formats.get("intro.md")).toBe("markdown");
    expect(formats.get("api.html")).toBe("html");
    expect(formats.get("notes.rst")).toBe("rst");
  });

  it("invalidates local source cache when files change", async () => {
    const fixture = resolve("tests/fixtures/local-ordered");
    const tempFixture = await mkdtemp(resolve(tmpdir(), "docs-unifier-local-fixture-"));
    const intro = resolve(tempFixture, "intro.md");
    const guideDir = resolve(tempFixture, "guide");

    await writeFile(resolve(tempFixture, "mkdocs.yml"), await readFile(resolve(fixture, "mkdocs.yml"), "utf8"), "utf8");
    await writeFile(intro, await readFile(resolve(fixture, "intro.md"), "utf8"), "utf8");
    await writeFile(resolve(tempFixture, "api.html"), await readFile(resolve(fixture, "api.html"), "utf8"), "utf8");
    await writeFile(resolve(tempFixture, "notes.rst"), await readFile(resolve(fixture, "notes.rst"), "utf8"), "utf8");
    await mkdir(guideDir, { recursive: true });
    await writeFile(
      resolve(guideDir, "setup.md"),
      await readFile(resolve(fixture, "guide/setup.md"), "utf8"),
      "utf8",
    );

    const cacheDir = await mkdtemp(resolve(tmpdir(), "docs-unifier-local-cache-"));
    const input: ConsolidationInput = {
      sourceKind: "local",
      sourceValue: tempFixture,
      title: "Fixture",
      outMarkdownPath: resolve(".tmp/local.md"),
      outPdfPath: resolve(".tmp/local.pdf"),
      maxPages: 50,
      maxDepth: 3,
      skipPdf: true,
      useCache: true,
      cacheDir,
      sourceCacheTtlMinutes: 60,
    };

    const adapter = new LocalAdapter();
    const before = await adapter.fetchPages(input);
    expect(before.adapter).toBe("local");
    expect(before.sourceCacheStatus).toBe("miss");
    const introBefore = before.pages.find((p) => p.sourceRef === "intro.md");
    expect(introBefore?.body).toContain("See [setup]");

    await writeFile(intro, "# Intro\n\nChanged content for cache invalidation test.\n", "utf8");
    const after = await adapter.fetchPages(input);
    expect(after.adapter).toBe("local");
    expect(after.sourceCacheStatus).toBe("miss");
    const introAfter = after.pages.find((p) => p.sourceRef === "intro.md");
    expect(introAfter?.body).toContain("Changed content");
  });
});
