/** Reading a built site's engine files and published search the way a browser finds them. */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Engine files are content-addressed under `_assets/<hash>/`, one bundle per site. */
export async function engineAsset(outputDir: string, name: string): Promise<string> {
  const bundles = await readdir(join(outputDir, "_assets"));
  if (bundles.length !== 1) throw new Error(`Expected one engine bundle in ${outputDir}/_assets, found ${bundles.length}`);
  return join(outputDir, "_assets", bundles[0], name);
}

/** The address a page gives an engine file, by its name. */
export function engineHref(html: string, name: string): string | undefined {
  return html.match(new RegExp(`(?:href|src)="([^"]*_assets/[0-9a-f]{20}/${name.replace(/[.]/g, "\\.")})"`))?.[1];
}

/** The search rows a site publishes: each language and version's manifest, read through to its index. */
export async function publishedSearchRows(outputDir: string): Promise<Record<string, unknown>[]> {
  const dir = join(outputDir, "_search");
  const rows: Record<string, unknown>[] = [];
  for (const file of (await readdir(dir)).filter((name) => name.startsWith("context-"))) {
    const { index } = JSON.parse(await readFile(join(dir, file), "utf8")) as { index: string };
    rows.push(...(JSON.parse(await readFile(join(dir, index), "utf8")) as { rows: Record<string, unknown>[] }).rows);
  }
  return rows;
}
