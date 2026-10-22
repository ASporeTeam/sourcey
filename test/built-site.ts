/** Reading a built site's engine files and published search the way a browser finds them. */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { SearchEntryFile, SearchResult } from "../src/core/search-artifacts.js";
import { expandFragment, loadSearchIndex } from "../src/client/search-index.js";

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

/** The search results a site publishes: each language and version's entry, read through every fragment it names. */
export async function publishedSearchRows(outputDir: string): Promise<SearchResult[]> {
  const dir = join(outputDir, "_search");
  const rows: SearchResult[] = [];
  for (const file of (await readdir(dir)).filter((name) => name.startsWith("context-"))) {
    const entry = JSON.parse(await readFile(join(dir, file), "utf8")) as SearchEntryFile;
    const fragments = (await readdir(join(dir, entry.files))).filter((name) => /^f\d+\.json$/.test(name))
      .sort((a, b) => Number(a.slice(1, -5)) - Number(b.slice(1, -5)));
    for (const name of fragments) rows.push(...expandFragment(entry, JSON.parse(await readFile(join(dir, entry.files, name), "utf8"))));
  }
  return rows;
}

/** A site's published search, as the browser reads it from disk. */
export async function publishedSearch(outputDir: string) {
  const dir = join(outputDir, "_search");
  const [context] = (await readdir(dir)).filter((name) => name.startsWith("context-"));
  return loadSearchIndex(pathToFileURL(join(dir, context)).href, (async (url: string | URL) =>
    new Response(await readFile(new URL(String(url))))) as typeof fetch);
}
