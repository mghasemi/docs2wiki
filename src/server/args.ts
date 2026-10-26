export type UiSourceKind = "github-wiki" | "readthedocs" | "local" | "upload";

export interface UiSource {
  kind: UiSourceKind;
  value: string;
}

export interface JobRequest {
  title: string;
  sources: UiSource[];
  maxPages: number;
  maxDepth: number;
  useCache: boolean;
  cacheTtlMinutes: number;
  strictStaleFallback: boolean;
  skipPdf: boolean;
}

function boundedInt(value: unknown, fallback: number, min: number, max: number, label: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }
  return n;
}

export function parseJobRequest(raw: unknown): JobRequest {
  if (typeof raw !== "object" || raw === null) throw new Error("Request body must be an object.");
  const body = raw as Record<string, unknown>;

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 200) throw new Error("title is required (max 200 characters).");

  if (!Array.isArray(body.sources) || body.sources.length === 0 || body.sources.length > 20) {
    throw new Error("Provide between 1 and 20 sources.");
  }
  const sources = body.sources.map((s): UiSource => {
    const item = s as Record<string, unknown>;
    const kind = item?.kind;
    const value = typeof item?.value === "string" ? item.value.trim() : "";
    if (kind !== "github-wiki" && kind !== "readthedocs" && kind !== "local" && kind !== "upload") {
      throw new Error(`Unsupported source kind: ${String(kind)}`);
    }
    if (!value) throw new Error("Every source needs a value.");
    return { kind, value };
  });

  return {
    title,
    sources,
    maxPages: boundedInt(body.maxPages, 500, 1, 5000, "maxPages"),
    maxDepth: boundedInt(body.maxDepth, 6, 0, 20, "maxDepth"),
    useCache: body.useCache !== false,
    cacheTtlMinutes: boundedInt(body.cacheTtlMinutes, 60, 0, 525600, "cacheTtlMinutes"),
    strictStaleFallback: body.strictStaleFallback === true,
    skipPdf: body.skipPdf === true,
  };
}

export interface ResolvedPaths {
  outMd: string;
  outPdf: string;
  reportJson: string;
  cacheDir: string;
}

// `resolvedSources` carries the final CLI value (URL or absolute folder path) for each source.
export function buildCliArgs(
  request: JobRequest,
  resolvedSources: { kind: "github-wiki" | "readthedocs" | "local"; value: string }[],
  paths: ResolvedPaths,
): string[] {
  const args = ["--title", request.title];
  for (const s of resolvedSources) {
    args.push("--source", `${s.kind}=${s.value}`);
  }
  args.push(
    "--out-md",
    paths.outMd,
    "--out-pdf",
    paths.outPdf,
    "--report-json",
    paths.reportJson,
    "--max-pages",
    String(request.maxPages),
    "--max-depth",
    String(request.maxDepth),
    "--cache-dir",
    paths.cacheDir,
    "--source-cache-ttl-minutes",
    String(request.cacheTtlMinutes),
  );
  if (!request.useCache) args.push("--no-cache");
  if (request.strictStaleFallback) args.push("--strict-stale-fallback");
  if (request.skipPdf) args.push("--skip-pdf");
  return args;
}
