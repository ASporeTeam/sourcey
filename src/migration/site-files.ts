/**
 * URLs a source framework resolved against its site rather than the file:
 * raw HTML `src`/`href`/`poster` (relative to the page URL) and root paths
 * (`/images/x.png`), which reach files because the framework served its
 * content directory at the site root. Native resolves local files from the
 * document, so each such URL naming a real file becomes a path relative to it.
 */
import { posix } from "node:path";

export interface SitePlace {
  /** Project-relative document. */
  file: string;
  /** Public path the source served the document at. */
  route: string;
  /** Project-relative directory the source served at the site root. */
  root: string;
  exists(path: string): Promise<boolean>;
}

export async function siteFileUrls(text: string, place: SitePlace): Promise<string> {
  const candidates = [
    ...[...text.matchAll(/\b(?:src|href|poster)="([^"#?]+)/g)].map((match) => ({ url: match[1], at: match.index! + match[0].length - match[1].length })),
    ...[...text.matchAll(/\]\((\/[^)\s#?]+)/g)].map((match) => ({ url: match[1], at: match.index! + 2 })),
  ];
  const replacements: { start: number; end: number; text: string }[] = [];
  for (const { url, at } of candidates) {
    if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(url) || /\.mdx?$/.test(url)) continue;
    const sitePath = decodeURI(new URL(url, `https://site.invalid${place.route}`).pathname);
    const file = posix.join(place.root, sitePath.slice(1));
    if (!(await place.exists(file))) continue;
    const relative = posix.relative(posix.dirname(place.file), file);
    replacements.push({ start: at, end: at + url.length, text: relative.startsWith(".") ? relative : `./${relative}` });
  }
  let result = text;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end);
  return result;
}
