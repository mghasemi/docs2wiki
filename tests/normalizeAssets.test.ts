import { describe, expect, it } from "vitest";
import { normalizePages } from "../src/pipeline/normalize.js";
import type { RawPage } from "../src/types.js";

describe("normalizePages asset/link hardening", () => {
  it("rewrites relative asset paths and normalizes relative document links", async () => {
    const raw: RawPage[] = [
      {
        id: "r1",
        title: "Intro",
        sourceRef: "guide/intro.md",
        body: [
          "![Logo](../images/logo.png)",
          "",
          "Read [Setup](../setup.html#Install Steps)",
        ].join("\n"),
        format: "markdown",
        orderHint: 1,
      },
    ];

    const normalized = await normalizePages(raw);
    expect(normalized).toHaveLength(1);

    const page = normalized[0];
    expect(page.markdown).toContain("![Logo](./assets/images/logo.png)");
    expect(page.markdown).toContain("[Setup](setup.html#Install Steps)");
    expect(page.warnings.some((w) => w.includes("Asset link rewritten to virtual assets path"))).toBe(true);
  });
});
