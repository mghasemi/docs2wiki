# Architecture

## Overview

docs-unifier is a TypeScript CLI that ingests documentation from one or more sources and emits:
- one consolidated Markdown document
- one consolidated PDF document (unless skipped)

Primary flow:
1. Parse CLI arguments into a ConsolidationInput model.
2. Resolve one or more source adapters.
3. Fetch raw pages from each source.
4. Normalize content to Markdown and harden links/assets.
5. Assemble one merged Markdown document with TOC.
6. Optionally render PDF.
7. Emit structured run metadata and optional JSON report.

## Source Adapters

Supported sources:
- GitHub Wiki adapter
- Local filesystem adapter
- ReadTheDocs adapter

Each adapter returns a SourceFetchResult containing:
- pages
- adapter id
- source cache status
- optional detail message
- optional warning details

## Caching Model

Two caching layers are used:

1. Source fetch cache
- Stores adapter-level raw page payloads.
- Supports TTL.
- Can return stale fallback for some remote sources.

2. Consolidation output cache
- Stores output metadata keyed by source digest and run options.
- Skips regeneration when source digest is unchanged.

## Multi-Source Merge

When multiple sources are provided:
1. Sources are fetched in CLI argument order.
2. Each source's pages are offset in ordering to preserve source grouping.
3. Pages are concatenated and normalized into one merged output.

Run result includes:
- sourceFetch (primary/legacy)
- sourceFetches (full per-source list)

## Normalization

Normalization pipeline:
1. Convert inputs to Markdown (Markdown passthrough, HTML conversion, RST conversion).
2. Clean markdown whitespace and structure.
3. Harden links:
- normalize relative document links
- rewrite relative asset/image links to ./assets/... virtual paths
4. Attach warnings when fallback behavior occurs.

## Rendering

Markdown is assembled into a unified document with:
- title
- generated timestamp
- table of contents
- per-page sections and source references

PDF generation uses wkhtmltopdf over generated HTML.

## Errors and Strict Mode

Strict stale fallback mode can fail a run when stale source cache fallback is used.
- Exit code: 2
- Report status: failed-strict-stale-fallback

## Core Files

- src/cli.ts
- src/consolidate.ts
- src/adapters/
- src/pipeline/
- src/cache/
- report.schema.json
