export const STATIC_ASSET_EXTENSIONS = new Set([
  ".apng",
  ".avif",
  ".bmp",
  ".css",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".mjs",
  ".mp4",
  ".pdf",
  ".png",
  ".svg",
  ".txt",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
]);

import { createHash } from "node:crypto";
import { readdir, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative } from "node:path";
import type { InputReader } from "./loader.js";
import { heavyBuildJob } from "./build-jobs.js";
import { cachedArtifacts } from "./artifact-cache.js";

/** One content-addressed file shared by site chrome and authored media. */
export async function staticMediaAsset(source: string, input: InputReader, owner: string): Promise<{ path: string; body: Buffer }> {
  const file = await input.read(source, owner);
  if (file.body.subarray(0, 80).toString().startsWith("version https://git-lfs.github.com/spec/"))
    throw new Error(`Git LFS asset is not materialized: ${source}`);
  return { path: `_media/${file.digest.slice(0, 20)}${extname(source)}`, body: file.body };
}

/** An explicit public root is a normal input closure, watched and owned once. */
export async function publicAssets(
  directory: string,
  input: InputReader,
): Promise<Map<string, Buffer>> {
  const root = await realpath(directory);
  const files = new Map<string, Buffer>();
  async function walk(path: string, ancestors: ReadonlySet<string>): Promise<void> {
    input.signal?.throwIfAborted();
    const canonical = await realpath(path);
    const confined = relative(root, canonical);
    if (confined === ".." || confined.startsWith("../") || isAbsolute(confined))
      throw new Error(`Public asset resolves outside its directory: ${path}`);
    const info = await stat(canonical);
    if (info.isDirectory()) {
      if (ancestors.has(canonical)) throw new Error(`Public asset directory cycle: ${path}`);
      const branch = new Set([...ancestors, canonical]);
      for (const name of (await readdir(path)).sort()) await walk(join(path, name), branch);
    } else if (info.isFile()) {
      files.set(
        relative(directory, path).replace(/\\/g, "/"),
        (await input.read(path, directory)).body,
      );
    } else throw new Error(`Public asset is not a regular file: ${path}`);
  }
  await walk(directory, new Set());
  return files;
}
export interface FigureOptions {
  width?: number;
  densities?: number[];
  formats?: ("avif" | "webp" | "png")[];
  quality?: number;
}
export interface ImageVariant {
  format: string;
  src: string;
  width: number;
  height: number;
  density: number;
  body: Buffer;
}
/** A lazy build-only transform; the browser receives ordinary responsive images. */
export async function imageVariants(
  path: string,
  options: FigureOptions,
  input: InputReader,
  owner: string,
): Promise<ImageVariant[]> {
  const source = await input.read(path, owner);
  if (source.body.subarray(0, 80).toString().startsWith("version https://git-lfs.github.com/spec/"))
    throw new Error(`Git LFS image is not materialized: ${path}`);
  const files = await cachedArtifacts(
    "image-variants",
    JSON.stringify([source.digest, options]),
    ["sharp"],
    () =>
      heavyBuildJob(async () => {
        input.signal?.throwIfAborted();
        const { default: sharp } = await import("sharp");
        const metadata = await sharp(source.body).metadata();
        if (!metadata.width || !metadata.height)
          throw new Error(`Image has no intrinsic dimensions: ${path}`);
        const width = Math.min(options.width ?? metadata.width, metadata.width);
        const result: ImageVariant[] = [];
        for (const density of options.densities ?? [1, 2]) {
          const pixels = Math.min(Math.round(width * density), metadata.width);
          if (result.some((v) => v.width === pixels)) continue;
          for (const format of options.formats ?? ["avif", "webp", "png"]) {
            input.signal?.throwIfAborted();
            const { data, info } = await sharp(source.body)
              .rotate()
              .resize({ width: pixels, withoutEnlargement: true })
              // Without a quality, each encoder's own default (AVIF 50, WebP 80, lossless PNG).
              .toFormat(format, options.quality === undefined ? {} : { quality: options.quality })
              .toBuffer({ resolveWithObject: true });
            const digest = createHash("sha256").update(data).digest("hex").slice(0, 20);
            result.push({
              format,
              src: `_media/${digest}.${format}`,
              width: info.width,
              height: info.height,
              density,
              body: data,
            });
          }
        }
        return new Map<string, Buffer>([
          [
            "metadata.json",
            Buffer.from(
              JSON.stringify(
                result.map(({ format, src, width, height, density }) => ({
                  format,
                  src,
                  width,
                  height,
                  density,
                })),
              ),
            ),
          ],
          ...result.map((variant): [string, Buffer] => [variant.src, variant.body]),
        ]);
      }),
  );
  return (JSON.parse(files.get("metadata.json")!.toString()) as Omit<ImageVariant, "body">[]).map(
    (variant) => ({ ...variant, body: files.get(variant.src)! }),
  );
}
