# Examples and Expected Output

This page provides practical command examples with representative output snippets.

## Example 1: Successful Local Run

Command:

```powershell
node dist/cli.js --title "Docs" --local .\docs --skip-pdf --report-json .\out\run-success.json
```

Representative console output:

```text
Done. Pages: 42
Cache: miss
Source fetch: adapter=local cacheStatus=miss detail=Source pages read from filesystem and cached.
Source cache stats: hits=0 misses=1 staleFallbacks=0 disabled=0
Markdown: C:\repo\out\combined.md
Warnings: 1
Report JSON: C:\repo\out\run-success.json
```

Representative report fields:

```json
{
  "schemaVersion": "1.0.0",
  "status": "success",
  "result": {
    "sourceFetch": {
      "adapter": "local",
      "cacheStatus": "miss"
    },
    "sourceCacheStats": {
      "hits": 0,
      "misses": 1,
      "staleFallbacks": 0,
      "disabled": 0
    }
  }
}
```

## Example 2: Multi-Source Success

Command:

```powershell
node dist/cli.js --title "All Docs" --source local=.\docs --source rtd=https://project.readthedocs.io/en/latest/ --skip-pdf --report-json .\out\run-multi.json
```

Representative console output:

```text
Done. Pages: 128
Cache: miss
Source fetch: adapter=local cacheStatus=hit detail=Source pages loaded from local adapter cache.
Source fetches:
- adapter=local cacheStatus=hit detail=Source pages loaded from local adapter cache.
- adapter=readthedocs cacheStatus=miss detail=ReadTheDocs pages crawled from network and cached.
Source cache stats: hits=1 misses=1 staleFallbacks=0 disabled=0
Markdown: C:\repo\out\all.md
Report JSON: C:\repo\out\run-multi.json
```

Representative report fields:

```json
{
  "status": "success",
  "input": {
    "sources": [
      { "sourceKind": "local", "sourceValue": ".\\docs" },
      { "sourceKind": "readthedocs", "sourceValue": "https://project.readthedocs.io/en/latest/" }
    ]
  },
  "result": {
    "sourceFetches": [
      { "adapter": "local", "cacheStatus": "hit" },
      { "adapter": "readthedocs", "cacheStatus": "miss" }
    ]
  }
}
```

## Example 3: Strict Stale Fallback Failure

Command:

```powershell
node dist/cli.js --title "Docs" --rtd "https://project.readthedocs.io/en/latest/" --strict-stale-fallback --skip-pdf --report-json .\out\run-strict.json
```

Representative console output when stale fallback is used:

```text
Done. Pages: 15
Cache: miss
Source fetch: adapter=readthedocs cacheStatus=stale-fallback detail=Network crawl produced no pages; reused stale cached ReadTheDocs pages.
Source cache stats: hits=0 misses=0 staleFallbacks=1 disabled=0
Markdown: C:\repo\out\combined.md
Warnings: 2
Report JSON: C:\repo\out\run-strict.json
Error: strict stale fallback mode is enabled and stale cached source data was used.
```

Outcome:
- Process exit code is 2.
- Report status is failed-strict-stale-fallback.

Representative report fields:

```json
{
  "status": "failed-strict-stale-fallback",
  "result": {
    "warningDetails": [
      { "code": "SOURCE_STALE_FALLBACK_READTHEDOCS", "severity": "warning" },
      { "code": "SOURCE_STALE_FALLBACK", "severity": "warning" }
    ],
    "sourceFetch": {
      "adapter": "readthedocs",
      "cacheStatus": "stale-fallback"
    },
    "sourceCacheStats": {
      "staleFallbacks": 1
    }
  }
}
```

## Example 4: Common Warning Interpretation

If pandoc is not installed and .rst files are processed, a warning can appear:

```text
Pandoc not found or failed; .rst content embedded as raw block.
```

Mapped warning code:
- RST_PANDOC_UNAVAILABLE

If a relative image link is rewritten to virtual assets path, warning can appear:

```text
Asset link rewritten to virtual assets path: ../images/logo.png -> ./assets/images/logo.png
```

Mapped warning code:
- ASSET_LINK_REWRITTEN
