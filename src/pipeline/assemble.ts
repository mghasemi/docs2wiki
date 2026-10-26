import { NormalizedPage } from "../types.js";
import { toAnchor } from "../utils/slug.js";

function candidateKeysForPath(pathWithoutFragment: string): string[] {
  const cleaned = pathWithoutFragment.replace(/\\/g, "/").replace(/^\//, "");
  if (!cleaned) {
    return [];
  }

  const set = new Set<string>([cleaned]);
  if (!/\.[^.\/]+$/.test(cleaned)) {
    set.add(`${cleaned}.md`);
    set.add(`${cleaned}.markdown`);
    set.add(`${cleaned}.html`);
    set.add(`${cleaned}.htm`);
    set.add(`${cleaned}.rst`);
  } else {
    set.add(cleaned.replace(/\.[^.\/]+$/, ".md"));
    set.add(cleaned.replace(/\.[^.\/]+$/, ".markdown"));
    set.add(cleaned.replace(/\.[^.\/]+$/, ".html"));
    set.add(cleaned.replace(/\.[^.\/]+$/, ".htm"));
    set.add(cleaned.replace(/\.[^.\/]+$/, ".rst"));
  }

  return [...set];
}

function findMappedAnchor(pageMap: Map<string, string>, normalizedPath: string): string | undefined {
  for (const key of candidateKeysForPath(normalizedPath)) {
    const direct = pageMap.get(key);
    if (direct) {
      return direct;
    }
  }
  return undefined;
}

function rewriteInternalLinks(markdown: string, pageMap: Map<string, string>, sourceRef: string): string {
  const sourceNormalized = sourceRef.replace(/\\/g, "/");
  const sourceDir = sourceNormalized.includes("/")
    ? sourceNormalized.slice(0, sourceNormalized.lastIndexOf("/"))
    : "";

  return markdown.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (full, label: string, target: string) => {
    const trimmed = target.trim();
    if (
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("mailto:") ||
      trimmed.startsWith("#")
    ) {
      return full;
    }

    const [rawPath, rawFragment] = trimmed.split("#", 2);
    const cleanedPath = rawPath.replace(/\\/g, "/");
    const absoluteOrResolved = cleanedPath.startsWith("/")
      ? cleanedPath.replace(/^\//, "")
      : sourceDir
        ? `${sourceDir}/${cleanedPath}`
        : cleanedPath;

    const normalizedSegments = absoluteOrResolved
      .split("/")
      .filter((segment) => segment.length > 0)
      .reduce<string[]>((acc, segment) => {
        if (segment === ".") {
          return acc;
        }
        if (segment === "..") {
          acc.pop();
          return acc;
        }
        acc.push(segment);
        return acc;
      }, []);

    const normalizedPath = normalizedSegments.join("/");

    const found = findMappedAnchor(pageMap, normalizedPath);
    if (!found) {
      return full;
    }

    if (!rawFragment || rawFragment.trim().length === 0) {
      return `[${label}](#${found})`;
    }

    return `[${label}](#${found}-${toAnchor(rawFragment)})`;
  });
}

export function assembleMarkdown(title: string, pages: NormalizedPage[]): string {
  const pageMap = new Map<string, string>();
  for (const page of pages) {
    pageMap.set(page.sourceRef.replace(/\\/g, "/"), page.anchor);
  }

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`Generated on: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Table of Contents");
  lines.push("");

  for (const page of pages) {
    lines.push(`- [${page.title}](#${page.anchor})`);
  }

  lines.push("");
  lines.push("---");
  lines.push("");

  for (const page of pages) {
    lines.push(`## ${page.title}`);
    lines.push(`<a id=\"${page.anchor}\"></a>`);
    lines.push("");
    lines.push(`Source: ${page.sourceRef}`);
    lines.push("");
    lines.push(rewriteInternalLinks(page.markdown, pageMap, page.sourceRef));
    lines.push("");
    if (page.warnings.length > 0) {
      lines.push("Warnings:");
      for (const warning of page.warnings) {
        lines.push(`- ${warning}`);
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}
