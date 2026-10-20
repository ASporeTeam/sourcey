import { slug as githubSlug } from "github-slugger";
import { createHash } from "node:crypto";
import type { NormalizedOperation, NormalizedParameter, NormalizedSchema, NormalizedSpec } from "./types.js";
import { omittedField, type SchemaUsage } from "./schema.js";
import { htmlId } from "../utils/html-id.js";

interface ReferenceAnchors {
  byOperation: ReadonlyMap<string, NormalizedOperation>;
  operations: ReadonlyMap<string, string>;
  schemas: ReadonlyMap<string, string>;
  tags: ReadonlyMap<string, string>;
}

export const operationKey = (operation: Pick<NormalizedOperation, "method" | "path">) =>
  `${operation.method.toUpperCase()} ${operation.path}`;

function allocate(entries: [string, string][]): ReadonlyMap<string, string> {
  const groups = new Map<string, Set<string>>();
  for (const [key, preferred] of entries) {
    const group = groups.get(preferred) ?? new Set();
    group.add(key);
    groups.set(preferred, group);
  }
  const result = new Map<string, string>();
  for (const [preferred, keys] of groups) {
    const used = new Set<string>();
    for (const key of [...keys].sort()) {
      let anchor = preferred;
      if (keys.size > 1) {
        const digest = createHash("sha256").update(key).digest("hex");
        let length = 12;
        do {
          anchor = `${preferred}--${digest.slice(0, length++)}`;
        } while (used.has(anchor) && length <= digest.length);
        if (used.has(anchor)) throw new Error(`Reference identity collision: ${key}`);
      }
      used.add(anchor);
      result.set(key, anchor);
    }
  }
  return result;
}

// Normalized specs are immutable source snapshots. Reused snapshots share this
// derived allocation, and the weak key lets discarded compilations be collected.
const allocations = new WeakMap<NormalizedSpec, ReferenceAnchors>();
function anchors(spec: NormalizedSpec): ReferenceAnchors {
  let result = allocations.get(spec);
  if (!result) {
    result = {
      byOperation: new Map(spec.operations.map(operation => [operationKey(operation), operation])),
      operations: allocate(
        spec.operations.map((op) => [
          operationKey(op),
          `operation-${htmlId(op.path)}-${htmlId(op.method)}`,
        ]),
      ),
      schemas: allocate(
        Object.keys(spec.schemas).map((name) => [name, `definition-${htmlId(name) || "item"}`]),
      ),
      tags: allocate(spec.tags.map((tag) => [tag.name, `tag-${htmlId(tag.name) || "item"}`])),
    };
    allocations.set(spec, result);
  }
  return result;
}

/** Resolve the canonical operation identity within its owning immutable spec. */
export function referenceOperation(spec: NormalizedSpec, key: string): NormalizedOperation {
  const operation = anchors(spec).byOperation.get(key);
  if (!operation) throw new Error(`Reference is not in its owning spec: ${key}`);
  return operation;
}

function requireAnchor(map: ReadonlyMap<string, string>, key: string): string {
  const anchor = map.get(key);
  if (!anchor) throw new Error(`Reference is not in its owning spec: ${key}`);
  return anchor;
}
export function operationAnchor(
  operation: Pick<NormalizedOperation, "method" | "path">,
  spec: NormalizedSpec,
): string {
  return requireAnchor(anchors(spec).operations, operationKey(operation));
}
export function definitionAnchor(name: string, spec: NormalizedSpec): string {
  return requireAnchor(anchors(spec).schemas, name);
}
export function tagAnchor(name: string, spec: NormalizedSpec): string {
  return requireAnchor(anchors(spec).tags, name);
}

export type OperationSection = "request-body" | "parameters" | "authentication" | "returns" | "responses" | `response-${string}`;
export function operationSectionAnchor(operation: NormalizedOperation, spec: NormalizedSpec, section: OperationSection, standalone: boolean): string {
  return standalone ? section : `${operationAnchor(operation, spec)}-${section}`;
}
/** The sections an operation has, in the order its page shows them. */
export function operationSections(operation: NormalizedOperation): ("request-body" | "parameters" | "returns" | "responses" | "authentication")[] {
  const sections: ReturnType<typeof operationSections> = [];
  if (operation.requestBody) sections.push("request-body");
  if (operation.parameters.length) sections.push("parameters");
  if (operation.mcpExtras?.outputSchema) sections.push("returns");
  if (!operation.mcpExtras && operation.responses.length) sections.push("responses");
  if (!operation.mcpExtras && operation.security.some(requirement => Object.keys(requirement).length)) sections.push("authentication");
  return sections;
}
export function operationAnchors(operation: NormalizedOperation, spec: NormalizedSpec, standalone: boolean): string[] {
  const sections = operationSections(operation).flatMap((section): OperationSection[] =>
    section === "responses" ? [section, ...operation.responses.map(response => `response-${htmlId(response.statusCode)}` as const)] : [section]);
  return [operationAnchor(operation, spec), ...sections.map(section => operationSectionAnchor(operation, spec, section, standalone)), ...operationFieldAnchors(operation)];
}

/** The schema view and its route inventory stop at the same display depth. */
export const REFERENCE_SCHEMA_MAX_DEPTH = 10;

/**
 * Append semantic path segments without losing case, punctuation or Unicode.
 * Escape UTF-16 units, including '~' itself, so even unusual JSON property
 * names and empty segments remain distinct. '/' separates structure only.
 */
export function referenceFieldPath(root: string, ...segments: string[]): string {
  return root + segments.map(segment => "/" + segment.replace(/[^A-Za-z0-9._-]/g, character => `~${character.charCodeAt(0).toString(16).padStart(4, "0")}`)).join("");
}

export function parameterFieldAnchor(root: string, parameter: Pick<NormalizedParameter, "in" | "name">): string {
  return referenceFieldPath(root, parameter.in, parameter.name);
}

/** Field IDs follow document identity, independent of layout and slug collisions. */
export function operationFieldRoot(operation: Pick<NormalizedOperation, "method" | "path">): string {
  return referenceFieldPath("fields", operation.method.toUpperCase(), operation.path);
}

export function definitionFieldRoot(name: string): string {
  return referenceFieldPath("fields", "schemas", name);
}

export function hasObjectFields(schema: NormalizedSchema): boolean {
  return !!(schema.properties || schema.additionalProperties && typeof schema.additionalProperties !== "boolean");
}

/** One row of an object's field list: a named property, or the type of a map's values. */
export interface ReferenceField {
  name: string;
  schema: NormalizedSchema;
  required: boolean;
  /** Its anchor's segments below the object's. */
  path: string[];
}

/** An object's rows, named properties then map values, less the fields that do not travel this way. */
export function objectFields(schema: NormalizedSchema, usage?: SchemaUsage, required: ReadonlySet<string> = new Set(schema.required)): ReferenceField[] {
  const fields: ReferenceField[] = Object.entries(schema.properties ?? {}).map(([name, property]) => ({ name, schema: property, required: required.has(name), path: ["properties", name] }));
  if (schema.additionalProperties && typeof schema.additionalProperties !== "boolean")
    fields.push({ name: "[key: string]", schema: schema.additionalProperties, required: false, path: ["additionalProperties"] });
  return fields.filter(field => !omittedField(field.schema, usage));
}

/** The field a row opens onto: an array's items, or the field itself. */
export function innerSchema(schema: NormalizedSchema): NormalizedSchema {
  return schema.type === "array" && schema.items ? schema.items : schema;
}

/** Whether a field has more beneath it: fields of its own, a composition's, or its items'. */
export function hasReferenceFields(schema: NormalizedSchema, usage?: SchemaUsage, depth = 0): boolean {
  if (depth >= REFERENCE_SCHEMA_MAX_DEPTH) return false;
  if (objectFields(schema, usage).length || schema.oneOf?.length || schema.anyOf?.length) return true;
  // A part that is no object shows its type; one that is fields shows only those that travel.
  if (schema.allOf?.length) return schema.allOf.some(part => !hasObjectFields(part) && !part.allOf?.length || hasReferenceFields(part, usage, depth + 1));
  return schema.type === "array" && !!schema.items && hasReferenceFields(schema.items, usage, depth + 1);
}

/** Fields the reference schema view renders, including alternate branches. */
export function schemaFieldAnchors(schema: NormalizedSchema, root: string, usage?: SchemaUsage, depth = 0, maxDepth = REFERENCE_SCHEMA_MAX_DEPTH): string[] {
  if (depth >= maxDepth) return [];
  if (schema.allOf?.length) return [
    ...(hasObjectFields(schema) ? schemaFieldAnchors({ ...schema, allOf: undefined }, root, usage, depth + 1, maxDepth) : []),
    ...schema.allOf.flatMap((part, index) => schemaFieldAnchors(part, referenceFieldPath(root, "allOf", String(index)), usage, depth + 1, maxDepth)),
  ];
  if (schema.oneOf?.length || schema.anyOf?.length) {
    const kind = schema.oneOf ? "oneOf" : "anyOf";
    return [
      ...(hasObjectFields(schema) ? schemaFieldAnchors({ ...schema, oneOf: undefined, anyOf: undefined }, root, usage, depth + 1, maxDepth) : []),
      ...(schema.oneOf ?? schema.anyOf ?? []).flatMap((part, index) => schemaFieldAnchors(part, referenceFieldPath(root, kind, String(index)), usage, depth + 1, maxDepth)),
    ];
  }
  if (hasObjectFields(schema))
    return objectFields(schema, usage).flatMap(field => {
      const id = referenceFieldPath(root, ...field.path);
      const inner = innerSchema(field.schema);
      return [id, ...schemaFieldAnchors(inner, inner === field.schema ? id : referenceFieldPath(id, "items"), usage, depth + 1, maxDepth)];
    });
  if (schema.type === "array" && schema.items)
    return schemaFieldAnchors(schema.items, referenceFieldPath(root, "items"), usage, depth + 1, maxDepth);
  return [];
}

const fieldAllocations = new WeakMap<NormalizedOperation, string[]>();
export function operationFieldAnchors(operation: NormalizedOperation): string[] {
  const root = operationFieldRoot(operation);
  let result = fieldAllocations.get(operation);
  if (!result) {
    result = operation.parameters.map(parameter => parameterFieldAnchor(referenceFieldPath(root, "parameters"), parameter));
    for (const [media, content] of Object.entries(operation.requestBody?.content ?? {}))
      if (content.schema) result.push(...schemaFieldAnchors(content.schema, referenceFieldPath(root, "request-body", media), "request"));
    if (operation.mcpExtras?.outputSchema)
      result.push(...schemaFieldAnchors(operation.mcpExtras.outputSchema, referenceFieldPath(root, "returns"), "response"));
    if (!operation.mcpExtras) for (const response of operation.responses) {
      const responseRoot = referenceFieldPath(root, "responses", response.statusCode);
      result.push(...Object.values(response.headers ?? {}).map(parameter => parameterFieldAnchor(referenceFieldPath(responseRoot, "headers"), parameter)));
      for (const [media, content] of Object.entries(response.content ?? {}))
        if (content.schema) result.push(...schemaFieldAnchors(content.schema, referenceFieldPath(responseRoot, "content", media), "response"));
    }
    fieldAllocations.set(operation, result);
  }
  return result;
}

export function definitionAnchors(name: string, spec: NormalizedSpec): string[] {
  const id = definitionAnchor(name, spec);
  return [id, `/definitions/${name}`, ...schemaFieldAnchors(spec.schemas[name], definitionFieldRoot(name))];
}

/** Native operation page paths; source-specific URL rules are converted once into this pattern. */
export function operationPagePath(operation: NormalizedOperation, spec: NormalizedSpec, pattern?: string): string {
  if (pattern === undefined) return `operations/${operationAnchor(operation, spec)}`;
  const values: Record<string, string | undefined> = { operation: operation.operationId ?? operation.path, operationId: operation.operationId, method: operation.method, path: operation.path };
  return pattern.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    if (!Object.hasOwn(values, key)) throw new Error(`Unknown operation route placeholder: ${key}`);
    const value = values[key];
    if (!value) throw new Error(`Operation route requires ${key}: ${operationKey(operation)}`);
    const slug = githubSlug(value);
    if (!slug) throw new Error(`Operation route has an empty ${key}: ${operationKey(operation)}`);
    return slug;
  });
}
export function schemaPagePath(name: string, spec: NormalizedSpec): string {
  return `models/${definitionAnchor(name, spec).slice("definition-".length)}`;
}
