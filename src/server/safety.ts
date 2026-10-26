import { lookup } from "node:dns/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { unzipSync } from "fflate";

export function resolveInside(root: string, candidate: string): string {
  const base = resolve(root);
  const full = isAbsolute(candidate) ? resolve(candidate) : resolve(base, candidate);
  const rel = relative(base, full);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("Path escapes the allowed directory.");
  }
  return full;
}

// Returns a sanitized relative path, or throws when the entry name is unsafe.
export function safeRelativePath(name: string): string {
  const normalized = name.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter((p) => p.length > 0 && p !== ".");
  if (parts.length === 0 || parts.some((p) => p === ".." || p.includes("\0"))) {
    throw new Error(`Unsafe file path: ${name}`);
  }
  return parts.join("/");
}

export interface ExtractLimits {
  maxBytes: number;
  maxFiles: number;
}

export async function extractZipSafely(data: Uint8Array, destDir: string, limits: ExtractLimits): Promise<number> {
  let total = 0;
  let count = 0;
  const entries = unzipSync(data, {
    filter: (file) => {
      if (file.name.endsWith("/")) return false;
      count += 1;
      total += file.originalSize;
      if (count > limits.maxFiles) throw new Error("Zip contains too many files.");
      if (total > limits.maxBytes) throw new Error("Zip expands beyond the allowed size.");
      return true;
    },
  });

  let written = 0;
  for (const [name, content] of Object.entries(entries)) {
    const target = resolveInside(destDir, safeRelativePath(name));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
    written += 1;
  }
  return written;
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
  return lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
}

export async function assertPublicHttpUrl(value: string, blockPrivate: boolean): Promise<void> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed.");
  }
  if (!blockPrivate) return;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.some(isPrivateAddress)) {
    throw new Error("URLs resolving to private or loopback addresses are blocked.");
  }
}
