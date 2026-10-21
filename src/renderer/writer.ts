import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
  readdir,
  mkdtemp,
  rmdir,
  lstat,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { safeOutputPath } from "../core/site-model.js";

const inventoryName = ".sourcey-output.json";
const digest = (body: string | Buffer) => createHash("sha256").update(body).digest("hex");
async function existing(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** A lexical child path must also stay inside the owned tree on disk. */
async function plainOutputPath(
  root: string,
  target: string,
  directories: Set<string>,
): Promise<void> {
  for (let path = target; ; path = dirname(path)) {
    if (directories.has(path)) return;
    const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (info?.isSymbolicLink()) throw new Error(`Output contains a symbolic link: ${path}`);
    if (info && path !== target && !info.isDirectory())
      throw new Error(`Output parent is not a directory: ${path}`);
    if (info?.isDirectory()) directories.add(path);
    if (path === root) return;
  }
}

interface Change {
  target: string;
  body?: string | Buffer;
  existed: boolean;
  staged?: string;
  backup?: string;
  installed?: boolean;
}

/**
 * Own standalone output exclusively. Preflight all conflicts before promotion;
 * retain replaced/pruned files until the new inventory commits, so an ordinary
 * filesystem failure can roll the generation back. Astro never uses this writer.
 */
export async function writeArtifacts(
  outputDir: string,
  files: ReadonlyMap<string, string | Buffer>,
): Promise<void> {
  const root = resolve(outputDir);
  if (root === resolve("/") || root === resolve(process.cwd()))
    throw new Error(`Refusing to own source directory: ${root}`);
  const directories = new Set<string>();
  const inventoryPath = resolve(root, inventoryName);
  await plainOutputPath(root, inventoryPath, directories);
  const inventory = await existing(inventoryPath);
  let previous: Record<string, string> = {};
  if (inventory) {
    previous = JSON.parse(inventory.toString("utf8"));
    if (
      !previous ||
      typeof previous !== "object" ||
      Array.isArray(previous) ||
      Object.values(previous).some((hash) => typeof hash !== "string")
    )
      throw new Error("Invalid output inventory");
    Object.keys(previous).forEach(safeOutputPath);
  } else {
    const entries = await readdir(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    if (entries.length)
      throw new Error(
        `Output directory is not owned by Sourcey: ${root}. Choose an empty build directory. ` +
          "Sourcey before 3.8 kept no record of its files, so delete a directory one built once.",
      );
  }

  const next: Record<string, string> = Object.create(null);
  const changes: Change[] = [];
  const folded = new Set<string>();
  const entries = [...files];
  for (let start = 0; start < entries.length; start += 32) {
    const prepared = await Promise.all(
      entries.slice(start, start + 32).map(async ([path, body]): Promise<Change | undefined> => {
        safeOutputPath(path);
        if (path === inventoryName || path.startsWith(".sourcey-write-"))
          throw new Error(`Reserved output path: ${path}`);
        const key = path.normalize("NFC").toLowerCase();
        if (folded.has(key)) throw new Error(`Output collision: ${path}`);
        folded.add(key);
        const hash = (next[path] = digest(body)),
          target = resolve(root, path);
        await plainOutputPath(root, target, directories);
        const actual = await existing(target);
        if (actual !== undefined && !Object.hasOwn(previous, path))
          throw new Error(`Refusing to overwrite unowned output: ${target}`);
        if (actual && digest(actual) === hash) return undefined;
        return { target, body, existed: actual !== undefined };
      }),
    );
    for (const change of prepared) if (change) changes.push(change);
  }
  // A prune conflict must leave every page and the inventory untouched.
  for (const [path, hash] of Object.entries(previous)) {
    if (Object.hasOwn(next, path)) continue;
    const target = resolve(root, path);
    await plainOutputPath(root, target, directories);
    const actual = await existing(target);
    if (actual && digest(actual) !== hash)
      throw new Error(`Refusing to prune modified output: ${target}`);
    if (actual) changes.push({ target, existed: true });
  }
  // Artifact completion order is not part of the output generation's identity.
  const nextInventory = JSON.stringify(Object.fromEntries(Object.entries(next).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
  if (inventory?.toString("utf8") !== nextInventory)
    changes.push({ target: inventoryPath, body: nextInventory, existed: inventory !== undefined });
  if (!changes.length) return;

  await mkdir(root, { recursive: true });
  const staging = await mkdtemp(join(root, ".sourcey-write-"));
  const created = new Set<string>();
  let recovered = true;
  try {
    // Staging cannot replace a live artifact.
    for (const [i, change] of changes.entries()) {
      if (change.body === undefined) continue;
      change.staged = join(staging, `${i}.next`);
      await writeFile(change.staged, change.body);
    }
    try {
      for (const [i, change] of changes.entries()) {
        const first = await mkdir(dirname(change.target), { recursive: true });
        if (first)
          for (let path = dirname(change.target); path !== dirname(first); path = dirname(path))
            created.add(path);
        if (change.existed) {
          const backup = join(staging, `${i}.previous`);
          await rename(change.target, backup);
          change.backup = backup;
        }
        if (change.staged) {
          await rename(change.staged, change.target);
          change.installed = true;
        }
      }
    } catch (error) {
      const failures: unknown[] = [];
      for (const change of [...changes].reverse()) {
        try {
          if (change.installed) await rm(change.target, { force: true });
          if (change.backup) await rename(change.backup, change.target);
        } catch (failure) {
          failures.push(failure);
        }
      }
      for (const path of [...created].sort((a, b) => b.length - a.length)) {
        try {
          await rmdir(path);
        } catch (failure) {
          if (!["ENOENT", "ENOTEMPTY"].includes((failure as NodeJS.ErrnoException).code ?? ""))
            failures.push(failure);
        }
      }
      if (failures.length) {
        recovered = false;
        throw new AggregateError(
          [error, ...failures],
          `Output rollback failed; recovery files remain at ${staging}`,
          { cause: error },
        );
      }
      throw error;
    }
  } finally {
    if (recovered) {
      try {
        await rm(staging, { recursive: true, force: true });
      } catch (error) {
        // Cleanup cannot turn a committed generation into a reported failure,
        // or hide the original error after a successful rollback.
        console.warn(`Sourcey: could not remove output staging directory ${staging}`, error);
      }
    }
  }
}
