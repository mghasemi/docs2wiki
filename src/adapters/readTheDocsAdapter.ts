import axios from "axios";
import { load } from "cheerio";
import { URL } from "node:url";
import { getSourceCacheEntry, setSourceCache } from "../cache/sourceCache.js";
import { ConsolidationInput, RawPage, SourceAdapter, SourceFetchResult } from "../types.js";

interface QueueItem {
  url: string;
  depth: number;
}

interface ExtractedContent {
  title: string;
  contentHtml: string;
  navLinks: string[];
  contentLinks: string[];
}

function toAbsolute(baseUrl: string, href: string): string | null {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function urlKey(input: string): string {
  const u = new URL(input);
  u.hash = "";
  return u.toString().replace(/\/$/, "");
}

function isDocPage(base: URL, candidateUrl: string): boolean {
  const u = new URL(candidateUrl);
  if (u.origin !== base.origin) {
    return false;
  }

  if (u.pathname.endsWith(".css") || u.pathname.endsWith(".js") || u.pathname.endsWith(".svg") || u.pathname.endsWith(".png") || u.pathname.endsWith(".jpg") || u.pathname.endsWith(".jpeg") || u.pathname.endsWith(".gif")) {
    return false;
  }

  const blocked = ["/search", "/_", "/static", "/api"];
  if (blocked.some((segment) => u.pathname.startsWith(segment))) {
    return false;
  }

  return true;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function pickMainContent(html: string): ExtractedContent {
  const $ = load(html);
  const root = $("main").first().length
    ? $("main").first()
    : $("article").first().length
      ? $("article").first()
      : $("div[role='main']").first().length
        ? $("div[role='main']").first()
        : $("body");

  root.find("script,style,noscript,nav,footer,header").remove();

  const title = $("h1").first().text().trim() || $("title").text().trim() || "Untitled";
  const navRegion = $("nav[aria-label*='navigation' i], nav, .wy-menu, .toctree-wrapper, .bd-sidebar");
  const navLinks = navRegion
    .find("a[href]")
    .toArray()
    .map((el) => $(el).attr("href") || "")
    .filter(Boolean);

  const contentLinks = root
    .find("a[href]")
    .toArray()
    .map((el) => $(el).attr("href") || "")
    .filter(Boolean);

  return {
    title,
    contentHtml: root.html() ?? "",
    navLinks: unique(navLinks),
    contentLinks: unique(contentLinks),
  };
}

export class ReadTheDocsAdapter implements SourceAdapter {
  async fetchPages(input: ConsolidationInput): Promise<SourceFetchResult> {
    const start = new URL(input.sourceValue).toString();
    const sourceCacheKey = `rtd:${start}:${input.maxPages}:${input.maxDepth}`;
    const cacheEntry = input.useCache ? await getSourceCacheEntry(input.cacheDir, sourceCacheKey) : undefined;

    if (cacheEntry && !cacheEntry.expired) {
      return {
        pages: cacheEntry.pages.slice(0, input.maxPages),
        adapter: "readthedocs",
        sourceCacheStatus: "hit",
        detail: "Source pages loaded from ReadTheDocs adapter cache.",
      };
    }

    const base = new URL(start);
    const queue: QueueItem[] = [{ url: start, depth: 0 }];
    const visited = new Set<string>();
    const enqueued = new Set<string>([urlKey(start)]);
    const pages: RawPage[] = [];

    while (queue.length > 0 && pages.length < input.maxPages) {
      const item = queue.shift() as QueueItem;
      const key = urlKey(item.url);
      if (visited.has(key)) {
        continue;
      }
      visited.add(key);

      if (item.depth > input.maxDepth) {
        continue;
      }

      let html: string;
      try {
        const response = await axios.get<string>(item.url, {
          responseType: "text",
          timeout: 15000,
          headers: {
            "User-Agent": "docs-unifier/0.1",
          },
        });
        html = response.data;
      } catch {
        continue;
      }

      const extracted = pickMainContent(html);
      if (extracted.contentHtml.trim().length > 80) {
        pages.push({
          id: `rtd:${key}`,
          title: extracted.title,
          sourceRef: item.url,
          body: extracted.contentHtml,
          format: "html",
          orderHint: pages.length,
        });
      }

      const orderedLinks = [...extracted.navLinks, ...extracted.contentLinks];
      for (const link of orderedLinks) {
        const abs = toAbsolute(item.url, link);
        if (!abs) {
          continue;
        }
        if (!isDocPage(base, abs)) {
          continue;
        }

        const nextKey = urlKey(abs);
        if (visited.has(nextKey) || enqueued.has(nextKey)) {
          continue;
        }

        queue.push({ url: abs, depth: item.depth + 1 });
        enqueued.add(nextKey);
      }
    }

    if (pages.length === 0 && cacheEntry) {
      return {
        pages: cacheEntry.pages.slice(0, input.maxPages),
        adapter: "readthedocs",
        sourceCacheStatus: "stale-fallback",
        detail: "Network crawl produced no pages; reused stale cached ReadTheDocs pages.",
        warnings: [
          {
            code: "SOURCE_STALE_FALLBACK_READTHEDOCS",
            message: "ReadTheDocs fetch failed or returned no usable pages; stale source cache was used.",
            severity: "warning",
          },
        ],
      };
    }

    if (input.useCache) {
      await setSourceCache(input.cacheDir, sourceCacheKey, pages, input.sourceCacheTtlMinutes);
    }

    return {
      pages,
      adapter: "readthedocs",
      sourceCacheStatus: input.useCache ? "miss" : "disabled",
      detail: input.useCache
        ? "ReadTheDocs pages crawled from network and cached."
        : "Source cache disabled; ReadTheDocs pages crawled directly from network.",
    };
  }
}
