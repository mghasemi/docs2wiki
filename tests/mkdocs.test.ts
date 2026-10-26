import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalAdapter } from "../src/adapters/localAdapter.js";
import { findProjectRoot, flattenNav, loadMkdocsProject } from "../src/adapters/mkdocs.js";
import type { ConsolidationInput } from "../src/types.js";

async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "docs-unifier-mkdocs-"));
  for (const [name, content] of Object.entries(files)) {
    const full = resolve(root, name);
    await mkdir(resolve(full, ".."), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return root;
}

async function run(root: string) {
  const input: ConsolidationInput = {
    sourceKind: "local",
    sourceValue: root,
    title: "T",
    outMarkdownPath: resolve(".tmp/mk.md"),
    outPdfPath: resolve(".tmp/mk.pdf"),
    maxPages: 50,
    maxDepth: 3,
    skipPdf: true,
    useCache: false,
    cacheDir: resolve(".cache"),
    sourceCacheTtlMinutes: 60,
  };
  return (await new LocalAdapter().fetchPages(input)).pages;
}

describe("mkdocs support", () => {
  it("flattens nav with titles and skips external links", () => {
    const entries = flattenNav([
      "index.md",
      { Guide: ["guide/a.md", { "Setup Page": "guide/setup.md#top" }] },
      { Site: "https://example.com" },
    ]);
    expect(entries).toEqual([
      { path: "index.md", title: undefined },
      { path: "guide/a.md", title: undefined },
      { path: "guide/setup.md", title: "Setup Page" },
    ]);
  });

  it("reads docs from docs/ at the project root and applies nav order and titles", async () => {
    const root = await project({
      "mkdocs.yml": `site_name: S
markdown_extensions:
  - pymdownx.emoji:
      emoji_index: !!python/name:material.extensions.emoji.twemoji
nav:
  - Second Page: b.md
  - a.md
`,
      "docs/a.md": "# A",
      "docs/b.md": "# B",
      "docs/c.md": "# C",
      "README.md": "# Outside docs",
    });
    const pages = await run(root);
    expect(pages.map((p) => p.sourceRef)).toEqual(["b.md", "a.md", "c.md"]);
    expect(pages[0].title).toBe("Second Page");
    expect(pages[1].title).toBe("A");
  });

  it("honors a custom docs_dir and rejects one outside the project", async () => {
    const root = await project({ "mkdocs.yaml": "docs_dir: content\n", "content/x.md": "# X", "docs/y.md": "# Y" });
    expect((await run(root)).map((p) => p.sourceRef)).toEqual(["x.md"]);

    const escaped = await project({ "mkdocs.yml": "docs_dir: ../elsewhere\n", "z.md": "# Z" });
    const loaded = await loadMkdocsProject(escaped);
    expect(loaded?.docsDir).toBe(escaped);
  });

  it("returns null when there is no mkdocs config", async () => {
    expect(await loadMkdocsProject(await project({ "a.md": "# A" }))).toBeNull();
  });

  it("finds the project root inside wrapper folders (uploads)", async () => {
    const wrapped = await project({ "proj/mkdocs.yml": "nav: []\n", "proj/docs/a.md": "# A", "__MACOSX/x": "junk" });
    expect(await findProjectRoot(wrapped)).toBe(resolve(wrapped, "proj"));

    const plain = await project({ "only/docs/a.md": "# A", "only/docs/b.md": "# B" });
    expect(await findProjectRoot(plain)).toBe(resolve(plain, "only", "docs"));

    const flat = await project({ "mkdocs.yml": "nav: []\n", "docs/a.md": "# A" });
    expect(await findProjectRoot(flat)).toBe(flat);
  });
});
