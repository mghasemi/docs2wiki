import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { consolidate } from "../src/consolidate.js";
import type { ConsolidationInput } from "../src/types.js";

describe("report schema", () => {
  it("validates success and strict-failure report payloads", async () => {
    const schemaPath = resolve("report.schema.json");
    const schema = JSON.parse(await readFile(schemaPath, "utf8"));

    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const outDir = await mkdtemp(resolve(tmpdir(), "docs-unifier-report-schema-"));
    const input: ConsolidationInput = {
      sourceKind: "local",
      sourceValue: resolve("tests/fixtures/local-ordered"),
      title: "Schema Validation",
      outMarkdownPath: resolve(outDir, "combined.md"),
      outPdfPath: resolve(outDir, "combined.pdf"),
      reportJsonPath: resolve(outDir, "report.json"),
      maxPages: 50,
      maxDepth: 3,
      skipPdf: true,
      strictStaleFallback: false,
      useCache: true,
      cacheDir: resolve(outDir, ".cache"),
      sourceCacheTtlMinutes: 60,
    };

    const result = await consolidate(input);

    const successReport = {
      schemaVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      status: "success",
      input: {
        sourceKind: input.sourceKind,
        sourceValue: input.sourceValue,
        sources: input.sources ?? [{ sourceKind: input.sourceKind, sourceValue: input.sourceValue }],
        title: input.title,
        outMarkdownPath: input.outMarkdownPath,
        outPdfPath: input.outPdfPath,
        maxPages: input.maxPages,
        maxDepth: input.maxDepth,
        skipPdf: input.skipPdf,
        strictStaleFallback: Boolean(input.strictStaleFallback),
        useCache: input.useCache,
        cacheDir: input.cacheDir,
        sourceCacheTtlMinutes: input.sourceCacheTtlMinutes,
      },
      result,
    };

    const successValid = validate(successReport);
    expect(successValid).toBe(true);

    const strictFailureReport = {
      ...successReport,
      status: "failed-strict-stale-fallback",
      result: {
        ...result,
        sourceFetch: {
          adapter: "readthedocs",
          cacheStatus: "stale-fallback",
          detail: "Synthetic strict failure payload",
        },
        sourceCacheStats: {
          hits: 0,
          misses: 0,
          staleFallbacks: 1,
          disabled: 0,
        },
        warningDetails: [
          {
            code: "SOURCE_STALE_FALLBACK",
            message: "Synthetic strict failure warning",
            severity: "warning",
          },
        ],
        warnings: ["Synthetic strict failure warning"],
      },
    };

    const strictFailureValid = validate(strictFailureReport);
    expect(strictFailureValid).toBe(true);
  });
});
