/**
 * Docusaurus translations as native locales. Docusaurus keeps a locale's docs
 * in `<i18n>/<locale>/docusaurus-plugin-content-docs/<version>/`, mirroring the
 * version's content, and shows the default locale's page where a translation
 * is missing, as native does. Native reads a locale from a directory of its
 * name inside the content, so each translated file moves there once.
 */
import { posix } from "node:path";
import type { ProjectFiles } from "../project-files.js";
import { readDocs, type DocusaurusDoc } from "./docs.js";
import type { DocsInstance, DocusaurusSite } from "./site.js";
import type { DocsVersion } from "./versions.js";

export interface Translation {
  locale: string;
  /** Translated documents, with the paths they move to. */
  docs: (DocusaurusDoc & { target: string })[];
  /** The directory's other files (images, downloads): source by destination. */
  files: Map<string, string>;
  /** Translated category labels, by the default label. */
  labels: Map<string, string>;
}

/** The site's non-default locales, as native keys. */
export function translatedLocales(site: DocusaurusSite): string[] {
  return site.locales.locales.filter((locale) => locale !== site.locales.defaultLocale);
}

/** Docusaurus's default label for a locale: its own name for itself, capitalised. */
export function localeLabel(site: DocusaurusSite, locale: string): string {
  const configured = site.locales.configs[locale]?.label;
  if (configured) return configured;
  const name = new Intl.DisplayNames(locale, { type: "language" }).of(locale) ?? locale;
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}

export async function readTranslations(
  project: ProjectFiles,
  site: DocusaurusSite,
  instance: DocsInstance,
  version: DocsVersion,
  docs: readonly DocusaurusDoc[],
  fail: (message: string) => void,
): Promise<Translation[]> {
  const sources = new Set(docs.map((doc) => doc.source));
  const translations: Translation[] = [];
  for (const locale of translatedLocales(site)) {
    const directory = posix.join(site.locales.path, site.locales.configs[locale]?.path ?? locale, version.localized);
    const labels = await categoryLabels(project, `${directory}.json`);
    const target = posix.join(version.contentDir, locale);
    const translation: Translation = { locale, docs: [], files: new Map(), labels };
    translations.push(translation);
    if (!(await project.isDirectory(directory))) continue;
    if (await project.exists(target)) {
      fail(`${target} would hold the ${locale} translation of ${version.contentDir}, which already has that directory`);
      continue;
    }
    // Docusaurus translates the default locale's documents; a file with no original is never published.
    const translated = (await readDocs(project, instance, directory)).filter((doc) => sources.has(doc.source) && !doc.draft);
    translation.docs = translated.map((doc) => ({ ...doc, target: posix.join(target, doc.source) }));
    const moved = new Set(translated.map((doc) => doc.file));
    for (const file of await project.list(directory))
      if (!moved.has(file) && !/\.mdx?$/.test(file)) translation.files.set(posix.join(target, file.slice(directory.length + 1)), file);
  }
  return translations;
}

/** `current.json` (or `version-<name>.json`) category labels: `sidebar.<sidebar>.category.<label>`. */
async function categoryLabels(project: ProjectFiles, file: string): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  if (!(await project.exists(file))) return labels;
  for (const [key, value] of Object.entries(JSON.parse(await project.readText(file)) as Record<string, { message?: unknown }>)) {
    const match = key.match(/^sidebar\.[^.]+\.category\.(.+)$/);
    if (match && !key.includes(".link.generated-index.") && typeof value?.message === "string") labels.set(match[1], value.message);
  }
  return labels;
}
