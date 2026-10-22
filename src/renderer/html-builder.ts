import { createHash } from "node:crypto";
import { buildAssets } from "./assets.js";
import { openOutput } from "./writer.js";
import { safeOutputPath, type RouteTable } from "../core/site-model.js";
import { english } from "../core/messages.js";
import { resolve } from "node:path";
import { renderPage } from "./static-renderer.js";
import type { NormalizedSpec } from "../core/types.js";
import type { RenderAssetPaths, RenderOptions, SiteConfig } from "./context.js";
import type { SiteNavigation } from "../core/navigation.js";
import { projectNavigation } from "../core/navigation.js";
import { isAbsoluteHttpUrl, toAbsoluteUrl, toPublicPath } from "../site-url.js";
import { escapeHtml as escapeXml } from "../utils/html.js";
import type { SitePage } from "../core/site-model.js";
import { referenceOperation } from "../core/reference-identity.js";

/** Snapshot-local artifacts: unchanged HTML is shared across immutable compilations. */
export type PageRenderCache = Map<string, { key: string; html: Buffer }>;
const referenceIds = new WeakMap<NormalizedSpec, number>();
const referenceMetadata = new WeakMap<NormalizedSpec, string>();
const sharedDigests = new WeakMap<object, string>();
function sharedDigest(value: object | undefined): string | undefined {
  if (!value) return undefined;
  let digest = sharedDigests.get(value);
  if (!digest) { digest = createHash("sha256").update(JSON.stringify(value)).digest("hex"); sharedDigests.set(value, digest); }
  return digest;
}
let referenceSequence = 0;
function renderCached(page: SitePage, options: RenderOptions, navigation: SiteNavigation, site: SiteConfig, siteDigest: string, cache: PageRenderCache | undefined, outputPath = page.outputPath): Buffer {
  const current = page.currentPage;
  // Keep finished UTF-8 bytes, not Preact's tree of concatenated JS strings.
  // The same bytes feed the writer, HTTP hosts and unchanged-page cache.
  const render = () => Buffer.from(renderPage(current.kind === "spec" ? current.spec : undefined, options, navigation, current, site));
  if (!cache) return render();
  let content: unknown;
  if (current.kind === "spec") {
    const { spec, view } = current;
    let reference: number | string | undefined, document: string | undefined;
    if (view?.kind === "operation" || view?.kind === "schema") {
      reference = referenceMetadata.get(spec);
      if (!reference) {
        reference = sharedDigest({ info: spec.info, servers: spec.servers, securitySchemes: spec.securitySchemes, sourceUrl: spec.sourceUrl })!;
        referenceMetadata.set(spec, reference);
      }
      document = sharedDigest(view.kind === "operation" ? referenceOperation(spec, view.id) : spec.schemas[view.name]);
    } else {
      reference = referenceIds.get(spec);
      if (reference === undefined) { reference = ++referenceSequence; referenceIds.set(spec, reference); }
    }
    content = { kind: "spec", reference, document, view, tryIt: current.tryIt, specKey: current.specKey };
  } else if (current.kind === "markdown") {
    const document = { ...current.markdown };
    delete document.assets;
    content = { kind: "markdown", document };
  } else content = current;
  // Reference destinations and locale messages are immutable shared inputs.
  // Hash their full value once, rather than serialize all routes per page.
  const optionKey = { ...options, referenceTargets: sharedDigest(options.referenceTargets), messages: sharedDigest(options.messages) };
  const key = createHash("sha256").update(siteDigest).update(JSON.stringify([content, optionKey, navigation])).digest("hex");
  const cached = cache.get(outputPath);
  if (cached?.key === key) return cached.html;
  const html = render();
  cache.set(outputPath, { key, html });
  return html;
}

export interface BuildOutput {
  htmlPath: string;
  outputDir: string;
}

export function createRenderOptions(
  page: SitePage,
  site: SiteConfig,
  options?: {
    embeddable?: boolean;
    assets?: RenderAssetPaths;
  },
): RenderOptions {
  // A page names its assets from the site's base, so it renders whole at any
  // address it answers at: with or without a trailing slash, or as a copy at
  // another address.
  const assetBase = site.baseUrl || "/";
  const pagePublicPath = page.publicPath ?? toPublicPath(page.outputPath, site.baseUrl, site.prettyUrls);

  return {
    anchorAliases: page.anchorAliases,
    embeddable: options?.embeddable ?? false,
    locale: page.context?.localeConfig.lang ?? page.context?.locale,
    referenceTargets: page.referenceTargets,
    sourceRevision: page.context?.version.revision,
    componentStyles: [...(page.currentPage.kind === "markdown" ? page.currentPage.markdown.componentStyles ?? [] : []), ...page.stylesheets ?? []],
    contentLocale: page.contentLocale,
    equivalents: page.equivalents?.map(link => ({ ...link, href: site.siteUrl ? toAbsoluteUrl(link.href, site.siteUrl) : link.href })),
    searchIndexes: page.searchIndexes?.map(path => `${assetBase}${path}`),
    dir: page.context?.localeConfig.dir,
    messages: page.context?.localeConfig.messages ?? english,
    noindex: page.status === 404 || page.context?.version.index === false || page.contentLocale !== page.context?.locale,
    notice: page.contentLocale !== page.context?.locale ? (page.context?.localeConfig.messages?.fallback ?? english.fallback) : page.context?.version.notice || undefined,
    assetBase,
    assets: options?.assets && {
      ...options.assets,
      styles: options.assets.styles.map(path => assetBase + path),
      languageIcons: assetBase + options.assets.languageIcons,
      client: assetBase + options.assets.client,
      theme: assetBase + options.assets.theme,
      search: assetBase + options.assets.search,
      tryIt: options.assets.tryIt && assetBase + options.assets.tryIt,
    },
    pageUrl: site.siteUrl ? toAbsoluteUrl(page.canonical ?? pagePublicPath, site.siteUrl) : page.canonical ?? pagePublicPath,
    ogImageUrl: page.ogImagePath ? resolveRenderHref(page.ogImagePath, assetBase, site) : undefined,
    alternateLinks: page.alternateLinks?.map((link) => ({
      ...link,
      href: resolveRenderHref(link.href, assetBase, site),
    })),
  };
}

export interface SiteArtifactOptions {
  routes?: RouteTable;
  /** Rendered pages kept across compilations; only a rebuilding host keeps one. */
  cache?: PageRenderCache;
  embeddable?: boolean;
  landingPage?: boolean;
  ogImages?: Map<string, Buffer>;
  /** Social cards still to draw, each just before the page that names it is rendered. */
  cards?: ReadonlyMap<SitePage, () => Promise<Buffer | undefined>>;
  extraFiles?: Map<string, string | Buffer>;
}

/** Cards drawn ahead of the page being rendered, so a page waits for none. */
const CARDS_AHEAD = 32;

/** Low-level renderer; SourceySite owns compilation and its artifact inventory. */
export async function buildSite(
  pages: SitePage[], navigation: SiteNavigation, outputDir: string, site: SiteConfig,
  options?: SiteArtifactOptions,
): Promise<BuildOutput> {
  await writeSiteArtifacts(outputDir, siteArtifacts(pages, navigation, site, options));
  return { htmlPath: resolve(outputDir, "index.html"), outputDir: resolve(outputDir) };
}

/** Every artifact in memory at once, for a host that serves them. */
export async function renderSiteArtifacts(
  pages: SitePage[], navigation: SiteNavigation, site: SiteConfig,
  options?: SiteArtifactOptions,
): Promise<Map<string, string | Buffer>> {
  const files = new Map<string, string | Buffer>();
  for await (const [path, body] of siteArtifacts(pages, navigation, site, options)) files.set(path, body);
  return files;
}

/**
 * Write artifacts as they are produced: each is staged to disk and dropped,
 * with a few writes in flight while the next page renders.
 */
export async function writeSiteArtifacts(outputDir: string, artifacts: AsyncIterable<[string, string | Buffer]>): Promise<void> {
  const output = await openOutput(outputDir);
  const writing = new Set<Promise<void>>();
  try {
    for await (const [path, body] of artifacts) {
      const write: Promise<void> = output.put(path, body).finally(() => writing.delete(write));
      write.catch(() => {});
      writing.add(write);
      if (writing.size >= 16) await Promise.race(writing);
    }
    await Promise.all(writing);
    await output.commit();
  } catch (error) {
    await Promise.allSettled(writing);
    await output.abort();
    throw error;
  }
}

/**
 * A site's artifacts, one at a time: each page is rendered only when it is
 * reached, and its card drawn just ahead of it, so no host need hold every
 * page of a site at once.
 */
export async function* siteArtifacts(
  pages: SitePage[], navigation: SiteNavigation, site: SiteConfig,
  options?: SiteArtifactOptions,
): AsyncGenerator<[string, string | Buffer]> {
  const cache = options?.cache;
  const assets = await buildAssets(site.theme.name, pages.some(page =>
    page.currentPage.kind === "spec" && page.currentPage.tryIt !== false && page.currentPage.spec.operations.some(op => !op.hidden && !op.mcpExtras)));
  const siteDigest = createHash("sha256").update(JSON.stringify(site)).digest("hex");
  const folded = new Set<string>();
  const written = new Set<string>();
  const claim = <T extends string | Buffer>(path: string, body: T): [string, T] => {
    safeOutputPath(path);
    const key = path.normalize("NFC").toLowerCase();
    if (folded.has(key)) throw new Error(`Output collision: ${path}`);
    folded.add(key); written.add(path);
    return [path, body];
  };
  const drawing = new Map<SitePage, Promise<Buffer | undefined>>();
  let ahead = 0;
  for (const page of pages) {
    for (; ahead < pages.length && drawing.size < CARDS_AHEAD; ahead++) {
      const draw = options?.cards?.get(pages[ahead]);
      if (draw) drawing.set(pages[ahead], draw());
    }
    const card = drawing.get(page);
    if (card) {
      drawing.delete(page);
      const png = await card;
      // A card that could not be drawn leaves its page without one.
      if (png) yield claim(page.ogImagePath!, png);
      else page.ogImagePath = undefined;
    }
    const optionsForPage = createRenderOptions(page, site, { embeddable: options?.embeddable, assets: assets.paths });
    const activeNav = projectNavigation(page.navigation ?? navigation, page.tabSlug, page.pageSlug);
    yield claim(page.outputPath, renderCached(page, optionsForPage, activeNav, site, siteDigest, cache));
  }
  for (const alias of options?.landingPage === false ? [] : options?.routes?.aliases ?? []) {
    const page = alias.page;
    yield claim(alias.outputPath, renderCached(page, createRenderOptions(page, site, { embeddable: options?.embeddable, assets: assets.paths }),
      projectNavigation(page.navigation ?? navigation, page.tabSlug, page.pageSlug), site, siteDigest, cache, alias.outputPath));
  }
  const redirects = [...options?.routes?.redirects.values() ?? []].filter(route => route.outputPath);
  for (const route of redirects) {
    const target = escapeXml(route.to);
    const literal = JSON.stringify(route.to).replace(/</g, "\\u003c");
    yield claim(route.outputPath!, `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${target}"><link rel="canonical" href="${escapeXml(toAbsoluteUrl(route.to, site.siteUrl))}"><title>Page moved</title></head><body><p>This page has moved. <a href="${target}">Continue to the page</a>.</p><script>const target=${literal},url=new URL(target,location.href);if(!target.includes('?'))url.search=location.search;if(!target.includes('#'))url.hash=location.hash;location.replace(url.href)</script></body></html>`);
  }
  if (redirects.length) yield claim("_redirects", redirects.map(route => `${route.publicPath} ${route.to} ${route.status}`).join("\n") + "\n");
  for (const [path, body] of assets.files) yield claim(path, body);
  const urls = pages.filter(p => options?.routes ? options.routes.byOutputPath.get(p.outputPath)?.index : p.status !== 404 && p.context.version.index !== false && p.contentLocale === p.context.locale).map(page => {
    const publicPath = page.publicPath ?? toPublicPath(page.outputPath, site.baseUrl, site.prettyUrls);
    return `  <url><loc>${escapeXml(site.siteUrl ? toAbsoluteUrl(publicPath, site.siteUrl) : publicPath)}</loc></url>`;
  });
  yield claim("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`);
  for (const [path, body] of options?.ogImages ?? []) yield claim(path, body);
  for (const [path, body] of options?.extraFiles ?? []) yield claim(path, body);
  if (cache) for (const path of cache.keys()) if (!written.has(path)) cache.delete(path);
}

function resolveRenderHref(pathOrUrl: string, assetBase: string, site: SiteConfig): string {
  if (
    !pathOrUrl ||
    pathOrUrl.startsWith("/") ||
    pathOrUrl.startsWith("#") ||
    pathOrUrl.startsWith("mailto:") ||
    pathOrUrl.startsWith("data:") ||
    isAbsoluteHttpUrl(pathOrUrl)
  ) {
    return pathOrUrl;
  }

  if (site.siteUrl) {
    return toAbsoluteUrl(toPublicPath(pathOrUrl, site.baseUrl), site.siteUrl);
  }

  if (site.baseUrl) {
    return toPublicPath(pathOrUrl, site.baseUrl);
  }

  return `${assetBase}${pathOrUrl}`;
}
