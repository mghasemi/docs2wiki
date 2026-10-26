import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import yaml from "js-yaml";

export interface MkdocsNavEntry {
  path: string;
  title?: string;
}

export interface MkdocsProject {
  configPath: string;
  docsDir: string;
  siteName?: string;
  nav: MkdocsNavEntry[];
}

// MkDocs configs use custom tags such as !!python/name:...; treat them as plain values.
const TAGS = ["scalar", "sequence", "mapping"].flatMap((kind) =>
  ["tag:yaml.org,2002:python/name:", "tag:yaml.org,2002:python/object/apply:", "!ENV", "!relative"].map(
    (tag) => new yaml.Type(tag, { kind: kind as "scalar" | "sequence" | "mapping", multi: true, construct: () => null }),
  ),
);
const MKDOCS_SCHEMA = yaml.DEFAULT_SCHEMA.extend(TAGS);

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function normalizeNavPath(value: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  const clean = value.split("#")[0].replace(/^\.\//, "");
  return clean.length > 0 ? clean : null;
}

export function flattenNav(nav: unknown, out: MkdocsNavEntry[] = [], title?: string): MkdocsNavEntry[] {
  if (typeof nav === "string") {
    const path = normalizeNavPath(nav);
    if (path) out.push({ path, title });
    return out;
  }
  if (Array.isArray(nav)) {
    for (const item of nav) flattenNav(item, out);
    return out;
  }
  if (typeof nav === "object" && nav) {
    for (const [key, value] of Object.entries(nav as Record<string, unknown>)) {
      flattenNav(value, out, typeof value === "string" ? key : undefined);
    }
  }
  return out;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

// Returns null when rootDir is not an MkDocs project (no readable mkdocs.yml/.yaml).
export async function loadMkdocsProject(rootDir: string): Promise<MkdocsProject | null> {
  for (const name of ["mkdocs.yml", "mkdocs.yaml"]) {
    const configPath = resolve(rootDir, name);
    let text: string;
    try {
      text = await readFile(configPath, "utf8");
    } catch {
      continue;
    }

    let config: Record<string, unknown>;
    try {
      const parsed = yaml.load(text, { schema: MKDOCS_SCHEMA });
      config = typeof parsed === "object" && parsed ? (parsed as Record<string, unknown>) : {};
    } catch {
      return null;
    }

    const configuredDocs = typeof config.docs_dir === "string" ? config.docs_dir : "docs";
    const candidate = resolve(rootDir, configuredDocs);
    const docsDir = isInside(resolve(rootDir), candidate) && (await isDirectory(candidate)) ? candidate : resolve(rootDir);

    return {
      configPath,
      docsDir,
      siteName: typeof config.site_name === "string" ? config.site_name : undefined,
      nav: flattenNav(config.nav),
    };
  }
  return null;
}

const CONFIG_NAMES = ["mkdocs.yml", "mkdocs.yaml"];

async function hasConfig(dir: string): Promise<boolean> {
  for (const name of CONFIG_NAMES) {
    try {
      if ((await stat(resolve(dir, name))).isFile()) return true;
    } catch {
      // not present
    }
  }
  return false;
}

// Uploads are usually wrapped in a top-level folder; find the directory that holds mkdocs.yml
// (searching up to `maxDepth` levels, shallowest first), else unwrap single-folder wrappers.
export async function findProjectRoot(dir: string, maxDepth = 3): Promise<string> {
  let level = [resolve(dir)];
  for (let depth = 0; depth <= maxDepth && level.length > 0; depth++) {
    for (const candidate of level) {
      if (await hasConfig(candidate)) return candidate;
    }
    const next: string[] = [];
    for (const candidate of level) {
      for (const entry of await readdir(candidate, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "__MACOSX" && entry.name !== "node_modules") {
          next.push(resolve(candidate, entry.name));
        }
      }
    }
    level = next;
  }

  let current = resolve(dir);
  for (let i = 0; i < maxDepth; i++) {
    const entries = (await readdir(current, { withFileTypes: true })).filter((e) => e.name !== "__MACOSX");
    if (entries.length === 1 && entries[0].isDirectory()) current = resolve(current, entries[0].name);
    else break;
  }
  return current;
}
