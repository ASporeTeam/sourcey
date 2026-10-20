import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A temporary project with the given files; removed after `fn` settles. */
export async function withProject(files: Record<string, string | Buffer>, fn: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "sourcey-migration-test-"));
  try {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export function read(root: string, path: string): Promise<string> {
  return readFile(join(root, path), "utf8");
}
