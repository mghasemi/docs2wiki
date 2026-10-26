import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseJobRequest, type JobRequest } from "./args.js";
import { loadConfig, type ServerConfig } from "./config.js";
import { findProjectRoot } from "../adapters/mkdocs.js";
import { JobManager, type JobFileKey } from "./jobs.js";
import { assertPublicHttpUrl, extractZipSafely, resolveInside, safeRelativePath } from "./safety.js";

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function listFolders(root: string, maxDepth: number): Promise<string[]> {
  const result: string[] = ["."];
  async function walk(dir: string, rel: string, depth: number): Promise<void> {
    if (depth >= maxDepth) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      result.push(childRel);
      await walk(join(dir, entry.name), childRel, depth + 1);
    }
  }
  await walk(root, "", 0);
  return result;
}

const CONTENT_TYPES: Record<JobFileKey, string> = {
  md: "text/markdown; charset=utf-8",
  pdf: "application/pdf",
  report: "application/json; charset=utf-8",
};
const DOWNLOAD_NAMES: Record<JobFileKey, string> = { md: "combined.md", pdf: "combined.pdf", report: "report.json" };

export async function buildServer(config: ServerConfig = loadConfig()): Promise<{ app: FastifyInstance; jobs: JobManager }> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 1024 * 1024 });
  const jobs = new JobManager({
    dataDir: config.dataDir,
    cliPath: config.cliPath,
    maxConcurrentJobs: config.maxConcurrentJobs,
  });
  await jobs.init();

  if (config.basicAuthUser && config.basicAuthPass) {
    const expected = { user: config.basicAuthUser, pass: config.basicAuthPass };
    app.addHook("onRequest", async (req, reply) => {
      if (req.url === "/api/health") return;
      const header = req.headers.authorization ?? "";
      const decoded = header.startsWith("Basic ") ? Buffer.from(header.slice(6), "base64").toString("utf8") : "";
      const sep = decoded.indexOf(":");
      const ok = sep >= 0 && safeEqual(decoded.slice(0, sep), expected.user) && safeEqual(decoded.slice(sep + 1), expected.pass);
      if (!ok) {
        reply.header("WWW-Authenticate", 'Basic realm="docs2wiki"').code(401).send({ error: "Authentication required." });
      }
    });
  }

  await app.register(fastifyMultipart, {
    preservePath: true,
    limits: { fileSize: config.maxUploadBytes, files: config.maxUploadFiles, fields: 20, fieldSize: 256 * 1024 },
  });
  if (existsSync(config.publicDir)) {
    await app.register(fastifyStatic, { root: config.publicDir });
  }

  app.get("/api/health", async () => ({ status: "ok" }));

  app.get("/api/config", async () => ({
    workspaceAvailable: existsSync(config.workspaceDir),
    folders: existsSync(config.workspaceDir) ? await listFolders(config.workspaceDir, 3) : [],
    maxUploadMb: Math.floor(config.maxUploadBytes / 1024 / 1024),
    maxConcurrentJobs: config.maxConcurrentJobs,
    authEnabled: Boolean(config.basicAuthUser && config.basicAuthPass),
  }));

  const present = (id: string) => {
    const job = jobs.get(id)!;
    return { ...job, files: jobs.availableFiles(id) };
  };

  app.get("/api/jobs", async () => jobs.list().map((j) => present(j.id)));

  app.get<{ Params: { id: string } }>("/api/jobs/:id", async (req, reply) => {
    if (!jobs.get(req.params.id)) return reply.code(404).send({ error: "Job not found." });
    const job = present(req.params.id);
    let warnings: unknown[] = [];
    let pages: number | undefined;
    if (job.files.report) {
      try {
        const report = JSON.parse(await readFile(jobs.filePath(job.id, "report"), "utf8"));
        warnings = report?.result?.warnings ?? [];
        pages = report?.result?.pagesProcessed;
      } catch {
        // A partially written report is not fatal.
      }
    }
    return { ...job, warnings, pages };
  });

  app.post("/api/jobs", async (req, reply) => {
    const id = jobs.newId();
    try {
      let payload: unknown;
      const uploads = new Map<string, { path: string; data: Buffer }[]>();
      let uploadBytes = 0;

      if (req.isMultipart()) {
        for await (const part of req.parts()) {
          if (part.type === "field") {
            if (part.fieldname === "payload") payload = JSON.parse(String(part.value));
          } else {
            const data = await part.toBuffer();
            uploadBytes += data.length;
            if (uploadBytes > config.maxUploadBytes) throw new Error("Upload exceeds the size limit.");
            const key = part.fieldname.replace(/^upload:/, "");
            const list = uploads.get(key) ?? [];
            list.push({ path: part.filename, data });
            uploads.set(key, list);
          }
        }
      } else {
        payload = req.body;
      }

      const request: JobRequest = parseJobRequest(payload);
      const resolved: { kind: "github-wiki" | "readthedocs" | "local"; value: string }[] = [];

      for (const source of request.sources) {
        if (source.kind === "github-wiki" || source.kind === "readthedocs") {
          await assertPublicHttpUrl(source.value, config.blockPrivateNetworks);
          resolved.push({ kind: source.kind, value: source.value });
        } else if (source.kind === "local") {
          const dir = resolveInside(config.workspaceDir, source.value);
          if (!existsSync(dir) || !(await stat(dir)).isDirectory()) throw new Error(`Folder not found: ${source.value}`);
          resolved.push({ kind: "local", value: dir });
        } else {
          const files = uploads.get(source.value);
          if (!files || files.length === 0) throw new Error(`Missing upload for source "${source.value}".`);
          if (files.length > config.maxUploadFiles) throw new Error("Too many uploaded files.");
          const dest = join(jobs.inputDir(id), `upload-${resolved.length}`);
          await mkdir(dest, { recursive: true });
          const isZip = files.length === 1 && files[0].path.toLowerCase().endsWith(".zip");
          if (isZip) {
            await extractZipSafely(files[0].data, dest, { maxBytes: config.maxUploadBytes, maxFiles: config.maxUploadFiles });
          } else {
            for (const f of files) {
              const target = resolveInside(dest, safeRelativePath(f.path));
              await mkdir(dirname(target), { recursive: true });
              await writeFile(target, f.data);
            }
          }
          resolved.push({ kind: "local", value: await findProjectRoot(dest) });
        }
      }

      const job = await jobs.enqueue(id, request, resolved);
      return reply.code(202).send(present(job.id));
    } catch (error) {
      await rm(jobs.jobDir(id), { recursive: true, force: true }).catch(() => undefined);
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { id: string } }>("/api/jobs/:id/events", async (req, reply) => {
    const job = jobs.get(req.params.id);
    if (!job) return reply.code(404).send({ error: "Job not found." });
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    const unsubscribe = jobs.subscribe(
      job.id,
      (line) => send("log", line),
      (j) => {
        send("status", present(j.id));
        if (["succeeded", "failed", "cancelled"].includes(j.status)) res.end();
      },
    );
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
    req.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    for (const line of await jobs.getLog(job.id)) send("log", line);
    send("status", present(job.id));
    if (["succeeded", "failed", "cancelled"].includes(job.status)) res.end();
  });

  app.get<{ Params: { id: string; name: string } }>("/api/jobs/:id/files/:name", async (req, reply: FastifyReply) => {
    const key = req.params.name as JobFileKey;
    if (!jobs.get(req.params.id) || !(key in CONTENT_TYPES)) return reply.code(404).send({ error: "Not found." });
    const path = jobs.filePath(req.params.id, key);
    if (!existsSync(path)) return reply.code(404).send({ error: "File not available." });
    return reply
      .header("Content-Type", CONTENT_TYPES[key])
      .header("Content-Disposition", `attachment; filename="${DOWNLOAD_NAMES[key]}"`)
      .send(createReadStream(path));
  });

  app.post<{ Params: { id: string } }>("/api/jobs/:id/cancel", async (req, reply) => {
    const ok = await jobs.cancel(req.params.id);
    return ok ? { ok: true } : reply.code(404).send({ error: "Job not found or not active." });
  });

  app.delete<{ Params: { id: string } }>("/api/jobs/:id", async (req, reply) => {
    return (await jobs.remove(req.params.id)) ? { ok: true } : reply.code(404).send({ error: "Job not found." });
  });

  app.post("/api/cache/clear", async (_req, reply) => {
    if (jobs.hasRunningJobs()) return reply.code(409).send({ error: "Cannot clear cache while jobs are active." });
    await jobs.clearCache();
    return { ok: true };
  });

  return { app, jobs };
}
