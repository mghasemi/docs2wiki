# Operations Runbook

## Prerequisites

Runtime requirements:
- Node.js 20+
- git in PATH (GitHub Wiki sources)
- wkhtmltopdf in PATH (PDF output)
- pandoc optional (better RST conversion)

## Common Commands

For representative console/report outputs, see docs/examples.md.

Build:

```powershell
npm run build
```

Run tests:

```powershell
npm run test
```

Run report schema test only:

```powershell
npm run test:report-schema
```

## Typical Runs

Single local source:

```powershell
node dist/cli.js --title "Docs" --local .\docs --out-md .\out\combined.md --out-pdf .\out\combined.pdf
```

Single ReadTheDocs source:

```powershell
node dist/cli.js --title "RTD" --rtd "https://project.readthedocs.io/en/latest/" --skip-pdf --out-md .\out\rtd.md
```

Multi-source merge:

```powershell
node dist/cli.js --title "All Docs" --source local=.\docs --source rtd=https://project.readthedocs.io/en/latest/ --skip-pdf --out-md .\out\all.md
```

## Caching Controls

Use default cache:

```powershell
node dist/cli.js --title "Docs" --local .\docs --cache-dir .\.cache
```

Disable cache:

```powershell
node dist/cli.js --title "Docs" --local .\docs --no-cache
```

Change source cache TTL:

```powershell
node dist/cli.js --title "Docs" --local .\docs --source-cache-ttl-minutes 30
```

## Strict Stale Fallback

Enable strict mode:

```powershell
node dist/cli.js --title "Docs" --rtd "https://project.readthedocs.io/en/latest/" --strict-stale-fallback --report-json .\out\run.json
```

Behavior:
- If stale source fallback is used, process exits with code 2.
- Report status is failed-strict-stale-fallback.

## Report Output

Generate report:

```powershell
node dist/cli.js --title "Docs" --local .\docs --skip-pdf --report-json .\out\run-report.json
```

Validate report schema in CI:
- report.schema.json
- npm run test:report-schema

## Troubleshooting

Issue: git clone failures for wiki sources
- Verify repository/wiki URL.
- Verify git is installed and in PATH.
- Check network/authentication.

Issue: PDF generation fails
- Ensure wkhtmltopdf is installed.
- Use --skip-pdf for markdown-only runs.

Issue: RST warnings present
- Install pandoc.
- Confirm pandoc is reachable in PATH.

Issue: strict mode failures
- Inspect warningDetails and sourceFetches in report.
- Restore source connectivity or run without strict mode.

## Monitoring Signals

Watch in report/result:
- sourceCacheStats.staleFallbacks > 0
- warningDetails entries with SOURCE_STALE_FALLBACK*
- repeated RST_PANDOC_UNAVAILABLE
