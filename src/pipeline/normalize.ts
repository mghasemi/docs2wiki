import { NodeHtmlMarkdown } from "node-html-markdown";
import { posix } from "node:path";
import { RawPage, NormalizedPage } from "../types.js";
import { runCommand } from "../utils/process.js";
import { toAnchor } from "../utils/slug.js";

const nhm = new NodeHtmlMarkdown();

function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function hasUriScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);
}

function splitPathSuffix(target: string): { pathPart: string; suffix: string } {
  const hashIndex = target.indexOf("#");
  const queryIndex = target.indexOf("?");
  const splitIndex =
    hashIndex === -1
      ? queryIndex
      : queryIndex === -1
        ? hashIndex
        : Math.min(hashIndex, queryIndex);

  if (splitIndex === -1) {
    return { pathPart: target, suffix: "" };
  }

  return {
    pathPart: target.slice(0, splitIndex),
    suffix: target.slice(splitIndex),
  };
}

function resolveLocalTargetPath(sourceRef: string, pathPart: string): string | undefined {
  if (hasUriScheme(sourceRef)) {
    return undefined;
  }

  const sourceNormalized = sourceRef.replace(/\\/g, "/");
  const sourceDir = sourceNormalized.includes("/")
    ? sourceNormalized.slice(0, sourceNormalized.lastIndexOf("/"))
    : "";

  const combined = pathPart.startsWith("/")
    ? pathPart.replace(/^\/+/, "")
    : sourceDir
      ? posix.join(sourceDir, pathPart)
      : pathPart;

  const normalized = posix
    .normalize(combined)
    .replace(/^\.\//, "")
    .replace(/^(\.\.\/)+/, "");

  return normalized;
}

function isLikelyAssetPath(pathPart: string): boolean {
  const lower = pathPart.toLowerCase();
  return (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".svg") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".pdf") ||
    lower.endsWith(".zip") ||
    lower.endsWith(".tar") ||
    lower.endsWith(".gz") ||
    lower.endsWith(".tgz") ||
    lower.endsWith(".bmp") ||
    lower.endsWith(".ico")
  );
}

function hardenMarkdownLinks(markdown: string, sourceRef: string): { markdown: string; warnings: string[] } {
  const warnings = new Set<string>();

  const rewritten = markdown.replace(
    /(!?\[[^\]]*\])\(([^)]+)\)/g,
    (full, label: string, rawTarget: string) => {
      let target = String(rawTarget).trim();
      let titleSuffix = "";

      const titleMatch = target.match(/^(.*?)(\s+"[^"]*")$/);
      if (titleMatch) {
        target = titleMatch[1].trim();
        titleSuffix = titleMatch[2];
      }

      if (
        target.startsWith("#") ||
        target.startsWith("mailto:") ||
        target.startsWith("http://") ||
        target.startsWith("https://") ||
        target.startsWith("data:")
      ) {
        return full;
      }

      const { pathPart, suffix } = splitPathSuffix(target);
      const resolved = resolveLocalTargetPath(sourceRef, pathPart.replace(/^\.\//, ""));
      if (!resolved) {
        return full;
      }

      const isImage = label.startsWith("!");
      if (isImage || isLikelyAssetPath(resolved)) {
        const rewrittenAsset = `./assets/${resolved}${suffix}`;
        warnings.add(`Asset link rewritten to virtual assets path: ${target} -> ${rewrittenAsset}`);
        return `${label}(${rewrittenAsset}${titleSuffix})`;
      }

      return `${label}(${resolved}${suffix}${titleSuffix})`;
    },
  );

  return {
    markdown: rewritten,
    warnings: [...warnings],
  };
}

async function rstToMarkdown(rst: string): Promise<{ markdown: string; warning?: string }> {
  const result = await runCommand("pandoc", ["-f", "rst", "-t", "gfm"], undefined, rst).catch(() => null);
  if (!result || result.exitCode !== 0) {
    return {
      markdown: [
        "Conversion warning: pandoc not available for .rst conversion. Raw content included.",
        "",
        "```rst",
        rst,
        "```",
      ].join("\n"),
      warning: "Pandoc not found or failed; .rst content embedded as raw block.",
    };
  }

  return { markdown: result.stdout };
}

async function toMarkdown(page: RawPage): Promise<{ markdown: string; warnings: string[] }> {
  if (page.format === "markdown") {
    const hardened = hardenMarkdownLinks(normalizeMarkdown(page.body), page.sourceRef);
    return {
      markdown: hardened.markdown,
      warnings: hardened.warnings,
    };
  }

  if (page.format === "html") {
    const hardened = hardenMarkdownLinks(normalizeMarkdown(nhm.translate(page.body)), page.sourceRef);
    return {
      markdown: hardened.markdown,
      warnings: hardened.warnings,
    };
  }

  const rst = await rstToMarkdown(page.body);
  const hardened = hardenMarkdownLinks(normalizeMarkdown(rst.markdown), page.sourceRef);
  return {
    markdown: hardened.markdown,
    warnings: [...(rst.warning ? [rst.warning] : []), ...hardened.warnings],
  };
}

export async function normalizePages(rawPages: RawPage[]): Promise<NormalizedPage[]> {
  const seenAnchors = new Map<string, number>();
  const output: NormalizedPage[] = [];

  for (const page of rawPages) {
    const converted = await toMarkdown(page);
    const base = toAnchor(page.title);
    const currentCount = seenAnchors.get(base) ?? 0;
    seenAnchors.set(base, currentCount + 1);
    const uniqueAnchor = currentCount === 0 ? base : `${base}-${currentCount + 1}`;

    output.push({
      id: page.id,
      title: page.title,
      sourceRef: page.sourceRef,
      markdown: converted.markdown,
      orderKey: page.orderHint ?? Number.MAX_SAFE_INTEGER,
      anchor: uniqueAnchor,
      warnings: converted.warnings,
    });
  }

  output.sort((a, b) => a.orderKey - b.orderKey || a.title.localeCompare(b.title));
  return output;
}
