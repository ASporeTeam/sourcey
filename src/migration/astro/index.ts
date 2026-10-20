/**
 * `sourcey migrate astro`: Starlight and custom Astro documentation become a
 * native Sourcey project mounted by `sourcey/astro`. Host pages stay Astro's.
 */
import { posix } from "node:path";
import { Call, print } from "../config-writer.js";
import type { Diagnostics } from "../diagnostics.js";
import { evaluate, identifierName, parseModule, type Value } from "../javascript.js";
import type { EstreeNode } from "../mdx.js";
import type { ResolvedMapping } from "../mapping.js";
import type { FrameworkMigration, NativePlan } from "../plan.js";
import type { ProjectFiles } from "../project-files.js";
import { lineAt, type TextEdit } from "../text-edits.js";
import { convertCustomAstro } from "./custom.js";
import { addIntegration, assembleRoot, astroFragments, findAstroRoots, findIntegration, rewriteIntegration, rewriteModule, stringOption, type AstroRoot } from "./project.js";
import { convertStarlight } from "./starlight.js";

const STARLIGHT = "@astrojs/starlight";

export async function prepareAstro(project: ProjectFiles, diagnostics: Diagnostics, mapping: ResolvedMapping): Promise<FrameworkMigration> {
  const plans: NativePlan[] = [];
  let starlightRoots = 0;
  for (const root of await findAstroRoots(project, diagnostics)) {
    const starlight = findIntegration(root, STARLIGHT);
    const custom = mapping.documentation.get(root.dir);
    if (!starlight && !custom) {
      if (findIntegration(root, "sourcey/astro")) continue;
      diagnostics.error({
        file: root.configFile,
        code: "astro",
        message: "No Starlight integration, and no documentation declared for this root",
        suggestion: `Declare the documentation the project serves under astro.roots["${root.dir}"].documentation in the --mapping file.`,
      });
      continue;
    }
    const fragments = await astroFragments(project, root);
    let converted: { plan: NativePlan; routeBase: string } | undefined;
    if (starlight) {
      starlightRoots += 1;
      const options = starlight.args[0];
      if (options?.kind !== "object") {
        diagnostics.error({ file: root.configFile, line: lineAt(root.scope.source, starlight.node.start), code: "starlight", message: "starlight() options must be an object literal" });
        continue;
      }
      const assemble = mapping.assembled.get(root.dir);
      converted = await convertStarlight({ project, diagnostics, root, options, fragments, assembled: assemble ? await assembleRoot(project, assemble) : undefined });
    } else {
      converted = await convertCustomAstro({ project, diagnostics, root, fragments, name: custom!.name, documentation: custom!.sources });
    }
    if (!converted) continue;
    const plan = converted.plan;
    if (typesetsMarkdown(root, diagnostics)) plan.config.config.markdown = { smartypants: true };
    plan.host = hostOptions(root, converted.routeBase);
    await yieldHostPages(project, root, plan);
    const integration = { text: print(new Call("sourcey", [{ ...plan.host.options }]), starlight ? indentDepth(root.scope.source, starlight.node.start!) : 1), importLine: 'import sourcey from "sourcey/astro";' };
    plan.files.set(root.configFile, {
      bytes: starlight ? rewriteIntegration(root, starlight, integration) : addIntegration(root, integration),
      reason: starlight ? "Mount the native documentation with sourcey/astro instead of Starlight" : "Mount the native documentation with sourcey/astro",
    });
    for (const path of custom?.replaces ?? []) plan.files.set(posix.join(root.dir, path), { bytes: null, reason: "It only served the documentation the native mount now serves" });
    const named = new Set(custom?.sources.map((source) => source.collection).filter(Boolean));
    await removeCollections(project, diagnostics, root, plan, (name, collection) => (starlight ? isStarlightCollection(collection) : named.has(name)));
    plans.push(plan);
  }
  const required = { name: "sourcey", status: "required" as const, detail: "Install it; the Astro configuration now imports sourcey/astro." };
  return {
    plans,
    dependencies: [
      ...(plans.length ? [required] : []),
      ...(starlightRoots
        ? [{ name: STARLIGHT, status: "unused-after-migration" as const, detail: "Native builds no longer import it; uninstall it when the host needs nothing else from it." }]
        : []),
      ...(plans.some((plan) => plan.config.imports.some((item) => item.names?.includes("openapi")))
        ? [{ name: "starlight-openapi", status: "unused-after-migration" as const, detail: "Native API reference tabs replace the plugin." }]
        : []),
    ],
  };
}

/** Astro typesets Markdown quotes, dashes and ellipses unless `markdown.smartypants` is false; the native pages read the same. */
function typesetsMarkdown(root: AstroRoot, diagnostics: Diagnostics): boolean {
  const markdown = root.options.entries.get("markdown");
  const option = markdown?.kind === "object" ? markdown.entries.get("smartypants") : undefined;
  if (!option || option.kind === "literal") return option?.value !== false;
  diagnostics.review({
    file: root.configFile,
    line: lineAt(root.scope.source, option.node.start!),
    code: "smartypants",
    message: "markdown.smartypants is not a literal; the native configuration typesets Markdown, as Astro does by default. Set markdown.smartypants to false in sourcey.config if the site does not.",
  });
  return true;
}

/** At the site root, the host's own home and 404 pages stay its own. */
async function yieldHostPages(project: ProjectFiles, root: AstroRoot, plan: NativePlan): Promise<void> {
  if (plan.host?.options.routeBase !== "/") return;
  const pages = await project.list(posix.join(root.dir, "src/pages"), (path) => /\/(index|404)\.(astro|md|mdx|html)$/.test(path));
  const own = (name: string) => pages.some((path) => path === posix.join(root.dir, `src/pages/${name}${posix.extname(path)}`));
  if (own("index")) plan.host.options.landingPage = false;
  if (own("404")) plan.config.config.notFound = false;
}

function hostOptions(root: AstroRoot, routeBase: string): NonNullable<NativePlan["host"]> {
  const build = root.options.entries.get("build");
  const format = build?.kind === "object" ? stringOption(build.entries.get("format")) : undefined;
  return {
    options: { routeBase, ...(routeBase === "/" ? { allowRootOutput: true as const } : {}) },
    base: stringOption(root.options.entries.get("base")),
    site: stringOption(root.options.entries.get("site")),
    format: format === "file" ? "file" : "directory",
  };
}

/** Depth of the line holding `offset`, in two-space steps, so printed options line up. */
function indentDepth(source: string, offset: number): number {
  const line = source.slice(source.lastIndexOf("\n", offset - 1) + 1, offset);
  const width = line.match(/^[ \t]*/)![0].replace(/\t/g, "  ").length;
  return Math.floor(width / 2);
}

/**
 * The documentation's content collections leave the content configuration;
 * the host's own collections stay. The file goes when nothing else is left.
 */
async function removeCollections(
  project: ProjectFiles,
  diagnostics: Diagnostics,
  root: AstroRoot,
  plan: NativePlan,
  removed: (name: string, collection: Value) => boolean,
): Promise<void> {
  for (const name of ["src/content.config.ts", "src/content.config.mjs", "src/content.config.js"]) {
    const path = posix.join(root.dir, name);
    if (!(await project.exists(path))) continue;
    const scope = await parseModule(project, path);
    const collections = scope.exports.get("collections");
    const value: Value | undefined = collections ? evaluate(collections, scope) : undefined;
    if (value?.kind !== "object") {
      diagnostics.error({ file: path, code: "astro-collections", message: "The content configuration must export a static `collections` object" });
      continue;
    }
    const names = [...value.entries].filter(([key, collection]) => removed(key, collection)).map(([key]) => key);
    if (!names.length) continue;
    if (names.length === value.entries.size) {
      plan.files.set(path, { bytes: null, reason: "It only defined the documentation's collections, which native builds do not use" });
      await reportReferences(project, diagnostics, path);
      continue;
    }
    const edits = (value.node.properties as EstreeNode[])
      .filter((property) => property.type === "Property" && names.includes(identifierName(property.key as EstreeNode)))
      .map((property) => propertyRemoval(scope.source, property));
    plan.files.set(path, { bytes: rewriteModule(scope, edits), reason: `Collections ${names.join(", ")} are native documentation now` });
  }
}

/** A property's range in an object literal, with its separating comma and, when it has a line of its own, that line. */
function propertyRemoval(source: string, property: EstreeNode): TextEdit {
  const lineStart = source.lastIndexOf("\n", property.start! - 1) + 1;
  const ownLine = !source.slice(lineStart, property.start).trim();
  let end = property.end!;
  const comma = source.slice(end).match(/^\s*,/);
  if (comma) end += comma[0].length;
  if (ownLine) {
    const rest = source.slice(end).match(/^[ \t]*\r?\n/);
    return { start: lineStart, end: rest ? end + rest[0].length : end, text: "" };
  }
  const space = source.slice(end).match(/^[ \t]*/)![0];
  return { start: property.start!, end: end + space.length, text: "" };
}

function isStarlightCollection(collection: Value): boolean {
  if (collection.kind !== "call" || collection.args[0]?.kind !== "object") return false;
  const loader = collection.args[0].entries.get("loader");
  return loader?.kind === "call" && loader.callee?.module === `${STARLIGHT}/loaders`;
}

/** Build scripts that name a file the migration removes; the project owns those scripts. */
async function reportReferences(project: ProjectFiles, diagnostics: Diagnostics, path: string): Promise<void> {
  const candidates = [
    ...(await project.list(".", (file) => !file.includes("/") && /^(Dockerfile.*|Makefile|.*\.(sh|toml|ya?ml))$/.test(file))),
    ...(await project.list(".github/workflows")),
  ];
  const needle = posix.basename(path);
  for (const candidate of candidates) {
    const text = await project.readText(candidate);
    const index = text.indexOf(needle);
    if (index === -1) continue;
    diagnostics.review({
      file: candidate,
      line: lineAt(text, index),
      code: "reference",
      message: `This build step uses ${path}, which the migration removes; update the step`,
    });
  }
}
