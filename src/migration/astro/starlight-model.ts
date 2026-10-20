/** What the Starlight extractor and its sidebar conversion share. */
import type { Diagnostics } from "../diagnostics.js";
import type { Value } from "../javascript.js";
import type { ProjectFiles } from "../project-files.js";
import type { FragmentRule } from "../slugs.js";
import type { AstroRoot } from "./project.js";

export const STARLIGHT_OPENAPI = "starlight-openapi";

export interface StarlightContext {
  project: ProjectFiles;
  diagnostics: Diagnostics;
  root: AstroRoot;
  options: Extract<Value, { kind: "object" }>;
  /** How this root's Astro version derived heading fragments. */
  fragments: FragmentRule;
  /** Files the build copies into the root first (root-relative path to project file). */
  assembled?: Map<string, string>;
}

export interface SourceEntry {
  /** Project-relative file. */
  file: string;
  /** Path inside the locale's content directory, with extension. */
  contentPath: string;
  /** Native locale key; undefined for the default locale. */
  locale?: string;
  /** Path inside the locale's content directory, without extension. */
  documentPath: string;
  /** Starlight's slug, inside the locale and mount. */
  slug: string;
  frontmatter: Record<string, unknown>;
}

export interface Locale {
  key: string;
  label: string;
  lang: string;
  dir?: "rtl" | "ltr";
  /** Starlight's directory for this locale; empty for the root locale. */
  directory: string;
}

/** `path` below `prefix` (`""` for the prefix itself), or undefined when it is not inside it. */
export function withoutPrefix(path: string, prefix: string): string | undefined {
  if (!prefix) return path;
  if (path === prefix) return "";
  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : undefined;
}

