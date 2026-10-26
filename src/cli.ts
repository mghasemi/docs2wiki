#!/usr/bin/env node
import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { consolidate } from "./consolidate.js";
import { ConsolidationInput, SourceKind, SourceSpec } from "./types.js";

function parseSourceSpec(value: string): SourceSpec {
  const index = value.indexOf("=");
  if (index <= 0 || index === value.length - 1) {
    throw new Error(`Invalid --source format: ${value}. Expected kind=value.`);
  }

  const rawKind = value.slice(0, index).trim().toLowerCase();
  const rawValue = value.slice(index + 1).trim();

  const kind: SourceKind =
    rawKind === "github-wiki" || rawKind === "wiki"
      ? "github-wiki"
      : rawKind === "local"
        ? "local"
        : rawKind === "readthedocs" || rawKind === "rtd"
          ? "readthedocs"
          : (() => {
              throw new Error(`Unsupported source kind in --source: ${rawKind}`);
            })();

  return {
    sourceKind: kind,
    sourceValue: rawValue,
  };
}

function resolveSources(opts: Record<string, unknown>): SourceSpec[] {
  const set: SourceSpec[] = [
    { sourceKind: "github-wiki" as const, sourceValue: (opts.githubWiki as string | undefined) ?? "" },
    { sourceKind: "local" as const, sourceValue: (opts.local as string | undefined) ?? "" },
    { sourceKind: "readthedocs" as const, sourceValue: (opts.rtd as string | undefined) ?? "" },
  ].filter((x) => x.sourceValue.length > 0);

  const extraSources = (opts.source as string[] | undefined) ?? [];
  for (const spec of extraSources) {
    set.push(parseSourceSpec(spec));
  }

  if (set.length === 0) {
    throw new Error("Provide at least one source: --github-wiki, --local, --rtd, or --source kind=value.");
  }

  return set;
}

async function writeReport(path: string, report: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2), "utf8");
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("docs-unifier")
    .description("Consolidate one documentation source into one Markdown and one PDF")
    .requiredOption("--title <title>", "Document title")
    .option("--github-wiki <url>", "GitHub wiki URL or repository URL")
    .option("--local <path>", "Local docs folder path")
    .option("--rtd <url>", "ReadTheDocs URL to crawl")
    .option(
      "--source <kind=value>",
      "Additional source (repeatable). kind is one of github-wiki|wiki|local|readthedocs|rtd",
      (value: string, previous: string[] = []) => [...previous, value],
      [],
    )
    .option("--out-md <path>", "Output markdown file", "combined.md")
    .option("--out-pdf <path>", "Output PDF file", "combined.pdf")
    .option("--report-json <path>", "Optional JSON report file path")
    .option("--max-pages <number>", "Maximum pages to ingest", "500")
    .option("--max-depth <number>", "Maximum crawl depth for web sources", "6")
    .option("--cache-dir <path>", "Cache directory", ".cache")
    .option("--source-cache-ttl-minutes <number>", "Source-fetch cache TTL in minutes", "60")
    .option("--strict-stale-fallback", "Fail when stale source cache fallback is used", false)
    .option("--no-cache", "Disable incremental cache usage")
    .option("--skip-pdf", "Skip PDF generation", false);

  program.parse(process.argv);
  const opts = program.opts<Record<string, unknown>>();

  const sources = resolveSources(opts);
  const primarySource = sources[0];

  const input: ConsolidationInput = {
    sourceKind: primarySource.sourceKind,
    sourceValue: primarySource.sourceValue,
    sources,
    title: opts.title as string,
    outMarkdownPath: resolve(opts.outMd as string),
    outPdfPath: resolve(opts.outPdf as string),
    reportJsonPath: opts.reportJson ? resolve(opts.reportJson as string) : undefined,
    maxPages: Number(opts.maxPages ?? 500),
    maxDepth: Number(opts.maxDepth ?? 6),
    skipPdf: Boolean(opts.skipPdf),
    strictStaleFallback: Boolean(opts.strictStaleFallback),
    useCache: Boolean(opts.cache),
    cacheDir: resolve(opts.cacheDir as string),
    sourceCacheTtlMinutes: Number(opts.sourceCacheTtlMinutes ?? 60),
  };

  const result = await consolidate(input);
  process.stdout.write(`Done. Pages: ${result.pagesProcessed}\n`);
  process.stdout.write(`Cache: ${result.fromCache ? "hit" : "miss"}\n`);
  process.stdout.write(
    `Source fetch: adapter=${result.sourceFetch.adapter} cacheStatus=${result.sourceFetch.cacheStatus}${result.sourceFetch.detail ? ` detail=${result.sourceFetch.detail}` : ""}\n`,
  );
  if (result.sourceFetches.length > 1) {
    process.stdout.write("Source fetches:\n");
    for (const fetch of result.sourceFetches) {
      process.stdout.write(
        `- adapter=${fetch.adapter} cacheStatus=${fetch.cacheStatus}${fetch.detail ? ` detail=${fetch.detail}` : ""}\n`,
      );
    }
  }
  process.stdout.write(
    `Source cache stats: hits=${result.sourceCacheStats.hits} misses=${result.sourceCacheStats.misses} staleFallbacks=${result.sourceCacheStats.staleFallbacks} disabled=${result.sourceCacheStats.disabled}\n`,
  );
  process.stdout.write(`Markdown: ${result.markdownPath}\n`);
  if (result.pdfPath) {
    process.stdout.write(`PDF: ${result.pdfPath}\n`);
  }
  if (result.warnings.length > 0) {
    process.stdout.write(`Warnings: ${result.warnings.length}\n`);
  }

  const strictViolation = Boolean(input.strictStaleFallback) && result.sourceCacheStats.staleFallbacks > 0;

  const report = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    status: strictViolation ? "failed-strict-stale-fallback" : "success",
    input: {
      sourceKind: input.sourceKind,
      sourceValue: input.sourceValue,
      sources: input.sources,
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

  if (input.reportJsonPath) {
    await writeReport(input.reportJsonPath, report);
    process.stdout.write(`Report JSON: ${input.reportJsonPath}\n`);
  }

  if (strictViolation) {
    process.stderr.write("Error: strict stale fallback mode is enabled and stale cached source data was used.\n");
    process.exitCode = 2;
    return;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
