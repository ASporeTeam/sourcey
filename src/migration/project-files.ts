import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { MigrationChange } from "./types.js";

/** Kept only while an application is in progress. */
export const RECOVERY_DIRECTORY = ".sourcey-migration";

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The project as the converter sees it. Every read records the bytes it saw,
 * every write is a proposal; nothing reaches disk until `applyChanges`.
 */
export class ProjectFiles {
  readonly root: string;
  private readonly seen = new Map<string, string | null>();
  private readonly proposed = new Map<string, { bytes: Buffer | null; reason: string }>();

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Normalised project-relative path, refusing anything outside the root. */
  path(path: string): string {
    const absolute = isAbsolute(path) ? resolve(path) : resolve(this.root, path);
    const rel = relative(this.root, absolute);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Path outside the project: ${path}`);
    const normalised = rel.split(sep).join("/");
    if (normalised === RECOVERY_DIRECTORY || normalised.startsWith(`${RECOVERY_DIRECTORY}/`))
      throw new Error(`Reserved migration path: ${path}`);
    return normalised;
  }

  absolute(path: string): string {
    return join(this.root, this.path(path));
  }

  async exists(path: string): Promise<boolean> {
    const rel = this.path(path);
    const proposal = this.proposed.get(rel);
    if (proposal) return proposal.bytes !== null;
    return (await this.stat(rel)) !== undefined;
  }

  async isDirectory(path: string): Promise<boolean> {
    return (await this.stat(this.path(path)))?.isDirectory() ?? false;
  }

  /** Whether a regular file is on disk, regardless of proposals; imports resolve against the source as written. */
  async isFileOnDisk(path: string): Promise<boolean> {
    return (await this.stat(this.path(path)))?.isFile() ?? false;
  }

  async readBytes(path: string): Promise<Buffer> {
    const rel = this.path(path);
    const proposal = this.proposed.get(rel);
    if (proposal) {
      if (proposal.bytes === null) throw new Error(`File removed by this migration: ${rel}`);
      return proposal.bytes;
    }
    const absolute = await this.confined(rel);
    const bytes = await readFile(absolute);
    this.seen.set(rel, sha256(bytes));
    return bytes;
  }

  async readText(path: string): Promise<string> {
    return (await this.readBytes(path)).toString("utf8");
  }

  /** Intrinsic pixel size of an image; an unmaterialised Git LFS pointer is an error, not an image. */
  async imageSize(path: string): Promise<{ width: number; height: number }> {
    const bytes = await this.readBytes(path);
    if (bytes.subarray(0, 80).toString().startsWith("version https://git-lfs.github.com/spec/"))
      throw new Error(`${path} is a Git LFS pointer; run \`git lfs pull\` before migrating`);
    const { default: sharp } = await import("sharp");
    const { width, height } = await sharp(bytes).metadata();
    if (!width || !height) throw new Error(`${path} has no intrinsic size`);
    return { width, height };
  }

  /** The file as it is on disk, ignoring proposals; for comparing a conversion with its source. */
  async readOriginalText(path: string): Promise<string> {
    const rel = this.path(path);
    const bytes = await readFile(await this.confined(rel));
    this.seen.set(rel, sha256(bytes));
    return bytes.toString("utf8");
  }

  /** Project-relative files below `dir`, sorted, excluding dot entries and dependencies. */
  async list(dir: string, include: (path: string) => boolean = () => true): Promise<string[]> {
    const start = dir === "." || dir === "" ? this.root : this.absolute(dir);
    const files: string[] = [];
    const walk = async (current: string) => {
      const entries = await readdir(current, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const absolute = join(current, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await walk(absolute);
        else if (entry.isFile()) {
          const rel = relative(this.root, absolute).split(sep).join("/");
          if (include(rel)) files.push(rel);
        }
      }
    };
    await walk(start);
    return files;
  }

  write(path: string, bytes: Buffer | string, reason: string): void {
    this.proposed.set(this.path(path), { bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, "utf8"), reason });
  }

  remove(path: string, reason: string): void {
    this.proposed.set(this.path(path), { bytes: null, reason });
  }

  /** Files read by the converter and left as they were. */
  unchanged(): string[] {
    return [...this.seen.keys()].filter((path) => !this.isChanged(path)).sort();
  }

  async changes(): Promise<MigrationChange[]> {
    const result: MigrationChange[] = [];
    for (const [path, proposal] of [...this.proposed].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (!this.seen.has(path)) {
        const stat = await this.stat(path);
        if (stat && !stat.isFile()) throw new Error(`Cannot replace a non-file: ${path}`);
        this.seen.set(path, stat ? sha256(await readFile(await this.confined(path))) : null);
      }
      if (!this.isChanged(path)) continue;
      result.push({ path, expectedSha256: this.seen.get(path) ?? null, bytes: proposal.bytes, reason: proposal.reason });
    }
    return result;
  }

  private isChanged(path: string): boolean {
    const proposal = this.proposed.get(path);
    if (!proposal) return false;
    const before = this.seen.get(path);
    if (proposal.bytes === null) return before !== null && before !== undefined;
    return before !== sha256(proposal.bytes);
  }

  private async stat(rel: string) {
    try {
      const absolute = await this.confined(rel);
      return await lstat(absolute);
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return undefined;
      throw error;
    }
  }

  /** Absolute path whose real location is inside the project, with no symlink on the way. */
  private async confined(rel: string): Promise<string> {
    const realRoot = await realpath(this.root);
    let current = realRoot;
    for (const part of rel.split("/")) {
      current = join(current, part);
      const stat = await lstat(current).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined;
        throw error;
      });
      if (!stat) return join(realRoot, rel);
      if (stat.isSymbolicLink()) throw new Error(`Refusing to follow a symbolic link: ${rel}`);
    }
    return current;
  }
}

interface Journal {
  entries: { path: string; backup: string | null }[];
}

/**
 * Restore an application that was interrupted before it finished. Returns the
 * paths restored, or an empty list when there was nothing to recover.
 */
export async function recoverInterrupted(root: string): Promise<string[]> {
  const directory = join(resolve(root), RECOVERY_DIRECTORY);
  const journal = await readFile(join(directory, "journal.json"), "utf8").then(
    (text) => JSON.parse(text) as Journal,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  if (!journal) {
    await rm(directory, { recursive: true, force: true });
    return [];
  }
  await restore(resolve(root), directory, journal.entries);
  await rm(directory, { recursive: true, force: true });
  return journal.entries.map((entry) => entry.path);
}

export async function hasInterrupted(root: string): Promise<boolean> {
  return lstat(join(resolve(root), RECOVERY_DIRECTORY)).then(
    () => true,
    () => false,
  );
}

/**
 * Apply prepared changes. Each target must still hold the bytes it had when
 * the change was prepared. Files are staged on the project's filesystem and
 * renamed into place; a failure restores every file already replaced.
 */
export async function applyChanges(root: string, changes: readonly MigrationChange[]): Promise<void> {
  const project = new ProjectFiles(root);
  for (const change of changes) {
    project.path(change.path);
    const absolute = join(project.root, change.path);
    const current = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (current?.isSymbolicLink()) throw new Error(`Refusing to replace a symbolic link: ${change.path}`);
    const digest = current ? sha256(await readFile(absolute)) : null;
    if (digest !== change.expectedSha256)
      throw new Error(`${change.path} changed after the migration was prepared. Run the migration again.`);
  }

  const directory = join(project.root, RECOVERY_DIRECTORY);
  await mkdir(join(directory, "backup"), { recursive: true });
  await mkdir(join(directory, "staged"), { recursive: true });
  const entries: Journal["entries"] = [];
  const staged = new Map<string, string>();
  for (const [index, change] of changes.entries()) {
    const absolute = join(project.root, change.path);
    let backup: string | null = null;
    if (change.expectedSha256 !== null) {
      backup = `backup/${index}`;
      await writeFile(join(directory, backup), await readFile(absolute));
    }
    entries.push({ path: change.path, backup });
    if (change.bytes !== null) {
      const file = join(directory, "staged", `${index}-${randomBytes(4).toString("hex")}`);
      await writeFile(file, change.bytes);
      staged.set(change.path, file);
    }
  }
  await writeFile(join(directory, "journal.json"), JSON.stringify({ entries } satisfies Journal));

  try {
    for (const change of changes) {
      const absolute = join(project.root, change.path);
      const file = staged.get(change.path);
      if (file) {
        await mkdir(dirname(absolute), { recursive: true });
        await rename(file, absolute);
      } else {
        await rm(absolute, { force: true });
      }
    }
  } catch (error) {
    await restore(project.root, directory, entries);
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  await rm(directory, { recursive: true, force: true });
}

async function restore(root: string, directory: string, entries: Journal["entries"]): Promise<void> {
  for (const entry of entries) {
    const absolute = join(root, entry.path);
    if (entry.backup === null) {
      await rm(absolute, { force: true });
      continue;
    }
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, await readFile(join(directory, entry.backup)));
  }
}
