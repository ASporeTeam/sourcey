import { readFile as readFileAsync } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { load as parseYaml } from "js-yaml";
import { normalizeChangelog } from "./changelog-normalizer.js";
import { htmlId } from "../utils/html-id.js";
import { smartypants } from "../utils/typography.js";
import {
  decodeEntities,
  renderMarkdownInline,
  extractFirstParagraph,
  firstHeadingText,
  stripMarkdownLinks,
  type PageHeading,
} from "../utils/markdown.js";
import { InputReader } from "./loader.js";
import { hasAgentContent, openingHasComponent, parseComponents, readableContent, renderContent, componentStyles, contentHeadings, contentAnchors, contentDiagnostics, resolveSectionIndexes, type ContentNode, type NativeComponentDefinition } from "./markdown-components.js";
import type { NormalizedChangelog } from "./types.js";
import type { ArtifactBody } from "./source-file.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContentDiagnostic = ReturnType<typeof contentDiagnostics>[number];

export interface MarkdownPage {
  id?: string;
  hideInMenu?: boolean;
  draft?: boolean;
  assets?: Map<string, ArtifactBody>;
  componentStyles?: string[];
  diagnostics?: ContentDiagnostic[];
  kind: "markdown";
  /** Page title from frontmatter */
  title: string;
  /** Page description from frontmatter */
  description: string;
  /**
   * The description repeats a paragraph the body keeps, so the page header
   * shows no lede.
   */
  hideLede?: boolean;
  /** Short navigation label, independent of the article title. */
  navTitle?: string;
  /** URL slug for this page (derived from filename) */
  slug: string;
  /** Rendered HTML body */
  html: string;
  /** Readable content retained by the owning adapter, before presentation rendering; machine exports read it. */
  markdown: string;
  /** The readable content people's surfaces (search) read, when it differs: without agent-only content. */
  readerMarkdown?: string;
  /** Extracted h2/h3 headings for table of contents */
  headings: PageHeading[];
  anchors?: string[];
  /** Original file path (for error messages and dev server watching) */
  sourcePath: string;
  /** Optional repo-relative path used for "Edit this page" links. Null disables the link. */
  editPath?: string | null;
  /** Optional base path override for this page's edit link. Undefined uses the site default. */
  editBasePath?: string | null;
  /** Optional page-local entries that should be indexed in addition to headings. */
  searchEntries?: PageSearchEntry[];
  /** Optional source root used to rewrite source-format-relative assets. */
  sourceRoot?: string;
  /**
   * How the page is drawn, when its frontmatter says: `page` keeps the site's
   * header and footer around a body of its own, `blank` keeps nothing but the
   * body. Unset, documentation is `doc` and a site page is `page`.
   */
  layout?: PageLayout;
  /** The page's own stylesheets (frontmatter `css`), resolved from its folder. */
  css?: string[];
}

/** How a page is drawn: the documentation frame, the site's header and footer alone, or nothing. */
export type PageLayout = "doc" | "page" | "blank";
const LAYOUTS: readonly string[] = ["doc", "page", "blank", "changelog"];

export interface PageSearchEntry {
  title: string;
  content: string;
  anchor?: string;
  category: string;
  symbolKind?: string;
  owner?: string;
  ownerKind?: string;
  namespace?: string;
  qualifiedName?: string;
}

export interface ChangelogPage {
  kind: "changelog";
  title: string;
  description: string;
  slug: string;
  headings: PageHeading[];
  sourcePath: string;
  editPath?: string | null;
  changelog: NormalizedChangelog;
  rawBody: string;
  /** Set on generated per-version pages; undefined for the full changelog page. */
  permalinkVersionId?: string;
}

export type DocsPage = MarkdownPage | ChangelogPage;
/** Parsed and resolved content, before navigation-dependent projections. */
export interface MarkdownSource extends Omit<MarkdownPage, "html" | "markdown" | "headings" | "anchors" | "hideLede" | "componentStyles" | "diagnostics"> {
  messages?: import("./messages.js").UiMessages;
  nodes: readonly ContentNode[];
  explicitDescription: boolean;
  smartypants?: boolean;
}
export type DocsSource = MarkdownSource | ChangelogPage;
export type NavigationDocument = Pick<DocsPage, "kind" | "title" | "slug"> & Partial<Pick<MarkdownPage, "id" | "navTitle" | "hideInMenu">>;


export type { PageHeading } from "../utils/markdown.js";

interface Frontmatter {
  title?: string;
  description?: string;
  order?: number;
  navTitle?: string;
  layout?: string;
  [key: string]: unknown;
}

export interface LoadDocsPageOptions {
  changelog?: boolean;
  repoUrl?: string;
  sourceRoot?: string;
  preprocess?: MarkdownPreprocessor[];
  /** Title for a page that sets none and has no heading of its own. */
  title?: string;
  input?: InputReader;
  configDir?: string;
  /** Source tree at the selected repository revision, when content is a local snapshot. */
  editRoot?: string;
  context?: import("./markdown-components.js").NativeContentContext;
  baseUrl?: string;
  components?: Record<string, NativeComponentDefinition>;
  /** Typographer's quotes, dashes and ellipses in the page's prose. */
  smartypants?: boolean;
}

export interface MarkdownPreprocessContext {
  filePath: string;
  sourceRoot?: string;
}

export type MarkdownPreprocessor = (body: string, context: MarkdownPreprocessContext) => string;

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;

function parseFrontmatter(raw: string): { meta: Frontmatter; body: string } {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return { meta: {}, body: raw };
  }
  const meta = (parseYaml(match[1]) as Frontmatter) ?? {};
  return { meta, body: match[2] };
}


function isFenceStart(line: string): { char: string; length: number } | null {
 const m = line.match(/^ {0,3}(`{3,}|~{3,})/); return m ? { char: m[1][0], length: m[1].length } : null;
}
function closesFence(line: string, fence: { char: string; length: number }): boolean {
 return new RegExp(`^ {0,3}${fence.char}{${fence.length},} *$`).test(line);
}
export function closeMarkdownFence(markdown: string): string {
  let fence: {char: string; length: number} | null = null;
  for (const line of markdown.split("\n")) {
    if (fence) { if (closesFence(line, fence)) fence = null; }
    else fence = isFenceStart(line);
  }
  return fence ? `${markdown.trimEnd()}\n${fence.char.repeat(fence.length)}\n` : markdown;
}

/** Build tabbed UI HTML (shared by :::tabs and :::code-group). */
export async function loadMarkdownPage(filePath: string, slug: string): Promise<MarkdownPage> {
  const raw = await readFileAsync(filePath, "utf-8");
  const { meta, body } = parseFrontmatter(raw);

  return renderDocsSource(await loadMarkdownSourceFromBody(filePath, slug, body, meta)) as MarkdownPage;
}

export async function loadDocsPage(filePath: string, slug: string, options: LoadDocsPageOptions = {}): Promise<DocsPage> {
  return renderDocsSource(await loadDocsSource(filePath, slug, options));
}

export async function loadDocsSource(
  filePath: string,
  slug: string,
  options: LoadDocsPageOptions = {},
): Promise<DocsSource> {
  const raw = options.input ? await options.input.readText(filePath, filePath) : await readFileAsync(filePath, "utf-8");
  const { meta, body } = parseFrontmatter(raw);

  if (shouldTreatAsChangelog(filePath, meta, options)) {
    const sourcePath = relative(options.configDir ?? process.cwd(), filePath);
    const changelog = normalizeChangelog(body, {
      title: typeof meta.title === "string" ? meta.title : undefined,
      description: typeof meta.description === "string" ? meta.description : undefined,
      repoUrl: options.repoUrl,
    });
    const description =
      typeof meta.description === "string" ? meta.description : (changelog.description ?? "");

    return {
      kind: "changelog",
      title: changelog.title,
      description,
      slug,
      headings: changelog.versions.map((version) => ({
        level: 2 as const,
        text: version.version ?? "Unreleased",
        id: version.id,
      })),
      sourcePath,
      editPath: relative(options.editRoot ?? options.configDir ?? process.cwd(), filePath),
      changelog,
      rawBody: body,
    };
  }

  return loadMarkdownSourceFromBody(filePath, slug, body, meta, options);
}

function shouldTreatAsChangelog(
  filePath: string,
  meta: Frontmatter,
  options: LoadDocsPageOptions,
): boolean {
  if (options.changelog === false) return false;
  if (typeof meta.layout === "string" && meta.layout.toLowerCase() === "changelog") return true;
  return basename(filePath).toLowerCase() === "changelog.md";
}

async function loadMarkdownSourceFromBody(
  filePath: string,
  slug: string,
  body: string,
  meta: Frontmatter,
  options: LoadDocsPageOptions = {},
): Promise<MarkdownSource> {
  let sourcePreprocessed = body;
  for (const preprocess of options.preprocess ?? []) sourcePreprocessed = preprocess(sourcePreprocessed, { filePath, sourceRoot: options.sourceRoot });
  const assets = new Map<string, ArtifactBody>();
  const nodes = await parseComponents(sourcePreprocessed, { source: filePath, root: options.configDir ?? options.sourceRoot ?? process.cwd(), input: options.input ?? new InputReader(), components: options.components, assets, baseUrl: options.baseUrl, context: options.context });
  const componentPreprocessed = readableContent(nodes, "people");
  const title = meta.title ?? extractFirstHeading(componentPreprocessed) ?? options.title ?? slug;
  const sourcePath = relative(options.configDir ?? process.cwd(), filePath);
  if (meta.layout !== undefined && (typeof meta.layout !== "string" || !LAYOUTS.includes(meta.layout))) throw new Error(`${sourcePath}: layout ${JSON.stringify(meta.layout)} is not doc, page, blank or changelog`);
  // A changelog layout with changelogs turned off is the page as written.
  const layout = meta.layout === "changelog" ? undefined : meta.layout as PageLayout | undefined;
  const css = meta.css === undefined ? [] : Array.isArray(meta.css) ? meta.css : [meta.css];
  if (css.some(path => typeof path !== "string" || !path || /^[a-z][a-z\d+.-]*:|^\//i.test(path))) throw new Error(`${sourcePath}: css names stylesheets beside the page, such as css: ./home.css`);
  return {
    kind: "markdown", title, description: normalizeMarkdownDescription(meta.description, componentPreprocessed),
    navTitle: typeof meta.navTitle === "string" ? meta.navTitle : undefined,
    slug: typeof meta.slug === "string" ? meta.slug.replace(/^\/+|\/+$/g, "") || "index" : slug,
    id: typeof meta.id === "string" ? meta.id : undefined, draft: meta.draft === true, hideInMenu: meta.hideInMenu === true,
    ...(layout ? { layout } : {}), ...(css.length ? { css: css.map(path => resolve(dirname(filePath), path as string)) } : {}),
    assets, nodes, messages: options.context?.messages, explicitDescription: typeof meta.description === "string" && Boolean(meta.description.trim()), ...(options.smartypants ? { smartypants: true } : {}),
    sourcePath, editPath: relative(options.editRoot ?? options.configDir ?? process.cwd(), filePath), sourceRoot: options.sourceRoot ? relative(options.configDir ?? process.cwd(), options.sourceRoot) : undefined,
  };
}

export function renderDocsSource(source: DocsSource, navigation?: import("./navigation.js").SiteTab, documentId = source.slug): DocsPage {
  if (source.kind === "changelog") return source;
  const { nodes: sourceNodes, explicitDescription, messages, smartypants: smart, ...metadata } = source;
  const nodes = resolveSectionIndexes(sourceNodes, navigation, documentId);
  let markdown: string, html: string;
  // Content that cannot render, such as a code fence's unknown metadata, names its page.
  try { markdown = readableContent(nodes); html = renderContent(nodes, messages); }
  catch (error) { throw new Error(`${source.sourcePath}: ${(error as Error).message}`, { cause: error }); }
  const readerMarkdown = hasAgentContent(nodes) ? readableContent(nodes, "people") : undefined;
  const page = { ...metadata, markdown, ...(readerMarkdown !== undefined ? { readerMarkdown } : {}), headings: contentHeadings(nodes), anchors: contentAnchors(nodes), diagnostics: contentDiagnostics(nodes), componentStyles: componentStyles(nodes) };
  // A page drawn by its author keeps its own heading and opening; the doc frame draws both for it.
  if (source.layout === "page" || source.layout === "blank") return { ...page, html: smart ? smartypants(html) : html };
  let cleanHtml = html.replace(/^\s*<h1([^>]*)>(.*?)<\/h1>\s*/i, (match, attributes: string, inner: string) => {
    // The heading's visible text against the title, so a title with an apostrophe or ampersand still matches.
    if (decodeEntities(visibleText(inner)) !== source.title.replace(/\s+/g, " ").trim()) return match;
    const id = attributes.match(/\bid="([^"]+)"/)?.[1];
    const aliases = inner.match(/<span\b[^>]*\bid="[^"]+"[^>]*><\/span>/g)?.join("") ?? "";
    return `${id ? `<span id="${id}" aria-hidden="true"></span>` : ""}${aliases}`;
  });
  let hideLede = false;
  if (source.description && !explicitDescription) {
    const opening = cleanHtml.match(/^(?:\s*<span\b[^>]*aria-hidden="true"[^>]*><\/span>)*\s*<p>([\s\S]*?)<\/p>\s*/);
    // The lede is plain text: an opening paragraph with links, code or emphasis stays in the body.
    if (opening && !/<[a-z]/i.test(opening[1]) && !openingHasComponent(nodes) && visibleText(opening[1]) === visibleText(renderMarkdownInline(source.description))) cleanHtml = opening[0].replace(/<p>[\s\S]*?<\/p>\s*$/, "") + cleanHtml.slice(opening[0].length);
    else hideLede = true;
  }
  return { ...page, html: smart ? smartypants(cleanHtml) : cleanHtml, ...(hideLede ? { hideLede } : {}) };
}

function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMarkdownDescription(description: unknown, markdown: string): string {
  if (typeof description === "string" && description.trim()) {
    return description;
  }
  return stripMarkdownLinks(extractFirstParagraph(markdown)).replace(/\s+/g, " ").trim();
}

/**
 * The page's first level-one heading, as plain text, for a fallback title. It
 * reads the lexed document, so a `#` comment inside a fenced code block is not
 * a heading.
 */
function extractFirstHeading(md: string): string | undefined {
  return firstHeadingText(md, 1);
}

/**
 * Derive a URL slug from a page path.
 * Preserves directory structure to avoid collisions:
 * "getting-started.md" → "getting-started"
 * "run/index"          → "run/index"
 * "run/install.md"     → "run/install"
 */
export function slugFromPath(filePath: string, rule: "normalized" | "file" = "normalized"): string {
  const stripped = filePath.replace(/\.(md|mdx)$/i, "");
  if (rule === "file") return stripped.replace(/\\/g, "/");
  return stripped
    .split("/")
    .map((s) => slugSegmentFromPath(s))
    .join("/");
}

function slugSegmentFromPath(segment: string): string {
  const normalized = segment
    .replace(/^operator=$/, "operator-assign")
    .replace(/^~(.+)$/, "destructor-$1")
    .replace(/<=>/g, "-spaceship")
    .replace(/<=/g, "-le")
    .replace(/>=/g, "-ge")
    .replace(/==/g, "-eq")
    .replace(/!=/g, "-ne")
    .replace(/\[\]/g, "-array")
    .replace(/\+=/g, "-plus-eq")
    .replace(/\/=/g, "-slash-eq")
    .replace(/\//g, "-slash")
    .replace(/=/g, "-eq")
    .replace(/\+/g, "-plus")
    .replace(/</g, "-lt")
    .replace(/>/g, "-gt");
  return htmlId(normalized);
}
