import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCliArgs, parseJobRequest } from "../src/server/args.js";
import { buildServer } from "../src/server/app.js";
import { assertPublicHttpUrl, extractZipSafely, resolveInside, safeRelativePath } from "../src/server/safety.js";

describe("parseJobRequest / buildCliArgs", () => {
  it("builds args with defaults and flags", () => {
    const req = parseJobRequest({
      title: "T",
      sources: [{ kind: "local", value: "x" }],
      useCache: false,
      skipPdf: true,
      strictStaleFallback: true,
    });
    const args = buildCliArgs(req, [{ kind: "local", value: "/w/x" }], {
      outMd: "a.md",
      outPdf: "a.pdf",
      reportJson: "r.json",
      cacheDir: "/c",
    });
    expect(args).toContain("--no-cache");
    expect(args).toContain("--skip-pdf");
    expect(args).toContain("--strict-stale-fallback");
    expect(args).toContain("local=/w/x");
  });

  it("rejects bad input", () => {
    expect(() => parseJobRequest({ title: "", sources: [] })).toThrow();
    expect(() => parseJobRequest({ title: "t", sources: [{ kind: "ftp", value: "x" }] })).toThrow();
    expect(() => parseJobRequest({ title: "t", sources: [{ kind: "local", value: "x" }], maxPages: 0 })).toThrow();
  });
});

describe("safety", () => {
  it("blocks path traversal", () => {
    expect(resolveInside("/ws", "a/b")).toBe("/ws/a/b");
    expect(() => resolveInside("/ws", "../etc")).toThrow();
    expect(() => resolveInside("/ws", "/etc/passwd")).toThrow();
    expect(() => safeRelativePath("../x")).toThrow();
  });

  it("rejects zip-slip entries and oversize archives", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zip-"));
    try {
      const evil = zipSync({ "../evil.md": strToU8("x") });
      await expect(extractZipSafely(evil, dir, { maxBytes: 1000, maxFiles: 10 })).rejects.toThrow();
      const big = zipSync({ "a.md": strToU8("x".repeat(500)) });
      await expect(extractZipSafely(big, dir, { maxBytes: 100, maxFiles: 10 })).rejects.toThrow();
      const ok = zipSync({ "d/a.md": strToU8("hi") });
      expect(await extractZipSafely(ok, dir, { maxBytes: 1000, maxFiles: 10 })).toBe(1);
      expect(await readFile(join(dir, "d/a.md"), "utf8")).toBe("hi");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks private URLs and non-http schemes", async () => {
    await expect(assertPublicHttpUrl("http://127.0.0.1/x", true)).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://192.168.1.5/", true)).rejects.toThrow();
    await expect(assertPublicHttpUrl("file:///etc/passwd", false)).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://127.0.0.1/x", false)).resolves.toBeUndefined();
  });
});

describe("server job lifecycle", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "srv-"));
    await mkdir(join(root, "ws", "docs"), { recursive: true });
    await writeFile(
      join(root, "stub-cli.mjs"),
      `import {writeFileSync} from "node:fs";
const a=process.argv; const v=(f)=>a[a.indexOf(f)+1];
console.log("stub running");
writeFileSync(v("--out-md"),"# hi"); writeFileSync(v("--report-json"),JSON.stringify({result:{pagesProcessed:1,warnings:["w1"]}}));`,
    );
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("runs a mounted-folder job and serves files", async () => {
    const { app } = await buildServer({
      port: 0,
      host: "127.0.0.1",
      dataDir: join(root, "data"),
      workspaceDir: join(root, "ws"),
      cliPath: join(root, "stub-cli.mjs"),
      publicDir: join(root, "none"),
      maxUploadBytes: 1024 * 1024,
      maxUploadFiles: 10,
      maxConcurrentJobs: 1,
      blockPrivateNetworks: true,
    });
    const bad = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: { title: "t", sources: [{ kind: "local", value: "../x" }] },
    });
    expect(bad.statusCode).toBe(400);

    const res = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: { title: "t", sources: [{ kind: "local", value: "docs" }] },
    });
    expect(res.statusCode).toBe(202);
    const id = res.json().id;

    let job = res.json();
    for (let i = 0; i < 50 && ["queued", "running"].includes(job.status); i++) {
      await new Promise((r) => setTimeout(r, 100));
      job = (await app.inject({ url: `/api/jobs/${id}` })).json();
    }
    expect(job.status).toBe("succeeded");
    expect(job.warnings).toEqual(["w1"]);
    const md = await app.inject({ url: `/api/jobs/${id}/files/md` });
    expect(md.body).toBe("# hi");
    expect((await app.inject({ url: `/api/jobs/${id}/files/pdf` })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/jobs/${id}` })).statusCode).toBe(200);
    await app.close();
  });

  it("detects an uploaded MkDocs project wrapped in a top-level folder", async () => {
    const { app } = await buildServer({
      port: 0,
      host: "127.0.0.1",
      dataDir: join(root, "data"),
      workspaceDir: join(root, "ws"),
      cliPath: join(root, "stub-cli.mjs"),
      publicDir: join(root, "none"),
      maxUploadBytes: 1024 * 1024,
      maxUploadFiles: 10,
      maxConcurrentJobs: 1,
      blockPrivateNetworks: true,
    });
    const boundary = "XBOUNDARY";
    const part = (name: string, filename: string | null, body: string) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"${filename ? `; filename="${filename}"` : ""}\r\n\r\n${body}\r\n`;
    const payload = JSON.stringify({ title: "t", sources: [{ kind: "upload", value: "0" }] });
    const body =
      part("payload", null, payload) +
      part("upload:0", "site/mkdocs.yml", "nav: []") +
      part("upload:0", "site/docs/a.md", "# A") +
      `--${boundary}--\r\n`;
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(202);
    const sourceValue: string = res.json().sources[0].value;
    expect(sourceValue.endsWith("/upload-0/site")).toBe(true);
    await new Promise((r) => setTimeout(r, 500));
    await app.close();
  });
});
