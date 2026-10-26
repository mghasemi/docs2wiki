import { describe, expect, it, vi } from "vitest";
import axios from "axios";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setSourceCache } from "../src/cache/sourceCache.js";
import { ReadTheDocsAdapter } from "../src/adapters/readTheDocsAdapter.js";
import type { ConsolidationInput } from "../src/types.js";

vi.mock("axios", () => {
  return {
    default: {
      get: vi.fn(),
    },
  };
});

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
};

function makePage(title: string, body: string, links: string[]): string {
  const anchors = links.map((href) => `<a href=\"${href}\">link</a>`).join(" ");
  return `<html><body><main><h1>${title}</h1><p>${body}</p>${anchors}</main></body></html>`;
}

function makePageWithNav(title: string, body: string, navLinks: string[], contentLinks: string[]): string {
  const nav = navLinks.map((href) => `<a href=\"${href}\">nav</a>`).join(" ");
  const content = contentLinks.map((href) => `<a href=\"${href}\">body</a>`).join(" ");
  return [
    "<html><body>",
    `<nav aria-label=\"navigation\">${nav}</nav>`,
    `<main><h1>${title}</h1><p>${body}</p>${content}</main>`,
    "</body></html>",
  ].join("");
}

describe("ReadTheDocsAdapter", () => {
  it("crawls only same-origin docs links and respects max depth", async () => {
    const root = "https://example.readthedocs.io/en/latest/";
    const p1 = "https://example.readthedocs.io/en/latest/guide/";
    const p2 = "https://example.readthedocs.io/en/latest/reference/";

    mockedAxios.get.mockReset();
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url === root) {
        return {
          data: makePage(
            "Home",
            "This is a sufficiently long body for root page content extraction in tests.",
            ["/en/latest/guide/", "/static/app.css", "https://external.example/page"],
          ),
        };
      }
      if (url === p1) {
        return {
          data: makePage(
            "Guide",
            "This guide page body is also long enough to satisfy content threshold extraction checks.",
            ["/en/latest/reference/", "/en/latest/"],
          ),
        };
      }
      if (url === p2) {
        return {
          data: makePage(
            "Reference",
            "Reference content is valid but should be skipped because depth limit blocks depth 2 processing.",
            [],
          ),
        };
      }
      throw new Error(`Unexpected url ${url}`);
    });

    const input: ConsolidationInput = {
      sourceKind: "readthedocs",
      sourceValue: root,
      title: "RTD",
      outMarkdownPath: "out.md",
      outPdfPath: "out.pdf",
      maxPages: 20,
      maxDepth: 1,
      skipPdf: true,
      useCache: false,
      cacheDir: ".cache",
      sourceCacheTtlMinutes: 60,
    };

    const adapter = new ReadTheDocsAdapter();
    const fetched = await adapter.fetchPages(input);
    const pages = fetched.pages;

    expect(pages.length).toBe(2);
    expect(fetched.adapter).toBe("readthedocs");
    expect(fetched.sourceCacheStatus).toBe("disabled");
    expect(pages.map((p) => p.title)).toEqual(["Home", "Guide"]);
    expect(pages.every((p) => p.sourceRef.startsWith("https://example.readthedocs.io/"))).toBe(true);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      root,
      expect.objectContaining({
        responseType: "text",
      }),
    );
    expect(mockedAxios.get).toHaveBeenCalledWith(
      p1,
      expect.objectContaining({
        responseType: "text",
      }),
    );
  });

  it("prioritizes navigation links before body links for deterministic ordering", async () => {
    const root = "https://example.readthedocs.io/en/latest/";
    const navFirst = "https://example.readthedocs.io/en/latest/alpha/";
    const bodySecond = "https://example.readthedocs.io/en/latest/beta/";

    mockedAxios.get.mockReset();
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url === root) {
        return {
          data: makePageWithNav(
            "Home",
            "Home body content long enough to pass content extraction threshold for this test scenario.",
            ["/en/latest/alpha/"],
            ["/en/latest/beta/"],
          ),
        };
      }

      if (url === navFirst) {
        return {
          data: makePage(
            "Alpha",
            "Alpha content is long enough to ensure page extraction and stable order assertions are valid.",
            [],
          ),
        };
      }

      if (url === bodySecond) {
        return {
          data: makePage(
            "Beta",
            "Beta content is long enough to ensure page extraction and stable order assertions are valid.",
            [],
          ),
        };
      }

      throw new Error(`Unexpected url ${url}`);
    });

    const input: ConsolidationInput = {
      sourceKind: "readthedocs",
      sourceValue: root,
      title: "RTD Ordered",
      outMarkdownPath: "out.md",
      outPdfPath: "out.pdf",
      maxPages: 20,
      maxDepth: 2,
      skipPdf: true,
      useCache: false,
      cacheDir: ".cache",
      sourceCacheTtlMinutes: 60,
    };

    const adapter = new ReadTheDocsAdapter();
    const fetched = await adapter.fetchPages(input);
    const pages = fetched.pages;

    expect(fetched.adapter).toBe("readthedocs");
    expect(fetched.sourceCacheStatus).toBe("disabled");
    expect(pages.map((p) => p.title)).toEqual(["Home", "Alpha", "Beta"]);
  });

  it("uses source cache to avoid repeated network fetch within ttl", async () => {
    const root = "https://example.readthedocs.io/en/latest/";
    const cacheDir = await mkdtemp(resolve(tmpdir(), "docs-unifier-rtd-cache-"));

    mockedAxios.get.mockReset();
    mockedAxios.get.mockResolvedValue({
      data: makePage(
        "Home",
        "This page body is long enough to qualify as extracted content for the adapter cache test.",
        [],
      ),
    });

    const input: ConsolidationInput = {
      sourceKind: "readthedocs",
      sourceValue: root,
      title: "RTD Cache",
      outMarkdownPath: "out.md",
      outPdfPath: "out.pdf",
      maxPages: 20,
      maxDepth: 1,
      skipPdf: true,
      useCache: true,
      cacheDir,
      sourceCacheTtlMinutes: 60,
    };

    const adapter = new ReadTheDocsAdapter();
    const first = await adapter.fetchPages(input);
    expect(first.pages.length).toBe(1);
    expect(first.adapter).toBe("readthedocs");
    expect(first.sourceCacheStatus).toBe("miss");
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);

    mockedAxios.get.mockClear();
    const second = await adapter.fetchPages(input);
    expect(second.pages.length).toBe(1);
    expect(second.adapter).toBe("readthedocs");
    expect(second.sourceCacheStatus).toBe("hit");
    expect(mockedAxios.get).toHaveBeenCalledTimes(0);
  });

  it("falls back to stale source cache when fetching fails", async () => {
    const root = "https://example.readthedocs.io/en/latest/";
    const cacheDir = await mkdtemp(resolve(tmpdir(), "docs-unifier-rtd-stale-cache-"));
    const cacheKey = `rtd:${root}:20:1`;

    await setSourceCache(
      cacheDir,
      cacheKey,
      [
        {
          id: "rtd:cached",
          title: "Cached Page",
          sourceRef: root,
          body: "<p>cached</p>",
          format: "html",
          orderHint: 0,
        },
      ],
      -1,
    );

    mockedAxios.get.mockReset();
    mockedAxios.get.mockRejectedValue(new Error("network down"));

    const input: ConsolidationInput = {
      sourceKind: "readthedocs",
      sourceValue: root,
      title: "RTD Stale",
      outMarkdownPath: "out.md",
      outPdfPath: "out.pdf",
      maxPages: 20,
      maxDepth: 1,
      skipPdf: true,
      useCache: true,
      cacheDir,
      sourceCacheTtlMinutes: 60,
    };

    const adapter = new ReadTheDocsAdapter();
    const fetched = await adapter.fetchPages(input);

    expect(fetched.adapter).toBe("readthedocs");
    expect(fetched.sourceCacheStatus).toBe("stale-fallback");
    expect((fetched.warnings ?? []).length).toBeGreaterThan(0);
    expect(fetched.pages.map((p) => p.title)).toEqual(["Cached Page"]);
  });
});
