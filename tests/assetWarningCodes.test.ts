import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { consolidate } from "../src/consolidate.js";
import type { ConsolidationInput } from "../src/types.js";

describe("asset warning codes", () => {
  it("emits ASSET_LINK_REWRITTEN warning code for rewritten asset targets", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "docs-unifier-asset-code-"));
    const docsDir = resolve(root, "docs");
    const guideDir = resolve(docsDir, "guide");

    await mkdir(guideDir, { recursive: true });
    await writeFile(
      resolve(guideDir, "intro.md"),
      "# Intro\n\n![Logo](../images/logo.png)\n",
      "utf8",
    );

    const input: ConsolidationInput = {
      sourceKind: "local",
      sourceValue: docsDir,
      title: "Asset Warning",
      outMarkdownPath: resolve(root, "combined.md"),
      outPdfPath: resolve(root, "combined.pdf"),
      reportJsonPath: undefined,
      maxPages: 20,
      maxDepth: 2,
      skipPdf: true,
      strictStaleFallback: false,
      useCache: false,
      cacheDir: resolve(root, ".cache"),
      sourceCacheTtlMinutes: 60,
    };

    const result = await consolidate(input);
    expect(result.warningDetails.some((w) => w.code === "ASSET_LINK_REWRITTEN")).toBe(true);
    expect(result.warnings.some((w) => w.includes("Asset link rewritten to virtual assets path"))).toBe(true);
  });
});
