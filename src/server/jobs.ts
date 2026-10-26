import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildCliArgs, type JobRequest } from "./args.js";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface JobRecord {
  id: string;
  title: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  error?: string;
  request: JobRequest;
  sources: { kind: string; value: string }[];
}

export interface JobManagerOptions {
  dataDir: string;
  cliPath: string;
  maxConcurrentJobs: number;
}

const MAX_LOG_LINES = 5000;
const FILE_NAMES = { md: "combined.md", pdf: "combined.pdf", report: "report.json" } as const;
export type JobFileKey = keyof typeof FILE_NAMES;

export class JobManager {
  private jobs = new Map<string, JobRecord>();
  private logs = new Map<string, string[]>();
  private children = new Map<string, ChildProcess>();
  private queue: string[] = [];
  private events = new EventEmitter();
  readonly cacheDir: string;

  constructor(private opts: JobManagerOptions) {
    this.cacheDir = join(opts.dataDir, "cache");
    this.events.setMaxListeners(0);
  }

  jobDir(id: string): string {
    return join(this.opts.dataDir, "jobs", id);
  }

  inputDir(id: string): string {
    return join(this.jobDir(id), "input");
  }

  newId(): string {
    return randomUUID();
  }

  async init(): Promise<void> {
    await mkdir(join(this.opts.dataDir, "jobs"), { recursive: true });
    await mkdir(this.cacheDir, { recursive: true });
    for (const id of await readdir(join(this.opts.dataDir, "jobs"))) {
      try {
        const job = JSON.parse(await readFile(join(this.jobDir(id), "job.json"), "utf8")) as JobRecord;
        if (job.status === "queued" || job.status === "running") {
          job.status = "failed";
          job.error = "Interrupted by server restart.";
          job.finishedAt = new Date().toISOString();
          await this.persist(job);
        }
        this.jobs.set(job.id, job);
      } catch {
        // Skip directories without a readable job.json.
      }
    }
  }

  list(): JobRecord[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  hasRunningJobs(): boolean {
    return this.children.size > 0 || this.queue.length > 0;
  }

  filePath(id: string, key: JobFileKey): string {
    return join(this.jobDir(id), "out", FILE_NAMES[key]);
  }

  availableFiles(id: string): Record<JobFileKey, boolean> {
    return {
      md: existsSync(this.filePath(id, "md")),
      pdf: existsSync(this.filePath(id, "pdf")),
      report: existsSync(this.filePath(id, "report")),
    };
  }

  async getLog(id: string): Promise<string[]> {
    const live = this.logs.get(id);
    if (live) return live;
    try {
      return (await readFile(join(this.jobDir(id), "job.log"), "utf8")).split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }

  async enqueue(
    id: string,
    request: JobRequest,
    sources: { kind: "github-wiki" | "readthedocs" | "local"; value: string }[],
  ): Promise<JobRecord> {
    await mkdir(join(this.jobDir(id), "out"), { recursive: true });
    const job: JobRecord = {
      id,
      title: request.title,
      status: "queued",
      createdAt: new Date().toISOString(),
      request,
      sources,
    };
    this.jobs.set(id, job);
    this.logs.set(id, []);
    await this.persist(job);
    this.queue.push(id);
    this.pump();
    return job;
  }

  subscribe(id: string, onLine: (line: string) => void, onStatus: (job: JobRecord) => void): () => void {
    const lineEvent = `line:${id}`;
    const statusEvent = `status:${id}`;
    this.events.on(lineEvent, onLine);
    this.events.on(statusEvent, onStatus);
    return () => {
      this.events.off(lineEvent, onLine);
      this.events.off(statusEvent, onStatus);
    };
  }

  async cancel(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job) return false;
    const queuedAt = this.queue.indexOf(id);
    if (queuedAt >= 0) {
      this.queue.splice(queuedAt, 1);
      await this.finish(job, "cancelled", null);
      return true;
    }
    const child = this.children.get(id);
    if (child) {
      job.status = "cancelled";
      child.kill("SIGTERM");
      return true;
    }
    return false;
  }

  async remove(id: string): Promise<boolean> {
    if (!this.jobs.has(id)) return false;
    await this.cancel(id);
    this.jobs.delete(id);
    this.logs.delete(id);
    await rm(this.jobDir(id), { recursive: true, force: true });
    return true;
  }

  async clearCache(): Promise<void> {
    await rm(this.cacheDir, { recursive: true, force: true });
    await mkdir(this.cacheDir, { recursive: true });
  }

  private pump(): void {
    while (this.children.size < this.opts.maxConcurrentJobs && this.queue.length > 0) {
      const id = this.queue.shift()!;
      const job = this.jobs.get(id);
      if (job) void this.run(job);
    }
  }

  private async run(job: JobRecord): Promise<void> {
    job.status = "running";
    job.startedAt = new Date().toISOString();
    await this.persist(job);
    this.events.emit(`status:${job.id}`, job);

    const args = buildCliArgs(
      job.request,
      job.sources as { kind: "github-wiki" | "readthedocs" | "local"; value: string }[],
      {
        outMd: this.filePath(job.id, "md"),
        outPdf: this.filePath(job.id, "pdf"),
        reportJson: this.filePath(job.id, "report"),
        cacheDir: this.cacheDir,
      },
    );

    const child = spawn(process.execPath, [this.opts.cliPath, ...args], {
      cwd: this.jobDir(job.id),
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.children.set(job.id, child);

    const feed = (chunk: Buffer, carry: { rest: string }) => {
      const parts = (carry.rest + chunk.toString("utf8")).split("\n");
      carry.rest = parts.pop() ?? "";
      parts.forEach((line) => this.appendLog(job.id, line));
    };
    const out = { rest: "" };
    const err = { rest: "" };
    child.stdout!.on("data", (c: Buffer) => feed(c, out));
    child.stderr!.on("data", (c: Buffer) => feed(c, err));

    child.on("error", (e) => {
      this.children.delete(job.id);
      void this.finish(job, "failed", null, `Failed to start CLI: ${e.message}`).then(() => this.pump());
    });
    child.on("close", (code) => {
      if (out.rest) this.appendLog(job.id, out.rest);
      if (err.rest) this.appendLog(job.id, err.rest);
      if (!this.children.delete(job.id)) return;
      const status: JobStatus = job.status === "cancelled" ? "cancelled" : code === 0 ? "succeeded" : "failed";
      void this.finish(job, status, code).then(() => this.pump());
    });
  }

  private appendLog(id: string, line: string): void {
    const lines = this.logs.get(id);
    if (!lines) return;
    lines.push(line);
    if (lines.length > MAX_LOG_LINES) lines.shift();
    this.events.emit(`line:${id}`, line);
  }

  private async finish(job: JobRecord, status: JobStatus, code: number | null, error?: string): Promise<void> {
    if (!this.jobs.has(job.id)) return;
    job.status = status;
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    if (error) job.error = error;
    await this.persist(job);
    await writeFile(join(this.jobDir(job.id), "job.log"), (this.logs.get(job.id) ?? []).join("\n") + "\n").catch(
      () => undefined,
    );
    this.events.emit(`status:${job.id}`, job);
  }

  private async persist(job: JobRecord): Promise<void> {
    await mkdir(this.jobDir(job.id), { recursive: true });
    await writeFile(join(this.jobDir(job.id), "job.json"), JSON.stringify(job, null, 2));
  }
}
