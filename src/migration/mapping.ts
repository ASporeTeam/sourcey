/**
 * The optional one-time mapping a project supplies for what a converter cannot
 * infer: its own components, MDX element overrides native Markdown covers, and
 * content assembled outside the repository before a build. It is read during
 * migration only and never becomes native configuration.
 */
import { resolve } from "node:path";
import { createJiti } from "jiti";
import { starlightConverters } from "./astro/starlight-components.js";
import { identityKey, mermaidConverters, type ComponentConverter, type ConverterTable } from "./components.js";
import { docusaurusConverters } from "./docusaurus/components.js";
import { mintlifyConverters } from "./mintlify/components.js";
import { resolveModule } from "./javascript.js";
import type { ProjectFiles } from "./project-files.js";

/** A file or directory a build copies into an Astro root before it runs. */
export interface AssembledPath {
  /** Project-relative file or directory. */
  from: string;
  /** Destination relative to the Astro root. */
  to: string;
  /** Globs, relative to `from`, that the copy leaves out. */
  exclude?: string[];
}

/** A navigation entry as the project's own data or layout describes it. */
export interface SourceNavigationItem {
  label: string;
  /** Public path (`/documentation/advanced`) or external URL; a group without a landing page has none. */
  link?: string;
  children?: SourceNavigationItem[];
}

/** A documentation file as the converter found it, for a mapping that computes navigation. */
export interface SourceDocumentInfo {
  /** Project-relative file. */
  file: string;
  /** Path inside the documentation source, without extension. */
  path: string;
  /** Public path the project serves it at. */
  route: string;
  frontmatter: Record<string, unknown>;
}

/** Documentation an Astro project serves through its own pages or content collection, instead of Starlight. */
export interface AstroDocumentation {
  /** Project-relative directory holding the Markdown/MDX files. */
  source: string;
  /** `pages`: Astro routes each file by its path. `collection`: a route renders each content entry by its ID. */
  kind: "pages" | "collection";
  /** Public path the documentation publishes under, such as `/documentation`. */
  route: string;
  /** Destination for files that must leave an Astro route directory (`src/pages`). */
  move?: string;
  /** Tab label when a project has several documentation sources. */
  label?: string;
  /** The content collection that loads these files, removed from the content configuration. */
  collection?: string;
  /** A host page file that served `route` itself; it becomes the documentation's index page. */
  landing?: string;
  /**
   * The navigation the project rendered: data; a project module export read
   * statically, naming the fields that hold each entry's label, link and
   * children; or a function computing it once from the documents.
   */
  navigation:
    | SourceNavigationItem[]
    | { module: string; export: string; fields: { label: string; link: string; children?: string } }
    | ((documents: SourceDocumentInfo[]) => SourceNavigationItem[] | Promise<SourceNavigationItem[]>);
}

export interface MigrationMapping {
  /** Converters by module and export name. Project modules are written `./src/...`; anything else is a package. */
  components?: Record<string, Record<string, ComponentConverter>>;
  /** `module#export` of MDX `components` exports whose element overrides native Markdown provides. */
  markdown?: string[];
  /** Native component definitions to register, by authoring name, as project-relative module paths. */
  definitions?: Record<string, string>;
  /** Docusaurus pages written in React, which have no native form, that the project retires with the migration. */
  docusaurus?: { removePages?: string[] };
  /**
   * Per Astro root: paths its build copies in first (as a Dockerfile or script does),
   * and documentation it serves without Starlight.
   */
  astro?: {
    roots?: Record<
      string,
      {
        assemble?: AssembledPath[];
        name?: string;
        documentation?: AstroDocumentation[];
        /** Host files that only served the old documentation (routes, layouts, its search endpoint); removed. */
        replaces?: string[];
      }
    >;
  };
}

export interface ResolvedMapping {
  converters: ConverterTable;
  elementOverrides: Set<string>;
  definitions: Map<string, string>;
  assembled: Map<string, AssembledPath[]>;
  documentation: Map<string, { name?: string; sources: AstroDocumentation[]; replaces: string[] }>;
  removedPages: Set<string>;
}

/** Conversions for public packages whose exports have a fixed meaning. */
export function builtinConverters(): ConverterTable {
  return new Map([...starlightConverters(), ...docusaurusConverters(), ...mintlifyConverters(), ...mermaidConverters()]);
}

export async function loadMapping(project: ProjectFiles, path: string | undefined): Promise<ResolvedMapping> {
  const converters = builtinConverters();
  const resolved: ResolvedMapping = { converters, elementOverrides: new Set(), definitions: new Map(), assembled: new Map(), documentation: new Map(), removedPages: new Set() };
  if (!path) return resolved;
  const jiti = createJiti(import.meta.url, { tryNative: false, moduleCache: false });
  const mapping = ((await jiti.import(resolve(path))) as { default?: MigrationMapping }).default;
  if (!mapping || typeof mapping !== "object") throw new Error(`The migration mapping must default-export an object: ${path}`);
  // Resolved like an import written in a file at the project root.
  const local = (module: string) => resolveModule(project, "mapping", module);
  for (const [module, exports] of Object.entries(mapping.components ?? {})) {
    const identity = await local(module);
    for (const [name, converter] of Object.entries(exports)) {
      if (typeof converter !== "function") throw new Error(`Mapping for ${module}#${name} must be a function`);
      converters.set(identityKey(identity, name), converter);
    }
  }
  for (const entry of mapping.markdown ?? []) {
    const [module, name = "default"] = entry.split("#");
    resolved.elementOverrides.add(identityKey(await local(module), name));
  }
  for (const [name, module] of Object.entries(mapping.definitions ?? {})) {
    if (!/^[A-Z]\w*$/.test(name)) throw new Error(`Native component names start with a capital letter: ${name}`);
    resolved.definitions.set(name, project.path(module));
  }
  for (const page of mapping.docusaurus?.removePages ?? []) resolved.removedPages.add(project.path(page));
  for (const [root, value] of Object.entries(mapping.astro?.roots ?? {})) {
    if (value.assemble) resolved.assembled.set(root, value.assemble);
    if (value.documentation) resolved.documentation.set(root, { name: value.name, sources: value.documentation, replaces: value.replaces ?? [] });
  }
  return resolved;
}
