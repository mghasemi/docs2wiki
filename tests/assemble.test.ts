import { describe, expect, it } from "vitest";
import { assembleMarkdown } from "../src/pipeline/assemble.js";
import type { NormalizedPage } from "../src/types.js";

describe("assembleMarkdown", () => {
  it("rewrites internal links to anchors and keeps external links", () => {
    const pages: NormalizedPage[] = [
      {
        id: "p1",
        title: "Intro",
        sourceRef: "intro.md",
        markdown: "Go to [Setup](guide/setup.md) and [Site](https://example.com)",
        orderKey: 1,
        anchor: "intro",
        warnings: [],
      },
      {
        id: "p2",
        title: "Setup",
        sourceRef: "guide/setup.md",
        markdown: "Ready.",
        orderKey: 2,
        anchor: "setup",
        warnings: [],
      },
    ];

    const result = assembleMarkdown("Docs", pages);
    expect(result).toContain("[Setup](#setup)");
    expect(result).toContain("[Site](https://example.com)");
  });

  it("rewrites ../ relative links and keeps section fragment context", () => {
    const pages: NormalizedPage[] = [
      {
        id: "p1",
        title: "Intro",
        sourceRef: "guide/intro.md",
        markdown: "Read [Install](../setup.md#Install Steps)",
        orderKey: 1,
        anchor: "intro",
        warnings: [],
      },
      {
        id: "p2",
        title: "Setup",
        sourceRef: "setup.md",
        markdown: "Setup content",
        orderKey: 2,
        anchor: "setup",
        warnings: [],
      },
    ];

    const result = assembleMarkdown("Docs", pages);
    expect(result).toContain("[Install](#setup-install-steps)");
  });

  it("resolves extension variants when linking by html path", () => {
    const pages: NormalizedPage[] = [
      {
        id: "p1",
        title: "Index",
        sourceRef: "index.md",
        markdown: "See [Guide](guide/setup.html)",
        orderKey: 1,
        anchor: "index",
        warnings: [],
      },
      {
        id: "p2",
        title: "Guide",
        sourceRef: "guide/setup.md",
        markdown: "Guide content",
        orderKey: 2,
        anchor: "guide-setup",
        warnings: [],
      },
    ];

    const result = assembleMarkdown("Docs", pages);
    expect(result).toContain("[Guide](#guide-setup)");
  });
});
