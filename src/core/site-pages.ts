import { glob } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { SourceLocaleContext } from "../adapters/types.js";
import { slugFromPath } from "./markdown-loader.js";

/** A site page's source and the address its path names. */
export interface SitePageFile {
  file: string;
  slug: string;
  contentLocale: string;
}

/**
 * One language's site pages: the Markdown under its content folder, each at
 * the address its path names (`about/index.md` is `about`). With fallback on,
 * the default language's page stands in for one the language lacks. Names
 * starting with `_` or `.` are partials, not pages, and another language's
 * content folder (`exclude`) holds that language's pages.
 */
export async function sitePageFiles(root: string, locale: SourceLocaleContext, exclude: readonly string[]): Promise<SitePageFile[]> {
  const local = resolve(root, locale.content);
  const fallback = resolve(root, locale.defaultContent);
  const own = await pagesIn(local, exclude);
  const files = [...own].map(([slug, file]) => ({ file, slug, contentLocale: locale.locale }));
  if (locale.fallback && local !== fallback)
    for (const [slug, file] of await pagesIn(fallback, exclude)) if (!own.has(slug)) files.push({ file, slug, contentLocale: locale.defaultLocale });
  return files;
}

async function pagesIn(folder: string, exclude: readonly string[]): Promise<Map<string, string>> {
  const pages = new Map<string, string>();
  for await (const entry of glob(["**/*.md", "**/*.mdx"], { cwd: folder })) {
    const path = entry.replace(/\\/g, "/");
    const file = resolve(folder, path);
    if (path.split("/").some(part => part.startsWith("_") || part.startsWith(".")) || exclude.some(other => other !== folder && file.startsWith(other + sep))) continue;
    const slug = slugFromPath(path).replace(/(^|\/)index$/, "") || "index";
    const earlier = pages.get(slug);
    if (earlier) throw new Error(`Site pages ${earlier} and ${file} have the same address`);
    pages.set(slug, file);
  }
  return new Map([...pages].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
