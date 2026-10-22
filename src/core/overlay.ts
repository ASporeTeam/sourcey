import { createRequire } from "node:module";
import { loadDocument, type InputReader } from "./loader.js";
import type { LoadedSpec } from "./types.js";
import type { ResolvedOpenApiSource } from "../adapters/types.js";

export interface OverlayDiagnostic {
  code: "overlay-unmatched";
  severity: "warning";
  file: string;
  action: number;
  target: string;
  message: string;
}
interface Action {
  target: string;
  description?: string;
  update?: unknown;
  remove?: boolean;
}
interface Overlay {
  overlay: string;
  info: { title: string; version: string };
  extends?: string;
  actions: Action[];
}
type Container = Record<string, unknown> | unknown[];
type Unmatched = NonNullable<ResolvedOpenApiSource["overlayUnmatched"]>;

export function formatOverlayDiagnostic(diagnostic: OverlayDiagnostic): string {
  return `${diagnostic.file}: action ${diagnostic.action} (${diagnostic.target}): ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`;
}

/** Own the freshly loaded raw document. Keep loaded.source as the $ref base. */
export async function applyOverlays(loaded: LoadedSpec, source: ResolvedOpenApiSource, input: InputReader): Promise<OverlayDiagnostic[]> {
  const diagnostics: OverlayDiagnostic[] = [];
  for (const file of source.overlays ?? []) {
    const { raw } = await loadDocument(file, input, loaded.source);
    diagnostics.push(...applyOverlay(loaded.raw, raw, file, source.overlayUnmatched ?? "error"));
  }
  return diagnostics;
}

const require = createRequire(import.meta.url);

/** Overlay 1.0, applied in place to a document owned by the caller. */
export function applyOverlay(document: Record<string, unknown>, value: unknown, file: string, unmatched: Unmatched = "error"): OverlayDiagnostic[] {
  // JSONPath loads with the first overlay; most sites have none.
  const { evaluate, NormalizedPath } = require("@swaggerexpert/jsonpath") as typeof import("@swaggerexpert/jsonpath");
  const overlay = validateOverlay(value, file);
  const diagnostics: OverlayDiagnostic[] = [];
  for (const [index, action] of overlay.actions.entries()) {
    const where = `${file}: action ${index + 1} (${action.target})`;
    // Resolve the full selection before changing it. Array removals must use
    // original indices, and a union can select the same node more than once.
    const matches = new Map<string, { value: unknown; path: (string | number)[] }>();
    try {
      evaluate(document, action.target, { callback(value, path) {
        matches.set(path, { value, path: NormalizedPath.to(path) });
      } });
    } catch (error) {
      throw new Error(`${where}: ${message(error)}`, { cause: error });
    }
    for (const match of matches.values()) if (!isContainer(match.value)) throw new Error(`${where}: Overlay 1.0 targets must select objects or arrays; select the containing object to replace a primitive`);
    if (!matches.size && unmatched !== "ignore") {
      const diagnostic: OverlayDiagnostic = { code: "overlay-unmatched", severity: "warning", file, action: index + 1, target: action.target,
        message: "No nodes matched. Check whether the source document or this target changed." };
      if (unmatched === "error") throw new Error(`${where}: [${diagnostic.code}] ${diagnostic.message} Use overlayUnmatched: 'warn' or 'ignore' for intentionally optional actions.`);
      diagnostics.push(diagnostic);
    }
    try {
      if (action.remove) {
        const removals = [...matches.values()].map(match => {
          if (!match.path.length) throw new Error("Cannot remove the document root");
          let parent: Container = document;
          for (const key of match.path.slice(0, -1)) parent = own(parent, key) as Container;
          return { parent, key: match.path.at(-1)! };
        });
        const byParent = new Map<Container, Set<string | number>>();
        for (const { parent, key } of removals) {
          const keys = byParent.get(parent) ?? new Set();
          keys.add(key); byParent.set(parent, keys);
        }
        for (const [parent, keys] of byParent) {
          if (Array.isArray(parent)) for (const key of [...keys].sort((a, b) => Number(b) - Number(a))) parent.splice(Number(key), 1);
          else for (const key of keys) delete parent[key];
        }
      } else if (Object.hasOwn(action, "update")) {
        for (const match of matches.values()) {
          if (Array.isArray(match.value)) match.value.push(structuredClone(action.update));
          else if (isRecord(match.value)) {
            if (!isRecord(action.update)) throw new Error("An object target requires an object update");
            mergeObject(match.value, action.update);
          }
        }
      }
    } catch (error) {
      throw new Error(`${where}: ${message(error)}`, { cause: error });
    }
  }
  return diagnostics;
}

/** Object members merge recursively; an array target appends one entry in 1.0. */
function mergeObject(target: Record<string, unknown>, update: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(update)) {
    const existing = own(target, key);
    if (isRecord(existing) && isRecord(value)) mergeObject(existing, value);
    else Object.defineProperty(target, key, { value: structuredClone(value), writable: true, enumerable: true, configurable: true });
  }
}
function own(object: Container, key: string | number): unknown {
  return Object.hasOwn(object, key) ? (object as Record<string | number, unknown>)[key] : undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function isContainer(value: unknown): value is Container { return isRecord(value) || Array.isArray(value); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function validateOverlay(value: unknown, file: string): Overlay {
  function fail(reason: string): never { throw new Error(`${file}: Invalid OpenAPI overlay: ${reason}`); }
  function fields(object: Record<string, unknown>, allowed: string[], location: string): void {
    for (const key of Object.keys(object)) if (!allowed.includes(key) && !key.startsWith("x-")) fail(`${location}: unknown property ${key}`);
  }
  if (!isRecord(value)) fail("expected an object");
  if (typeof value.overlay !== "string" || !/^1\.0\.\d+$/.test(value.overlay)) fail(`unsupported overlay version ${JSON.stringify(value.overlay)}; Sourcey supports the complete 1.0 feature set`);
  fields(value, ["overlay", "info", "extends", "actions"], "overlay");
  if (!isRecord(value.info) || typeof value.info.title !== "string" || typeof value.info.version !== "string") fail("info.title and info.version must be strings");
  fields(value.info, ["title", "version"], "info");
  if (value.extends !== undefined && typeof value.extends !== "string") fail("extends must be a URI string");
  if (!Array.isArray(value.actions) || !value.actions.length) fail("actions must be a nonempty array");
  for (const [index, action] of value.actions.entries()) {
    const where = `action ${index + 1}`;
    if (!isRecord(action) || typeof action.target !== "string" || !action.target) fail(`${where}: target must be a JSONPath string`);
    fields(action, ["target", "description", "update", "remove"], where);
    if (action.description !== undefined && typeof action.description !== "string") fail(`${where}: description must be a string`);
    if (action.remove !== undefined && typeof action.remove !== "boolean") fail(`${where}: remove must be a boolean`);
  }
  // YAML may contain cycles, dates, or non-finite values; overlays are JSON data.
  const parents = new Set<object>();
  function json(node: unknown): void {
    if (node === null || typeof node === "string" || typeof node === "boolean" || typeof node === "number" && Number.isFinite(node)) return;
    if (!isContainer(node) || parents.has(node)) fail("values must be finite, acyclic JSON data");
    parents.add(node);
    for (const child of Object.values(node)) json(child);
    parents.delete(node);
  }
  json(value);
  return value as unknown as Overlay;
}
