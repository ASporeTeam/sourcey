import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

/**
 * Bytes a site publishes unchanged from a file on disk, such as an image or a
 * public asset. A build that writes its output copies them from the file,
 * rather than holding every one in memory until the output is written.
 */
export class SourceFile {
  constructor(
    readonly path: string,
    readonly digest: string,
    readonly size: number,
  ) {}

  /** The file's bytes, as they were when it was hashed. */
  async read(): Promise<Buffer> {
    const body = await readFile(this.path);
    if (createHash("sha256").update(body).digest("hex") !== this.digest) throw new Error(`Source file changed during the build: ${this.path}`);
    return body;
  }
}

/** What an artifact holds: text, bytes, or a file to copy them from. */
export type ArtifactBody = string | Buffer | SourceFile;

/** A file's SHA-256, size and first bytes, read once as a stream. */
export async function hashFile(path: string, signal?: AbortSignal): Promise<{ digest: string; size: number; head: Buffer }> {
  const hash = createHash("sha256");
  let size = 0, head = Buffer.alloc(0);
  for await (const chunk of createReadStream(path, { signal }) as AsyncIterable<Buffer>) {
    hash.update(chunk);
    if (head.length < 80) head = Buffer.concat([head, chunk.subarray(0, 80 - head.length)]);
    size += chunk.length;
  }
  return { digest: hash.digest("hex"), size, head };
}

/** Bytes for a host that serves the site from memory. */
export async function artifactBytes(body: ArtifactBody): Promise<string | Buffer> {
  return body instanceof SourceFile ? body.read() : body;
}
