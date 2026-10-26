import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export interface ServerConfig {
  port: number;
  host: string;
  dataDir: string;
  workspaceDir: string;
  cliPath: string;
  publicDir: string;
  maxUploadBytes: number;
  maxUploadFiles: number;
  maxConcurrentJobs: number;
  blockPrivateNetworks: boolean;
  basicAuthUser?: string;
  basicAuthPass?: string;
}

function intEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function loadConfig(): ServerConfig {
  return {
    port: intEnv("PORT", 8080),
    host: process.env.HOST ?? "0.0.0.0",
    dataDir: resolve(process.env.DATA_DIR ?? "data"),
    workspaceDir: resolve(process.env.WORKSPACE_DIR ?? "docs-input"),
    cliPath: fileURLToPath(new URL("../cli.js", import.meta.url)),
    publicDir: resolve(process.env.PUBLIC_DIR ?? fileURLToPath(new URL("../../public", import.meta.url))),
    maxUploadBytes: intEnv("MAX_UPLOAD_MB", 100) * 1024 * 1024,
    maxUploadFiles: intEnv("MAX_UPLOAD_FILES", 5000),
    maxConcurrentJobs: intEnv("MAX_CONCURRENT_JOBS", 1),
    blockPrivateNetworks: (process.env.BLOCK_PRIVATE_NETWORKS ?? "true").toLowerCase() !== "false",
    basicAuthUser: process.env.BASIC_AUTH_USER || undefined,
    basicAuthPass: process.env.BASIC_AUTH_PASS || undefined,
  };
}
