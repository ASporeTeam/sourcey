import { createHash } from "node:crypto";
import { createRequire, isBuiltin } from "node:module";
import {
  readFile,
  readdir,
  realpath,
  stat,
  mkdir,
  mkdtemp,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const engine = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const moduleTree = join(engine, fileURLToPath(import.meta.url).endsWith(".ts") ? "src" : "dist");
const directory = join(tmpdir(), "sourcey-artifacts");
const sha = (body: string | Buffer) => createHash("sha256").update(body).digest("hex");
const identities = new Map<string, Promise<string>>();
const memory = new Map<string, Promise<Map<string, Buffer>>>();
const sizes = new Map<string, number>();
let memoryBytes = 0;
function evict(key: string) {
  memory.delete(key);
  memoryBytes -= sizes.get(key) ?? 0;
  sizes.delete(key);
}

/** Resolve the installed package from its importer, including nested installs. */
async function packageFile(name: string, importer: string): Promise<string | undefined> {
  for (const root of createRequire(importer).resolve.paths(name) ?? []) {
    const path = join(root, name, "package.json");
    try {
      return await realpath(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return undefined;
}

/** Installed bytes, rather than a version label, establish transform identity. */
async function transformIdentity(dependencies: string[]): Promise<string> {
  const key = JSON.stringify([...dependencies].sort());
  let pending = identities.get(key);
  if (!pending) {
    pending = (async () => {
      const files: [string, string][] = [],
        edges: [string, string, string | null][] = [];
      async function walk(
        root: string,
        prefix: string,
        ancestors = new Set<string>(),
      ): Promise<void> {
        const canonical = await realpath(root);
        if (ancestors.has(canonical)) throw new Error(`Artifact dependency cycle: ${root}`);
        const branch = new Set([...ancestors, canonical]);
        for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) =>
          a.name.localeCompare(b.name),
        )) {
          if (entry.name === "node_modules" || entry.name === ".git") continue;
          const path = join(root, entry.name),
            name = `${prefix}/${entry.name}`;
          const info = entry.isSymbolicLink() ? await stat(path) : entry;
          if (info.isDirectory()) await walk(path, name, branch);
          else if (info.isFile()) files.push([name, path]);
        }
      }
      await walk(moduleTree, "engine");
      files.push(["engine/package.json", join(engine, "package.json")]);
      const visited = new Set<string>();
      async function visit(name: string, importer: string): Promise<void> {
        if (isBuiltin(name)) return;
        const path = await packageFile(name, importer);
        edges.push([importer, name, path ?? null]);
        if (!path || visited.has(path)) return;
        visited.add(path);
        const pkg = JSON.parse(await readFile(path, "utf8")) as {
          dependencies?: Record<string, string>;
          optionalDependencies?: Record<string, string>;
          peerDependencies?: Record<string, string>;
        };
        await walk(dirname(path), path);
        for (const dependency of Object.keys({
          ...pkg.dependencies,
          ...pkg.optionalDependencies,
          ...pkg.peerDependencies,
        }).sort())
          await visit(dependency, path);
      }
      for (const dependency of [...dependencies].sort())
        await visit(dependency, join(engine, "package.json"));
      const hashes: [string, string][] = [];
      for (let start = 0; start < files.length; start += 32)
        hashes.push(
          ...(await Promise.all(
            files
              .slice(start, start + 32)
              .map(async ([name, path]): Promise<[string, string]> => [
                name,
                sha(await readFile(path)),
              ]),
          )),
        );
      return sha(JSON.stringify([process.version, process.platform, process.arch, edges, hashes]));
    })();
    identities.set(key, pending);
    pending.catch(() => identities.delete(key));
  }
  return pending;
}

interface CachedFile {
  name: string;
  hash: string;
  size: number;
}
async function readEntry(path: string): Promise<Map<string, Buffer> | undefined> {
  try {
    const record = JSON.parse(await readFile(join(path, "record.json"), "utf8")) as CachedFile[];
    if (
      !Array.isArray(record) ||
      record.length > 128 ||
      record.some(
        (file) =>
          !file ||
          typeof file.name !== "string" ||
          !/^[a-f0-9]{64}$/.test(file.hash) ||
          !Number.isSafeInteger(file.size) ||
          file.size < 0,
      ) ||
      record.reduce((size, file) => size + file.size, 0) > 64 * 1024 * 1024
    )
      return undefined;
    const result = new Map<string, Buffer>();
    for (const [index, file] of record.entries()) {
      const body = await readFile(join(path, String(index)));
      if (body.length !== file.size || sha(body) !== file.hash || result.has(file.name))
        return undefined;
      result.set(file.name, body);
    }
    return result;
  } catch {
    return undefined;
  }
}

async function prune(): Promise<void> {
  const entries: { path: string; modified: number; size: number }[] = [];
  for (const name of await readdir(directory)) {
    if (name.startsWith(".write-")) {
      const path = join(directory, name);
      if (Date.now() - (await stat(path)).mtimeMs > 24 * 60 * 60 * 1000)
        await rm(path, { recursive: true, force: true });
      continue;
    }
    if (!/^[a-f0-9]{64}$/.test(name)) continue;
    const path = join(directory, name);
    try {
      const files = JSON.parse(await readFile(join(path, "record.json"), "utf8")) as CachedFile[];
      const size = files.reduce((total, file) => total + file.size, 0);
      if (Number.isFinite(size) && size >= 0)
        entries.push({ path, size, modified: (await stat(path)).mtimeMs });
    } catch {
      await rm(path, { recursive: true, force: true }).catch(() => {});
    }
  }
  let total = entries.reduce((size, entry) => size + entry.size, 0);
  for (const entry of entries.sort((a, b) => a.modified - b.modified)) {
    if (total <= 512 * 1024 * 1024) break;
    await rm(entry.path, { recursive: true, force: true });
    total -= entry.size;
  }
}

let nextPrune = 0;
let addedBytes = 0;
let pruning: Promise<void> | undefined;
/** Amortize directory maintenance across many small artifacts, such as cards. */
async function maintainCache(bytes: number): Promise<void> {
  addedBytes += bytes;
  if (pruning || Date.now() < nextPrune && addedBytes < 32 * 1024 * 1024) return;
  addedBytes = 0;
  nextPrune = Date.now() + 60_000;
  const job = pruning = prune();
  try { await job; }
  finally { if (pruning === job) pruning = undefined; }
}

/** A disposable cache: cache I/O never decides whether a correct build succeeds. */
export async function cachedArtifacts(
  kind: string,
  source: string,
  dependencies: string[],
  build: () => Promise<Map<string, Buffer>>,
): Promise<Map<string, Buffer>> {
  let identity: string;
  try {
    identity = await transformIdentity(dependencies);
  } catch {
    return build();
  }
  const key = sha(JSON.stringify([kind, source, identity]));
  let pending = memory.get(key);
  if (!pending) {
    pending = (async () => {
      const path = join(directory, key);
      const cached = await readEntry(path);
      if (cached) return cached;
      const result = await build();
      if (
        result.size > 128 ||
        [...result.values()].reduce((size, body) => size + body.length, 0) > 64 * 1024 * 1024
      )
        return result;
      let staging: string | undefined;
      try {
        await mkdir(directory, { recursive: true });
        staging = await mkdtemp(join(directory, ".write-"));
        const record: CachedFile[] = [];
        for (const [index, [name, body]] of [...result].entries()) {
          await writeFile(join(staging, String(index)), body);
          record.push({ name, hash: sha(body), size: body.length });
        }
        await writeFile(join(staging, "record.json"), JSON.stringify(record));
        await rm(path, { recursive: true, force: true });
        await rename(staging, path);
        staging = undefined;
        await maintainCache(record.reduce((bytes, file) => bytes + file.size, 0));
      } catch {
        /* Recompute on the next build when cache storage is unavailable. */
      } finally {
        if (staging) await rm(staging, { recursive: true, force: true }).catch(() => {});
      }
      return result;
    })();
    memory.set(key, pending);
    if (memory.size > 32) evict(memory.keys().next().value!);
    pending.then(
      (files) => {
        if (memory.get(key) !== pending) return;
        const bytes = [...files.values()].reduce((size, body) => size + body.length, 0);
        sizes.set(key, bytes);
        memoryBytes += bytes;
        while (memoryBytes > 64 * 1024 * 1024 && memory.size) evict(memory.keys().next().value!);
      },
      () => evict(key),
    );
  }
  return pending;
}
