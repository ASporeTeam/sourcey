/**
 * The slug rules source frameworks publish with, so converted routes and
 * fragments keep their original spelling.
 */

interface Slugger {
  slug(value: string): string;
}

let github: Promise<{ slug: (value: string) => string; create: () => Slugger }> | undefined;

/** github-slugger, as used by Astro, Starlight, rehype-slug and starlight-openapi. */
export function githubSlugs() {
  github ??= import("github-slugger").then((module) => ({
    slug: (value: string) => module.slug(value),
    create: () => new module.default(),
  }));
  return github;
}

/** Astro's content entry slug: each path segment slugged, `/index` dropped. */
export async function astroEntrySlug(relativePath: string): Promise<string> {
  const { slug } = await githubSlugs();
  return relativePath
    .replace(/\.[^./]+$/, "")
    .split("/")
    .map((segment) => slug(segment))
    .join("/")
    .replace(/\/index$/, "");
}

/**
 * How a source framework derived heading fragments: github-slugger
 * (`github`); github-slugger with one trailing hyphen removed afterwards
 * (`github-trimmed`, Astro 5 and earlier); or Python-Markdown's `toc` slugify.
 */
export type FragmentRule = "github" | "github-trimmed" | "python-markdown";

/** A fresh slugger for one document's headings under `rule`. */
export async function fragmentSlugger(rule: FragmentRule): Promise<Slugger> {
  if (rule === "python-markdown") return pythonMarkdownSlugger();
  const slugger = (await githubSlugs()).create();
  // Astro trims after slugging, so duplicates still count the untrimmed slug.
  return rule === "github" ? slugger : { slug: (value) => slugger.slug(value).replace(/-$/, "") };
}

/** Python-Markdown `toc` default slugify and its `_1` duplicate suffix. */
function pythonMarkdownSlugger(): Slugger {
  const seen = new Set<string>();
  return {
    slug(value: string) {
      const ascii = value.normalize("NFKD").replace(/[^\p{ASCII}]/gu, "");
      const base = ascii
        .replace(/[^\w\s-]/g, "")
        .trim()
        .toLowerCase()
        .replace(/[-\s]+/g, "-");
      let candidate = base;
      for (let index = 1; seen.has(candidate); index += 1) candidate = `${base}_${index}`;
      seen.add(candidate);
      return candidate;
    },
  };
}
