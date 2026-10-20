import { access, glob } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { GroupConfig, ResolvedGroup, ResolvedPage } from "../config.js";
import type {
  PageMarkdownOptions,
  SourceAdapterContext,
  SourceLocaleContext,
} from "./types.js";


export async function resolveMarkdownGroups(
  groups: GroupConfig[],
  tabName: string,
  sourceRoot: string,
  markdown?: PageMarkdownOptions,
  locale?: SourceLocaleContext,
): Promise<ResolvedGroup[]> {
  const localRoot = resolve(sourceRoot, locale?.content ?? "");
  const fallbackRoot = resolve(sourceRoot, locale?.defaultContent ?? "");
  async function page(slug: string, label?: string, hidden?: boolean): Promise<ResolvedPage> {
    let file: string;
    let contentLocale = locale?.locale;
    try {
      file = await resolvePagePath(slug, localRoot);
    } catch (error) {
      if (!locale?.fallback || localRoot === fallbackRoot) throw error;
      file = await resolvePagePath(slug, fallbackRoot);
      contentLocale = locale.defaultLocale;
    }
    return {
      kind: "page",
      slug,
      file,
      label,
      hidden,
      sourceRoot: contentLocale === locale?.defaultLocale ? fallbackRoot : localRoot,
      ...markdown,
      contentLocale,
    };
  }
  async function group(input: GroupConfig, parent: string): Promise<ResolvedGroup> {
    const id = input.id ?? [parent, input.group].filter(Boolean).join("/");
    const items: ResolvedGroup["items"] = [];
    for (const item of input.pages) {
      if (typeof item === "object" && "group" in item) {
        items.push(await group(item, id));
        continue;
      }
      if (typeof item === "object" && "href" in item) {
        items.push({ kind: "link", ...item });
        continue;
      }
      if (typeof item === "object" && ("operation" in item || "tab" in item)) {
        items.push({ kind: "target", target: item });
        continue;
      }
      const slug = typeof item === "string" ? item : item.page;
      const label = typeof item === "string" ? undefined : item.label;
      if (slug.includes("*")) {
        const patterns = /\.(md|mdx)$/.test(slug) ? [slug] : [`${slug}.md`, `${slug}.mdx`];
        const matches = new Set<string>();
        for (const root of new Set([localRoot, ...(locale?.fallback ? [fallbackRoot] : [])])) {
          for await (const file of glob(patterns, { cwd: root }))
            matches.add(file.replace(/\.(md|mdx)$/i, "").replace(/\\/g, "/"));
        }
        if (!matches.size) throw new Error(`Glob "${slug}" matched no Markdown in ${localRoot}`);
        for (const match of [...matches].sort()) items.push(await page(match, label, typeof item === "object" ? item.hidden : undefined));
      } else items.push(await page(slug, label, typeof item === "object" ? item.hidden : undefined));
    }
    return {
      kind: "group",
      label: input.group,
      id,
      href: input.href,
      collapsed: input.collapsed,
      items,
    };
  }
  return Promise.all(groups.map((g) => group(g, tabName)));
}

export function* markdownPages(groups: readonly ResolvedGroup[]): Generator<ResolvedPage> {
  for (const group of groups)
    for (const item of group.items) {
      if (item.kind === "group") yield* markdownPages([item]);
      else if (item.kind === "page") yield item;
    }
}

export function toWatchPaths(paths: Array<string | undefined>): string[] {
  return paths.filter((path): path is string => Boolean(path));
}

export function assertLocalPath(ctx: SourceAdapterContext, source: string, label: string): string {
  if (ctx.isUrl(source)) {
    throw new Error(`${label} "${source}" in tab "${ctx.tabName}" must be a local file path`);
  }
  return ctx.resolvePath(source);
}

async function resolvePagePath(pageSlug: string, configDir: string): Promise<string> {
  const direct = resolve(configDir, pageSlug);
  const candidates = /\.(md|mdx)$/i.test(direct)
    ? [direct]
    : [`${direct}.md`, `${direct}.mdx`, join(direct, "index.md"), join(direct, "index.mdx")];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // keep trying candidates
    }
  }

  throw new Error(
    `Page "${pageSlug}" not found. Tried:\n` +
      candidates.map((candidate) => `  - ${candidate}`).join("\n") +
      `\n\nPages are referenced relative to sourcey.config.ts. ` +
      `Use slugs like "getting-started" for getting-started.md or "run/index" for run/index.md.`,
  );
}


