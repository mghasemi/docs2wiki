# Report Schema Guide

## Purpose

The run report is an optional JSON artifact produced via --report-json. It is intended for CI pipelines, observability, and automated quality checks.

Schema file:
- report.schema.json

Current schema version:
- 1.0.0

## Top-Level Fields

Required top-level fields:
- schemaVersion
- generatedAt
- status
- input
- result

status values:
- success
- failed-strict-stale-fallback

## Input Section

The input object captures effective runtime configuration:
- sourceKind
- sourceValue
- sources (for multi-source runs)
- title
- outMarkdownPath
- outPdfPath
- maxPages
- maxDepth
- skipPdf
- strictStaleFallback
- useCache
- cacheDir
- sourceCacheTtlMinutes

## Result Section

The result object captures outcome details:
- markdownPath
- pdfPath (optional)
- pagesProcessed
- warnings (string messages)
- warningDetails (structured warning entries)
- fromCache
- sourceFetch (primary/legacy)
- sourceFetches (per-source list)
- sourceCacheStats

## Warning Details

Each warning entry contains:
- code
- message
- severity (warning | error)

Example warning codes:
- RST_PANDOC_UNAVAILABLE
- ASSET_LINK_REWRITTEN
- SOURCE_STALE_FALLBACK
- SOURCE_STALE_FALLBACK_READTHEDOCS
- SOURCE_STALE_FALLBACK_GITHUB_WIKI

## Source Cache Stats

sourceCacheStats includes:
- hits
- misses
- staleFallbacks
- disabled

These counters are aggregated across all sources in multi-source runs.

## Validation in CI

Schema validation test command:

```powershell
npm run test:report-schema
```

Full test suite command:

```powershell
npm run test
```

## Compatibility Guidance

When changing report payload shape:
1. Bump schemaVersion.
2. Update report.schema.json.
3. Update tests/reportSchema.test.ts.
4. Document migration notes in changelog/release notes.
