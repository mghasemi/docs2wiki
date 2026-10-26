# docs-unifier

A TypeScript CLI that ingests documentation from one or more sources and produces:
- one consolidated Markdown file
- one consolidated PDF file

Supported source types:
- GitHub Wiki URL
- Local docs folder (.md, .html, .rst)
- ReadTheDocs URL (full in-domain crawl)

## Documentation

- Docs index: [docs/index.md](docs/index.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- Report schema guide: [docs/report-schema.md](docs/report-schema.md)
- Operations runbook: [docs/operations.md](docs/operations.md)
- Examples and expected output: [docs/examples.md](docs/examples.md)

## Requirements

- Node.js 20+
- `git` in PATH (required for GitHub Wiki)
- `wkhtmltopdf` in PATH (required for PDF generation unless using `--skip-pdf`)
- Optional: `pandoc` in PATH for better `.rst` conversion

## Install

```powershell
npm install
npm run build
```

## Quickstart

Run a local folder to one Markdown and one PDF:

```powershell
node dist/cli.js --title "My Docs" --local .\docs --out-md .\out\combined.md --out-pdf .\out\combined.pdf
```

Run markdown-only:

```powershell
node dist/cli.js --title "My Docs" --local .\docs --skip-pdf --out-md .\out\combined.md
```

Run with JSON report output:

```powershell
node dist/cli.js --title "My Docs" --local .\docs --skip-pdf --report-json .\out\run-report.json
```

## Test

```powershell
npm run test
```

Schema-only test:

```powershell
npm run test:report-schema
```

## Common usage

Single-source local:

```powershell
node dist/cli.js --title "My Docs" --local .\docs --out-md .\out\combined.md --out-pdf .\out\combined.pdf
```

Single-source wiki:

```powershell
node dist/cli.js --title "Project Wiki" --github-wiki "https://github.com/OWNER/REPO" --out-md .\out\wiki.md --out-pdf .\out\wiki.pdf
```

Single-source ReadTheDocs:

```powershell
node dist/cli.js --title "RTD Export" --rtd "https://project.readthedocs.io/en/latest/" --max-pages 300 --max-depth 5 --out-md .\out\rtd.md --out-pdf .\out\rtd.pdf
```

Multi-source merge:

```powershell
node dist/cli.js --title "All Docs" --source local=.\docs --source rtd=https://project.readthedocs.io/en/latest/ --skip-pdf --out-md .\out\all.md
```

Enable strict stale fallback protection:

```powershell
node dist/cli.js --title "Docs" --rtd "https://project.readthedocs.io/en/latest/" --strict-stale-fallback --report-json .\out\run-report.json
```

## Notes

- Use `--skip-pdf` when `wkhtmltopdf` is not installed.
- Use `--report-json` to emit schema-versioned CI-friendly run metadata.
- Detailed option references and troubleshooting are in [docs/operations.md](docs/operations.md).

