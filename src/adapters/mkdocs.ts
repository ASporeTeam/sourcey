import { readFileSync } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  CORE_SCHEMA,
  defineMappingTag,
  defineScalarTag,
  defineSequenceTag,
  load as parseYaml,
} from "js-yaml";
import type { ResolvedGroup, ResolvedPage } from "../config.js";
import type { MarkdownPreprocessor } from "../core/markdown-loader.js";
import type { MkDocsSourceOptions, SourceAdapter } from "./types.js";
import { assertLocalPath, collectStaticAssets } from "./shared.js";

interface MkDocsConfigFile {
  docs_dir?: unknown;
  nav?: unknown;
  pages?: unknown;
}

interface MkDocsNavPage {
  path: string;
  /** Sidebar label, joined with its section's labels. */
  label?: string;
  /** The page's own nav label, its title when the page has no heading. */
  title?: string;
}

export function mkdocs(options: MkDocsSourceOptions): SourceAdapter {
  return {
    name: "mkdocs",
    async resolve(ctx) {
      const configPath = assertLocalPath(ctx, options.config, "MkDocs config");
      await ctx.assertExists(
        configPath,
        `MkDocs config "${options.config}" in tab "${ctx.tabName}"`,
      );
      const { docsDir, groups } = await resolveMkDocsGroups(configPath);
      return {
        kind: "markdown",
        adapter: "mkdocs",
        configPath,
        groups,
        assets: await collectStaticAssets(docsDir),
        watchPaths: [configPath, docsDir],
      };
    },
  };
}

async function resolveMkDocsGroups(
  configPath: string,
): Promise<{ docsDir: string; groups: ResolvedGroup[] }> {
  const raw = await readFile(configPath, "utf-8");
  const parsed = parseYaml(raw, { schema: MKDOCS_YAML_SCHEMA }) as MkDocsConfigFile | null;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`MkDocs config must be a YAML object: ${configPath}`);
  }

  const configDir = dirname(configPath);
  const docsDirName =
    typeof parsed.docs_dir === "string" && parsed.docs_dir.trim() ? parsed.docs_dir.trim() : "docs";
  const docsDir = resolve(configDir, docsDirName);

  const nav = parsed.nav ?? parsed.pages;
  const groups = Array.isArray(nav)
    ? mkDocsGroupsFromNav(nav, docsDir)
    : [{ label: "Pages", pages: await discoverMkDocsPages(docsDir) }];

  const nonEmptyGroups = groups.filter((group) => group.pages.length > 0);
  if (nonEmptyGroups.length === 0) {
    throw new Error(`MkDocs config did not resolve any markdown pages: ${configPath}`);
  }

  for (const group of nonEmptyGroups) {
    for (const page of group.pages) {
      await access(page.file).catch(() => {
        throw new Error(
          `MkDocs nav page "${relative(docsDir, page.file).replace(/\\/g, "/")}" not found`,
        );
      });
    }
  }
  return { docsDir, groups: nonEmptyGroups };
}

/**
 * MkDocs configs carry tags only MkDocs can resolve: Python objects
 * (`!!python/name:`, `!!python/object/apply:`) and its own (`!ENV`,
 * `!relative`). Sourcey reads the nav and docs_dir, so each loads as null.
 */
const MKDOCS_YAML_SCHEMA = CORE_SCHEMA.withTags(
  ...["!", "tag:yaml.org,2002:python/"].flatMap((prefix) => [
    defineScalarTag(prefix, { matchByTagPrefix: true, resolve: () => null, identify: () => false }),
    defineSequenceTag(prefix, {
      matchByTagPrefix: true,
      create: () => null,
      addItem: () => undefined,
      finalize: () => null,
      identify: () => false,
    }),
    defineMappingTag(prefix, {
      matchByTagPrefix: true,
      create: () => null,
      addPair: () => "",
      has: () => false,
      keys: () => [],
      get: () => undefined,
      finalize: () => null,
      identify: () => false,
    }),
  ]),
);

function mkDocsGroupsFromNav(nav: unknown[], docsDir: string): ResolvedGroup[] {
  const groups: ResolvedGroup[] = [];
  const loosePages: ResolvedPage[] = [];
  const seenPaths = new Set<string>();

  for (const entry of nav) {
    if (typeof entry === "string") {
      const page = resolveMkDocsNavPage({ path: entry }, docsDir, seenPaths);
      if (page) loosePages.push(page);
      continue;
    }

    if (!isPlainRecord(entry)) continue;

    for (const [label, value] of Object.entries(entry)) {
      if (typeof value === "string") {
        const page = resolveMkDocsNavPage({ path: value, label, title: label }, docsDir, seenPaths);
        if (page) loosePages.push(page);
        continue;
      }

      const pages = collectMkDocsNavPages(value, [])
        .map((page) => resolveMkDocsNavPage(page, docsDir, seenPaths))
        .filter((page): page is ResolvedPage => Boolean(page));
      if (pages.length > 0) {
        groups.push({ label, pages });
      }
    }
  }

  return loosePages.length > 0 ? [{ label: "Pages", pages: loosePages }, ...groups] : groups;
}

function collectMkDocsNavPages(value: unknown, labelParts: string[]): MkDocsNavPage[] {
  if (typeof value === "string") {
    return [
      {
        path: value,
        label: isMkDocsIndexPage(value) ? labelParts.join(" / ") || undefined : undefined,
        title: isMkDocsIndexPage(value) ? labelParts.at(-1) : undefined,
      },
    ];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectMkDocsNavPages(entry, labelParts));
  }

  if (!isPlainRecord(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([label, nested]) => {
    if (typeof nested === "string") {
      return [
        {
          path: nested,
          label: [...labelParts, label].join(" / "),
          title: label,
        },
      ];
    }
    return collectMkDocsNavPages(nested, [...labelParts, label]);
  });
}

function resolveMkDocsNavPage(
  page: MkDocsNavPage,
  docsDir: string,
  seenPaths: Set<string>,
): ResolvedPage | undefined {
  const navPath = normalizeMkDocsPagePath(page.path);
  if (!navPath || seenPaths.has(navPath)) {
    return undefined;
  }
  const file = resolveWithinRoot(docsDir, navPath);
  if (!file) {
    throw new Error(`MkDocs nav page "${page.path}" escapes docs_dir: ${docsDir}`);
  }
  seenPaths.add(navPath);

  return {
    slug: slugFromMkDocsPath(navPath),
    file,
    label: page.label,
    title: page.title,
    sourceRoot: docsDir,
    preprocess: [preprocessMkDocsMarkdown],
  };
}

function normalizeMkDocsPagePath(value: string): string | undefined {
  const text = value.trim();
  if (!text || isExternalNavTarget(text) || !/\.(?:md|mdx)$/i.test(text)) {
    return undefined;
  }
  return text.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isExternalNavTarget(value: string): boolean {
  return /^(?:https?:|mailto:|tel:|#)/i.test(value);
}

function slugFromMkDocsPath(value: string): string {
  return value.replace(/\.(?:md|mdx)$/i, "");
}

function isMkDocsIndexPage(value: string): boolean {
  return /(^|\/)index\.(?:md|mdx)$/i.test(value.trim());
}

async function discoverMkDocsPages(docsDir: string): Promise<ResolvedPage[]> {
  const pages: ResolvedPage[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name.startsWith(".")) continue;
      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile() || !/\.(?:md|mdx)$/i.test(entry.name)) continue;
      const relPath = relative(docsDir, absolutePath).replace(/\\/g, "/");
      pages.push({
        slug: slugFromMkDocsPath(relPath),
        file: absolutePath,
        sourceRoot: docsDir,
        preprocess: [preprocessMkDocsMarkdown],
      });
    }
  }

  await walk(docsDir);
  return pages;
}

export const preprocessMkDocsMarkdown: MarkdownPreprocessor = (body, context) => {
  if (!context.sourceRoot) return body;
  return normalizeMkDocsAdmonitions(
    normalizeMkDocsTabs(
      openMkDocsMarkdownBlocks(
        mapMkDocsProse(
          stripMkDocsInlineLanguageMarkers(
            expandMkDocsSnippets(body, context.filePath, context.sourceRoot),
          ),
          (prose) => stripMkDocsIcons(stripMkDocsAttrLists(escapeMkDocsCppTemplateAngles(prose))),
        ),
      ),
    ),
  );
};

/**
 * Tracks fenced code blocks line by line, at any indent since admonitions and
 * tabs indent theirs. The returned check says whether a line belongs to one.
 */
function fencedLineTracker(): (line: string) => boolean {
  let fence: { char: string; length: number } | null = null;
  return (line) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) {
        fence = null;
      }
      return true;
    }
    if (marker && !(marker[1][0] === "`" && marker[2].includes("`"))) {
      fence = { char: marker[1][0], length: marker[1].length };
      return true;
    }
    return false;
  };
}

/**
 * Applies a text transform to prose only. Fenced blocks and inline code spans
 * pass through as written: `std::vector<int>` in code is code, not markup.
 */
function mapMkDocsProse(body: string, transform: (prose: string) => string): string {
  const out: string[] = [];
  let prose: string[] = [];
  const inFence = fencedLineTracker();

  const flushProse = () => {
    if (prose.length > 0) out.push(mapOutsideCodeSpans(prose.join("\n"), transform));
    prose = [];
  };

  for (const line of body.split("\n")) {
    if (inFence(line)) {
      flushProse();
      out.push(line);
      continue;
    }
    prose.push(line);
  }
  flushProse();
  return out.join("\n");
}

const VOID_HTML_TAGS = new Set(["br", "hr", "img", "input", "source", "wbr"]);

/**
 * MkDocs' `md_in_html` renders Markdown inside an HTML block marked
 * `markdown`, as Material's grids and cards are. CommonMark does the same once
 * blank lines part the content from its tags, so add them and drop the
 * attribute. Tags count only on lines of their own.
 */
function openMkDocsMarkdownBlocks(body: string): string {
  const out: string[] = [];
  const open: Array<{ tag: string; markdown: boolean }> = [];
  const inFence = fencedLineTracker();

  for (const line of body.split("\n")) {
    if (inFence(line)) {
      out.push(line);
      continue;
    }
    const start = line.match(/^(\s*)<([a-z][\w-]*)\b([^>]*)>\s*$/i);
    if (start && !start[3].trim().endsWith("/") && !VOID_HTML_TAGS.has(start[2].toLowerCase())) {
      const [, indent, tag, attrs] = start;
      const plain = attrs.replace(/\s+markdown(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?(?=\s|$)/i, "");
      const markdown = plain !== attrs;
      if (markdown || open.length > 0) open.push({ tag: tag.toLowerCase(), markdown });
      out.push(...(markdown ? [`${indent}<${tag}${plain}>`, ""] : [line]));
      continue;
    }
    const end = line.match(/^\s*<\/([a-z][\w-]*)>\s*$/i);
    if (end && open.at(-1)?.tag === end[1].toLowerCase()) {
      out.push(...(open.pop()!.markdown ? ["", line] : [line]));
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

function mapOutsideCodeSpans(text: string, transform: (prose: string) => string): string {
  // A code span closes on a backtick run of its own length, within a paragraph.
  const span = /(?<!`)(`+)(?!`)(?:(?!\n[ \t]*\n)[\s\S])*?(?<!`)\1(?!`)/g;
  let out = "";
  let last = 0;
  for (const match of text.matchAll(span)) {
    out += transform(text.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + transform(text.slice(last));
}

const MKDOCS_ATTR = /^(?:#[\w-]+|\.[\w-]+|[\w:-]+=(?:"[^"]*"|'[^']*'|[^\s"'}]+)|[\w:-]+)$/;

/**
 * Removes Python-Markdown `attr_list` blocks, `{ #id .class key=value }`,
 * which MkDocs reads as attributes and Sourcey would print as text. A brace
 * counts only when every entry is an attribute and one names an id, a class or
 * a value, or it opens with `{:`, so prose and template braces stay.
 */
function stripMkDocsAttrLists(prose: string): string {
  return prose.replace(/[ \t]*\{(:?)[ \t]*([^{}\n]*?)[ \t]*\}/g, (match, colon: string, content: string) => {
    const entries = content.match(/[^\s=]+=(?:"[^"]*"|'[^']*'|\S+)|\S+/g) ?? [];
    if (entries.length === 0 || !entries.every((entry) => MKDOCS_ATTR.test(entry))) return match;
    if (!colon && !entries.some((entry) => /^[#.]|=/.test(entry))) return match;
    return "";
  });
}

/**
 * Removes Material's icon shortcodes, `:material-clock:` or
 * `:octicons-arrow-right-24:`, whose icon sets Sourcey does not ship.
 */
function stripMkDocsIcons(prose: string): string {
  return prose.replace(/:(?:material|octicons|fontawesome|simple)-[a-z0-9-]+:[ \t]?/g, "");
}

function expandMkDocsSnippets(body: string, filePath: string, sourceRoot: string): string {
  return body
    .split("\n")
    .map((line) => {
      const match = line.match(/^(\s*)--8<--\s+"([^"]+)"\s*$/);
      if (!match) return line;

      const [, indent, includePath] = match;
      const included = readMkDocsSnippet(includePath, filePath, sourceRoot);
      if (included === undefined) return line;
      return included
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((includedLine) => (includedLine ? `${indent}${includedLine}` : includedLine))
        .join("\n");
    })
    .join("\n");
}

function readMkDocsSnippet(
  includePath: string,
  filePath: string,
  sourceRoot: string,
): string | undefined {
  const candidates = uniquePaths([
    isAbsolute(includePath) ? includePath : resolve(sourceRoot, includePath),
    isAbsolute(includePath) ? includePath : resolve(dirname(filePath), includePath),
  ]);
  const safeCandidates = candidates.filter((candidate) => isWithinRoot(sourceRoot, candidate));
  if (safeCandidates.length === 0) {
    throw new Error(`MkDocs snippet "${includePath}" escapes docs_dir: ${sourceRoot}`);
  }

  for (const candidate of safeCandidates) {
    try {
      return readFileSync(candidate, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  return undefined;
}

function stripMkDocsInlineLanguageMarkers(body: string): string {
  return body
    .replace(/`#!([A-Za-z0-9_+.-]+)\s+([^`]+)`/g, "`$2`")
    .replace(/`#!([A-Za-z0-9_+.-]+)\s*`/g, "");
}

function escapeMkDocsCppTemplateAngles(body: string): string {
  return body.replace(/<([A-Za-z_][A-Za-z0-9_:]*)(\\?)>/g, (match, name: string, escaped: string) => {
    if (!escaped && HTML_TAG_NAMES.has(name.toLowerCase())) return match;
    return `&lt;${name}&gt;`;
  });
}

const HTML_TAG_NAMES = new Set([
  "a",
  "abbr",
  "article",
  "aside",
  "b",
  "blockquote",
  "br",
  "button",
  "caption",
  "code",
  "dd",
  "del",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "iframe",
  "img",
  "input",
  "ins",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "s",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);

function normalizeMkDocsTabs(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; ) {
    const tab = lines[i].match(/^(\s*)===\s+"([^"]+)"\s*$/);
    if (!tab) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    const [, indent, title] = tab;
    out.push(`${indent}**${title}**`);
    i += 1;

    while (i < lines.length) {
      if (lines[i].match(new RegExp(`^${escapeRegExp(indent)}===\\s+"[^"]+"\\s*$`))) {
        break;
      }
      if (/^\s*$/.test(lines[i])) {
        out.push(lines[i]);
        i += 1;
        continue;
      }
      if (!lines[i].startsWith(`${indent}    `)) {
        break;
      }
      out.push(indent + lines[i].slice(indent.length + 4));
      i += 1;
    }
  }

  return out.join("\n");
}

function normalizeMkDocsAdmonitions(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; ) {
    const admonition = lines[i].match(/^(\s*)(!!!|\?\?\?)\s+([A-Za-z0-9_-]+)(?:\s+"([^"]+)")?\s*$/);
    if (!admonition) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    const [, indent, , type, title] = admonition;
    out.push(`${indent}> **${formatMkDocsAdmonitionTitle(type, title)}**`);
    i += 1;

    const content: string[] = [];
    while (i < lines.length) {
      if (/^\s*$/.test(lines[i])) {
        content.push("");
        i += 1;
        continue;
      }
      if (!lines[i].startsWith(`${indent}    `)) {
        break;
      }
      content.push(lines[i].slice(indent.length + 4));
      i += 1;
    }

    for (const line of normalizeMkDocsAdmonitions(content.join("\n")).split("\n")) {
      out.push(line ? `${indent}> ${line}` : `${indent}>`);
    }
  }

  return out.join("\n");
}

function formatMkDocsAdmonitionTitle(type: string, title?: string): string {
  if (title?.trim()) return title.trim();
  return type.slice(0, 1).toUpperCase() + type.slice(1).replace(/-/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveWithinRoot(root: string, path: string): string | undefined {
  const candidate = resolve(root, path);
  return isWithinRoot(root, candidate) ? candidate : undefined;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const rootAbs = resolve(root);
  const candidateAbs = resolve(candidate);
  const rel = relative(rootAbs, candidateAbs);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}
