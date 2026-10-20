/** Reading and editing an Astro project's configuration, without running it. */
import { posix } from "node:path";
import type { Diagnostics } from "../diagnostics.js";
import type { AssembledPath } from "../mapping.js";
import { evaluate, parseModule, type ModuleScope, type Value } from "../javascript.js";
import type { EstreeNode } from "../mdx.js";
import type { ProjectFiles } from "../project-files.js";
import type { FragmentRule } from "../slugs.js";
import { applyEdits, lineAt, lineEnd, type TextEdit } from "../text-edits.js";

const CONFIG_NAMES = ["astro.config.mjs", "astro.config.ts", "astro.config.mts", "astro.config.js", "astro.config.cjs"];

export interface AstroRoot {
  /** Project-relative directory, `.` for the repository root. */
  dir: string;
  configFile: string;
  scope: ModuleScope;
  /** The object passed to `defineConfig`, or the default-exported object. */
  options: Extract<Value, { kind: "object" }>;
  /** The package script that builds this root, when one does. */
  script?: string;
}

/** The main Astro root plus any root a package script builds with `--root`. */
export async function findAstroRoots(project: ProjectFiles, diagnostics: Diagnostics): Promise<AstroRoot[]> {
  const dirs = new Map<string, string | undefined>([[".", undefined]]);
  if (await project.exists("package.json")) {
    const scripts = (JSON.parse(await project.readText("package.json")) as { scripts?: Record<string, string> }).scripts ?? {};
    for (const [name, command] of Object.entries(scripts)) {
      const root = command.match(/\bastro\s+(?:build|dev)\b.*?--root[= ](?:"([^"]+)"|'([^']+)'|(\S+))/);
      const dir = root && posix.normalize(root[1] ?? root[2] ?? root[3]).replace(/\/$/, "");
      if (dir && dir !== "." && !dirs.has(dir)) dirs.set(dir, name);
    }
  }
  const roots: AstroRoot[] = [];
  for (const [dir, script] of dirs) {
    const configFile = await firstExisting(project, CONFIG_NAMES.map((name) => posix.join(dir, name)));
    if (!configFile) {
      if (dir === ".") diagnostics.error({ file: "astro.config.mjs", code: "astro-config", message: "No Astro configuration found" });
      continue;
    }
    const scope = await parseModule(project, configFile);
    const exported = scope.defaultExport ? evaluate(scope.defaultExport, scope) : undefined;
    const options =
      exported?.kind === "call" && exported.callee?.module === "astro/config" && exported.callee.export === "defineConfig"
        ? exported.args[0]
        : exported;
    if (options?.kind !== "object") {
      diagnostics.error({
        file: configFile,
        line: lineAt(scope.source, scope.defaultExport?.start),
        code: "astro-config",
        message: "The Astro configuration must export an object literal, directly or through defineConfig()",
      });
      continue;
    }
    roots.push({ dir, configFile, scope, options, script });
  }
  return roots;
}

async function firstExisting(project: ProjectFiles, paths: string[]): Promise<string | undefined> {
  for (const path of paths) if (await project.exists(path)) return path;
  return undefined;
}

/**
 * The files a build copies into an Astro root before running, as root-relative
 * path to project file; later paths win, as later copies do.
 */
export async function assembleRoot(project: ProjectFiles, paths: readonly AssembledPath[]): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const path of paths) {
    if (!(await project.exists(path.from))) continue;
    if (!(await project.isDirectory(path.from))) {
      files.set(path.to, project.path(path.from));
      continue;
    }
    const base = project.path(path.from);
    for (const file of await project.list(base)) {
      const inside = file.slice(base.length + 1);
      if (path.exclude?.some((pattern) => posix.matchesGlob(inside, pattern))) continue;
      files.set(posix.join(path.to, inside), file);
    }
  }
  return files;
}

/** An integration call in `integrations: [...]` whose callee is the given import. */
export function findIntegration(
  root: AstroRoot,
  module: string,
  exportName = "default",
): Extract<Value, { kind: "call" }> | undefined {
  const integrations = root.options.entries.get("integrations");
  if (integrations?.kind !== "array") return undefined;
  for (const item of integrations.items) {
    if (item.kind === "call" && item.callee?.module === module && item.callee.export === exportName) return item;
  }
  return undefined;
}

/** Add an integration call to `integrations: [...]`, with its import after the last import. */
export function addIntegration(root: AstroRoot, replacement: { text: string; importLine: string }): string {
  const { scope } = root;
  const integrations = root.options.entries.get("integrations");
  let edit: TextEdit;
  if (integrations?.kind === "array") {
    const close = integrations.node.end! - 1;
    const before = scope.source.slice(integrations.node.start! + 1, close);
    const separator = before.trim() ? (before.trimEnd().endsWith(",") ? " " : ", ") : "";
    const at = integrations.node.start! + 1 + before.trimEnd().length;
    edit = { start: at, end: at, text: `${separator}${replacement.text}` };
  } else {
    const at = root.options.node.start! + 1;
    edit = { start: at, end: at, text: `\n  integrations: [${replacement.text}],` };
  }
  return rewriteModule(scope, [edit], { importLine: replacement.importLine });
}

/** Replace an integration call in the Astro configuration, and its import. */
export function rewriteIntegration(root: AstroRoot, call: Extract<Value, { kind: "call" }>, replacement: { text: string; importLine: string }): string {
  return rewriteModule(root.scope, [{ start: call.node.start!, end: call.node.end!, text: replacement.text }], {
    importLine: replacement.importLine,
    replacing: call.calleeName,
  });
}

/**
 * How the Astro version that builds this root derives heading fragments.
 * Astro 5 and earlier trim a trailing hyphen from github-slugger's slug
 * unless `markdown.experimentalHeadingIdCompat` is set; later versions do not.
 */
export async function astroFragments(project: ProjectFiles, root: AstroRoot): Promise<FragmentRule> {
  const markdown = root.options.entries.get("markdown");
  const compat = markdown?.kind === "object" ? markdown.entries.get("experimentalHeadingIdCompat") : undefined;
  if (compat?.kind === "literal" && compat.value === true) return "github";
  for (let dir = root.dir; ; dir = posix.dirname(dir)) {
    const manifest = posix.join(dir, "package.json");
    if (await project.exists(manifest)) {
      const { dependencies, devDependencies } = JSON.parse(await project.readText(manifest)) as Record<string, Record<string, string> | undefined>;
      const range = dependencies?.astro ?? devDependencies?.astro;
      if (range) return Number(range.match(/\d+/)?.[0]) <= 5 ? "github-trimmed" : "github";
    }
    if (dir === ".") return "github";
  }
}

export function stringOption(value: Value | undefined): string | undefined {
  return value?.kind === "literal" && typeof value.value === "string" ? value.value : undefined;
}

/**
 * Apply edits to a module, then remove the top-level constants and import
 * specifiers the edits left unreferenced (never ones that were unused already).
 * A new import line takes the place of the import it replaces, or follows the
 * last import.
 */
export function rewriteModule(scope: ModuleScope, edits: TextEdit[], options: { importLine?: string; replacing?: string } = {}): string {
  const before = referencedNames(scope.program, []);
  const orphaned = (name: string, used: Set<string>) => before.has(name) && !used.has(name);
  const all = [...edits];
  const gone: { start: number; end: number }[] = edits.map(({ start, end }) => ({ start, end }));
  const removed = new Set<EstreeNode>();
  for (let changed = true; changed; ) {
    changed = false;
    const used = referencedNames(scope.program, gone);
    for (const statement of scope.program.body) {
      if (removed.has(statement) || statement.type !== "VariableDeclaration") continue;
      const names = (statement.declarations as EstreeNode[]).map((declarator) => (declarator.id as EstreeNode).name as string);
      if (!names.every((name) => orphaned(name, used))) continue;
      removed.add(statement);
      const range = { start: statement.start!, end: lineEnd(scope.source, statement.end!) };
      all.push({ ...range, text: "" });
      gone.push(range);
      changed = true;
    }
  }
  const used = referencedNames(scope.program, gone);
  let importPlaced = !options.importLine;
  for (const statement of scope.program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    const specifiers = statement.specifiers as EstreeNode[];
    if (!specifiers.length) continue;
    const keep = specifiers.filter((specifier) => !orphaned((specifier.local as { name: string }).name, used));
    if (keep.length === specifiers.length) continue;
    const replaced = !importPlaced && specifiers.some((specifier) => (specifier.local as { name: string }).name === options.replacing);
    const text = `${replaced ? `${options.importLine}\n` : ""}${keep.length ? `${printImport(statement, keep, scope.source)}\n` : ""}`;
    if (replaced) importPlaced = true;
    all.push({ start: statement.start!, end: lineEnd(scope.source, statement.end!), text });
  }
  if (!importPlaced) {
    const lastImport = [...scope.program.body].reverse().find((statement) => statement.type === "ImportDeclaration");
    const at = lastImport ? lineEnd(scope.source, lastImport.end!) : 0;
    all.push({ start: at, end: at, text: `${options.importLine}\n` });
  }
  return applyEdits(scope.source, all);
}

function printImport(statement: EstreeNode, specifiers: EstreeNode[], source: string): string {
  const from = source.slice((statement.source as EstreeNode).start!, (statement.source as EstreeNode).end!);
  const defaults = specifiers.filter((specifier) => specifier.type === "ImportDefaultSpecifier");
  const namespace = specifiers.filter((specifier) => specifier.type === "ImportNamespaceSpecifier");
  const named = specifiers.filter((specifier) => specifier.type === "ImportSpecifier");
  const parts = [
    ...defaults.map((specifier) => source.slice(specifier.start!, specifier.end!)),
    ...namespace.map((specifier) => source.slice(specifier.start!, specifier.end!)),
    ...(named.length ? [`{ ${named.map((specifier) => source.slice(specifier.start!, specifier.end!)).join(", ")} }`] : []),
  ];
  return `import ${parts.join(", ")} from ${from};`;
}

/** Identifier names referenced outside imports, declared names and the given ranges. */
function referencedNames(program: EstreeNode, excluded: readonly { start: number; end: number }[]): Set<string> {
  const names = new Set<string>();
  const outside = (node: EstreeNode) => !excluded.some((range) => node.start !== undefined && node.start >= range.start && node.end! <= range.end);
  const visit = (node: unknown, parentKey?: string) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, parentKey);
      return;
    }
    const current = node as EstreeNode;
    if (typeof current.type !== "string" || current.type === "ImportDeclaration" || !outside(current)) return;
    if (current.type === "Identifier" && !["key", "property", "id"].includes(parentKey ?? "")) names.add(current.name as string);
    for (const [key, value] of Object.entries(current)) {
      if (key === "loc" || key === "range" || key === "start" || key === "end") continue;
      const role =
        (current.type === "Property" && key === "key" && !current.computed) || (current.type === "MemberExpression" && key === "property" && !current.computed)
          ? key === "key" ? "key" : "property"
          : current.type === "VariableDeclarator" && key === "id"
            ? "id"
            : key;
      visit(value, role);
    }
  };
  visit(program);
  return names;
}
