import { pickAdapter } from "./adapters/index.js";
import { buildCacheKey, buildSourceDigest, getCacheEntry, setCacheEntry } from "./cache/outputCache.js";
import { assembleMarkdown } from "./pipeline/assemble.js";
import { normalizePages } from "./pipeline/normalize.js";
import { renderPdf } from "./pipeline/pdf.js";
import { ConsolidationInput, ConsolidationResult, RawPage, SourceFetchResult, WarningDetail } from "./types.js";
import { writeTextFile } from "./utils/fs.js";

function warningCodeForMessage(message: string): string {
  if (message.includes("Pandoc not found or failed")) {
    return "RST_PANDOC_UNAVAILABLE";
  }

  if (message.includes("Asset link rewritten to virtual assets path")) {
    return "ASSET_LINK_REWRITTEN";
  }

  if (message.includes("stale source cache fallback")) {
    return "SOURCE_STALE_FALLBACK";
  }

  return "NORMALIZATION_WARNING";
}

export async function consolidate(input: ConsolidationInput): Promise<ConsolidationResult> {
  const sources =
    input.sources && input.sources.length > 0
      ? input.sources
      : [{ sourceKind: input.sourceKind, sourceValue: input.sourceValue }];

  const fetchedBySource: SourceFetchResult[] = [];
  const rawPages: RawPage[] = [];

  const sourceCacheStats = {
    hits: 0,
    misses: 0,
    staleFallbacks: 0,
    disabled: 0,
  };

  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i];
    const sourceInput: ConsolidationInput = {
      ...input,
      sourceKind: source.sourceKind,
      sourceValue: source.sourceValue,
      sources: undefined,
    };

    const adapter = pickAdapter(sourceInput);
    const fetched = await adapter.fetchPages(sourceInput);
    fetchedBySource.push(fetched);

    sourceCacheStats.hits += fetched.sourceCacheStatus === "hit" ? 1 : 0;
    sourceCacheStats.misses += fetched.sourceCacheStatus === "miss" ? 1 : 0;
    sourceCacheStats.staleFallbacks += fetched.sourceCacheStatus === "stale-fallback" ? 1 : 0;
    sourceCacheStats.disabled += fetched.sourceCacheStatus === "disabled" ? 1 : 0;

    const offset = i * 1_000_000;
    for (const page of fetched.pages) {
      rawPages.push({
        ...page,
        orderHint: (page.orderHint ?? 0) + offset,
      });
    }
  }

  if (rawPages.length === 0) {
    throw new Error("No pages were discovered for the provided source.");
  }

  const cacheKey = buildCacheKey(input);
  const sourceDigest = buildSourceDigest(rawPages);
  if (input.useCache) {
    const entry = await getCacheEntry(input.cacheDir, cacheKey);
    if (entry && entry.sourceDigest === sourceDigest) {
      const fetchedWarnings = fetchedBySource.flatMap((f) => f.warnings ?? []);
      const adapterWarningMessages = fetchedWarnings.map((w) => w.message);
      const mergedWarnings = [...entry.warnings, ...adapterWarningMessages];
      const mergedWarningDetails = [...(entry.warningDetails ?? []), ...fetchedWarnings];
      return {
        markdownPath: input.outMarkdownPath,
        pdfPath: input.skipPdf ? undefined : input.outPdfPath,
        pagesProcessed: entry.pagesProcessed,
        warnings: [...new Set(mergedWarnings)],
        warningDetails: mergedWarningDetails,
        fromCache: true,
        sourceFetch: {
          adapter: fetchedBySource[0].adapter,
          cacheStatus: fetchedBySource[0].sourceCacheStatus,
          detail: fetchedBySource[0].detail,
        },
        sourceFetches: fetchedBySource.map((f) => ({
          adapter: f.adapter,
          cacheStatus: f.sourceCacheStatus,
          detail: f.detail,
        })),
        sourceCacheStats,
      };
    }
  }

  const normalized = await normalizePages(rawPages);
  const combinedMarkdown = assembleMarkdown(input.title, normalized);
  await writeTextFile(input.outMarkdownPath, combinedMarkdown);

  const warnings = normalized.flatMap((p) => p.warnings);
  const warningDetails: WarningDetail[] = normalized.flatMap((p) =>
    p.warnings.map((message) => ({
      code: warningCodeForMessage(message),
      message,
      severity: "warning" as const,
    })),
  );

  const fetchedWarnings = fetchedBySource.flatMap((f) => f.warnings ?? []);
  if (fetchedWarnings.length > 0) {
    warnings.push(...fetchedWarnings.map((w) => w.message));
    warningDetails.push(...fetchedWarnings);
  }

  if (sourceCacheStats.staleFallbacks > 0) {
    const staleMessage =
      "Used stale source cache fallback because remote source retrieval failed. Output may be outdated.";
    warnings.push(staleMessage);
    warningDetails.push({
      code: "SOURCE_STALE_FALLBACK",
      message: staleMessage,
      severity: "warning",
    });
  }

  if (!input.skipPdf) {
    await renderPdf(combinedMarkdown, input.outPdfPath);
  }

  if (input.useCache) {
    await setCacheEntry(input.cacheDir, cacheKey, {
      sourceDigest,
      pagesProcessed: normalized.length,
      warnings,
      warningDetails,
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    markdownPath: input.outMarkdownPath,
    pdfPath: input.skipPdf ? undefined : input.outPdfPath,
    pagesProcessed: normalized.length,
    warnings,
    warningDetails,
    fromCache: false,
    sourceFetch: {
      adapter: fetchedBySource[0].adapter,
      cacheStatus: fetchedBySource[0].sourceCacheStatus,
      detail: fetchedBySource[0].detail,
    },
    sourceFetches: fetchedBySource.map((f) => ({
      adapter: f.adapter,
      cacheStatus: f.sourceCacheStatus,
      detail: f.detail,
    })),
    sourceCacheStats,
  };
}
