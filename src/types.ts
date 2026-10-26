export type SourceKind = "github-wiki" | "local" | "readthedocs";

export interface SourceSpec {
  sourceKind: SourceKind;
  sourceValue: string;
}

export interface RawPage {
  id: string;
  title: string;
  sourceRef: string;
  body: string;
  format: "markdown" | "html" | "rst";
  orderHint?: number;
}

export interface NormalizedPage {
  id: string;
  title: string;
  sourceRef: string;
  markdown: string;
  orderKey: number;
  anchor: string;
  warnings: string[];
}

export interface ConsolidationInput {
  sourceKind: SourceKind;
  sourceValue: string;
  sources?: SourceSpec[];
  title: string;
  outMarkdownPath: string;
  outPdfPath: string;
  reportJsonPath?: string;
  maxPages: number;
  maxDepth: number;
  skipPdf: boolean;
  strictStaleFallback?: boolean;
  useCache: boolean;
  cacheDir: string;
  sourceCacheTtlMinutes: number;
}

export interface WarningDetail {
  code: string;
  message: string;
  severity: "warning" | "error";
}

export interface ConsolidationResult {
  markdownPath: string;
  pdfPath?: string;
  pagesProcessed: number;
  warnings: string[];
  warningDetails: WarningDetail[];
  fromCache: boolean;
  sourceFetch: {
    adapter: SourceKind;
    cacheStatus: SourceCacheStatus;
    detail?: string;
  };
  sourceFetches: Array<{
    adapter: SourceKind;
    cacheStatus: SourceCacheStatus;
    detail?: string;
  }>;
  sourceCacheStats: {
    hits: number;
    misses: number;
    staleFallbacks: number;
    disabled: number;
  };
}

export type SourceCacheStatus = "hit" | "miss" | "stale-fallback" | "disabled";

export interface SourceFetchResult {
  pages: RawPage[];
  adapter: SourceKind;
  sourceCacheStatus: SourceCacheStatus;
  detail?: string;
  warnings?: WarningDetail[];
}

export interface SourceAdapter {
  fetchPages(input: ConsolidationInput): Promise<SourceFetchResult>;
}
