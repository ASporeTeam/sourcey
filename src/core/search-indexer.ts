import type { NormalizedSpec } from "./types.js";
import type { DocsPage } from "./markdown-loader.js";
import { readingOrder, type SiteNavigation } from "./navigation.js";
import type { PrettyUrls } from "../site-url.js";
import { toPublicPath } from "../site-url.js";
import { tabIndexOutputPath } from "../config.js";
import { operationAnchor, definitionAnchor } from "./reference-identity.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchEntry {
  /** Display title */
  title: string;
  searchText?: string;
  /** Plain text excerpt for display in results */
  content: string;
  /** Relative URL to the page (+ optional anchor) */
  url: string;
  /** HTTP method for API operations */
  method?: string;
  /** API path for operations */
  path?: string;
  /** Tab this entry belongs to */
  tab: string;
  /** Category for grouping results */
  category: string;
  /** Its place among the rows search opens on, before anything is typed. */
  start?: number;
  /** Source adapter symbol kind, e.g. C++ function, enumvalue, typedef */
  symbolKind?: string;
  /** Owning symbol, e.g. icy::Application */
  owner?: string;
  /** Owning symbol kind, e.g. class, struct, enum */
  ownerKind?: string;
  /** Namespace for source languages that expose one */
  namespace?: string;
  /** Fully qualified symbol name */
  qualifiedName?: string;
}

/** A document and the URL assigned by the compiled route inventory. */
export interface SearchDocument {
  page: DocsPage;
  url: string;
}

// ---------------------------------------------------------------------------
// Index builder
// ---------------------------------------------------------------------------

/**
 * Build a search index from specs and markdown pages.
 * Keep semantic rows typed until the output boundary serializes them.
 */
export function buildSearchIndex(
  specs: Map<string, NormalizedSpec>,
  pages: Map<string, SearchDocument[]>,
  navigation: SiteNavigation,
  assetBase = "/",
  featuredSlugs: string[] = [],
  prettyUrls: PrettyUrls = false,
  targets?: Map<string, import("./site-model.js").ReferenceTargets>,
): SearchEntry[] {
  const base = assetBase.endsWith("/") ? assetBase : assetBase + "/";
  const featuredSet = new Set(featuredSlugs);
  const entries: SearchEntry[] = [];
  const owners = new Map<SearchEntry, string>();
  const featured: SearchEntry[] = [];
  function add(tabSlug: string, entry: SearchEntry): void {
    entries.push(entry);
    owners.set(entry, tabSlug);
  }

  // Index OpenAPI specs
  for (const [tabSlug, spec] of specs) {
    const tab = navigation.tabs.find((t) => t.slug === tabSlug);
    const tabLabel = tab?.label ?? tabSlug;
    const tabBase = toPublicPath(tabIndexOutputPath(tabSlug, prettyUrls), base, prettyUrls);

    // The reference's own page, titled as it is: an MCP server's by its tab.
    const mcp = spec.operations.some((op) => op.mcpExtras?.connection);
    add(tabSlug, {
      title: mcp ? tabLabel : spec.info.title,
      content: (spec.info.summary ?? spec.info.description ?? "").slice(0, 200),
      searchText: [spec.info.title, spec.info.summary, spec.info.description].filter(Boolean).join(" "),
      url: targets?.get(tabSlug)?.overview.href ?? tabBase,
      tab: tabLabel,
      category: "Pages",
    });

    // Operations
    for (const op of spec.operations) {
      if (op.hidden) continue;
      add(tabSlug, {
        title: op.summary ?? `${op.method.toUpperCase()} ${op.path}`,
        content: op.description?.slice(0, 200) ?? "",
        searchText: referenceSearchText(op),
        url: targets?.get(tabSlug)?.operations[`${op.method.toUpperCase()} ${op.path}`]?.href ?? `${tabBase}#${operationAnchor(op, spec)}`,
        method: op.method,
        path: op.path,
        tab: tabLabel,
        category: op.mcpExtras
          ? ({ tool: "Tools", resource: "Resources", prompt: "Prompts" } as const)[op.mcpExtras.type]
          : "Endpoints",
      });
    }

    // Schemas
    for (const name of Object.keys(spec.schemas)) {
      add(tabSlug, {
        title: name,
        content: spec.schemas[name].description?.slice(0, 200) ?? "",
        searchText: referenceSearchText(spec.schemas[name]),
        url: targets?.get(tabSlug)?.schemas[name]?.href ?? `${tabBase}#${definitionAnchor(name, spec)}`,
        tab: tabLabel,
        category: "Models",
      });
    }
  }

  // Index markdown pages; a site page belongs to no tab.
  for (const [tabSlug, tabPages] of pages) {
    const tab = navigation.tabs.find((t) => t.slug === tabSlug);
    const tabLabel = tab?.label ?? "";

    for (const { page, url: href } of tabPages) {
      const entry: SearchEntry = {
        title: page.title,
        searchText: page.kind === "markdown" ? page.readerMarkdown ?? page.markdown : summarizeChangelog(page),
        content: page.kind === "markdown"
          ? page.description || stripHtml(page.html).slice(0, 200)
          : page.description || summarizeChangelog(page).slice(0, 200),
        url: href,
        tab: tabLabel,
        category: "Pages",
      };
      add(tabSlug, entry);
      if (featuredSet.has(page.slug)) featured.push(entry);

      if (page.kind === "markdown") {
        for (const heading of page.headings) {
          add(tabSlug, {
            title: heading.text,
            content: `${page.title} - ${heading.text}`,
            url: `${href}#${heading.id}`,
            tab: tabLabel,
            category: "Sections",
          });
        }
        for (const entry of page.searchEntries ?? []) {
          add(tabSlug, {
            title: entry.title,
            content: entry.content.slice(0, 500),
            url: entry.anchor ? `${href}#${entry.anchor}` : href,
            tab: tabLabel,
            category: entry.category,
            ...(entry.symbolKind && { symbolKind: entry.symbolKind }),
            ...(entry.owner && { owner: entry.owner }),
            ...(entry.ownerKind && { ownerKind: entry.ownerKind }),
            ...(entry.namespace && { namespace: entry.namespace }),
            ...(entry.qualifiedName && { qualifiedName: entry.qualifiedName }),
          });
        }
      } else {
        for (const version of page.changelog.versions) {
          add(tabSlug, {
            title: version.version ?? "Unreleased",
            content: summarizeVersion(version).slice(0, 200),
            url: `${href}#${version.id}`,
            tab: tabLabel,
            category: "Releases",
          });
        }
      }
    }
  }

  markOpenings(entries, owners, featured, navigation);
  return entries;
}

/** The rows each section of the site opens search with, after its featured pages. */
const OPENINGS_PER_TAB = 5;

/**
 * Number the rows search opens on, before anything is typed: featured pages,
 * then for each tab, in turn across its sections, the first page or operation
 * of each, so a reader sees where every part of the site starts. A reference
 * starts at its overview; models are left to search.
 */
function markOpenings(entries: SearchEntry[], owners: Map<SearchEntry, string>, featured: SearchEntry[], navigation: SiteNavigation): void {
  const byUrl = new Map<string, SearchEntry>();
  for (const entry of entries) if (!byUrl.has(entry.url)) byUrl.set(entry.url, entry);
  let rank = 0;
  const mark = (entry: SearchEntry) => { entry.start ??= rank++; };
  // A site page belongs to no tab, so a featured one leads.
  for (const entry of featured) if (!navigation.tabs.some((tab) => tab.slug === owners.get(entry))) mark(entry);
  for (const tab of navigation.tabs) {
    for (const entry of featured) if (owners.get(entry) === tab.slug) mark(entry);
    // A row that would only repeat the tab's name, under that name, is left to search.
    const opening = (href: string) => {
      const entry = byUrl.get(href);
      return entry && owners.get(entry) === tab.slug && entry.category !== "Models" && entry.title !== tab.label ? [entry] : [];
    };
    const sections = tab.groups.map((group) => [...readingOrder([group])].flatMap(opening));
    // The page the tab leads to comes first, when no section lists it.
    const [landing] = opening(tab.href);
    if (landing && !sections.some((section) => section.includes(landing))) sections.unshift([landing]);
    let opened = 0;
    for (let found = true; found && opened < OPENINGS_PER_TAB;) {
      found = false;
      for (const section of sections) {
        if (opened === OPENINGS_PER_TAB) break;
        const entry = section.find((candidate) => candidate.start === undefined);
        if (!entry) continue;
        mark(entry);
        opened++;
        found = true;
      }
    }
  }
}

/**
 * Strip HTML tags from a string to get plain text.
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function summarizeChangelog(page: Extract<DocsPage, { kind: "changelog" }>): string {
  return page.changelog.versions
    .slice(0, 3)
    .map(summarizeVersion)
    .join(" ");
}

function summarizeVersion(
  version: Extract<DocsPage, { kind: "changelog" }>["changelog"]["versions"][number],
): string {
  if (version.summary) return version.summary;

  const entries = version.sections.flatMap((section) => section.entries.map((entry) => entry.text));
  return entries.slice(0, 3).join(" ");
}

const referenceText = new WeakMap<object, string>();
/** One full-text projection per immutable normalized operation/schema. */
export function referenceSearchText(value: unknown): string {
  if (value && typeof value === "object") {
    const cached = referenceText.get(value);
    if (cached !== undefined) return cached;
  }
  const seen = new WeakSet<object>();
  function text(node: unknown): string {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (!node || typeof node !== "object" || seen.has(node)) return "";
    seen.add(node);
    return Object.entries(node).map(([key, child]) => key + " " + text(child)).join(" ");
  }
  const result = text(value);
  if (value && typeof value === "object") referenceText.set(value, result);
  return result;
}
