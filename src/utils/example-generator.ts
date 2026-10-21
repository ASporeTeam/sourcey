import type { NormalizedSchema } from "../core/types.js";
import { omittedField, type SchemaUsage } from "../core/schema.js";

/** Lines a generated example may take before it shows each named object type once. */
export const EXAMPLE_FULL_LINES = 400;

/**
 * Generate an example value from a JSON Schema definition: its own example,
 * default, first enum value or const where it has one, the first alternative
 * of a union, and otherwise a value of its type, with every property.
 *
 * A request example leaves out read-only properties and a response example
 * write-only ones, as OpenAPI defines them; with no usage, both stay.
 *
 * A named object type is never filled in inside itself: an optional property
 * that would repeat it is left out, and a required one is empty. An example
 * longer than EXAMPLE_FULL_LINES shows each named object type once, at its
 * shallowest place, the same way, as the reference draws a schema that size.
 */
export function generateExample(schema: NormalizedSchema, usage?: SchemaUsage): unknown {
  const full = build(schema, { usage, path: "", ancestors: new Set() });
  if (full === undefined || JSON.stringify(full, null, 2).split("\n").length <= EXAMPLE_FULL_LINES) return full;
  return build(schema, { usage, path: "", ancestors: new Set(), homes: exampleHomes(schema, usage) });
}

interface Walk {
  usage?: SchemaUsage;
  /** Where the value sits in the example: property names, with `[]` for an array's items. */
  path: string;
  /** Named types of the objects this value is inside. */
  ancestors: ReadonlySet<string>;
  /** Where each named object type is shown, when the example shows each once. */
  homes?: ReadonlyMap<string, string>;
}

const namedType = (schema: NormalizedSchema) => schema.refName ?? schema.name;

/** Whether the schema's example is an object built from fields, rather than a value of its own. */
function objectLike(schema: NormalizedSchema): boolean {
  if (ownValue(schema)) return false;
  if (schema.allOf?.length || schema.properties) return true;
  const variant = schema.oneOf?.[0] ?? schema.anyOf?.[0];
  return variant ? objectLike(variant) : schema.type === "object";
}

/** An example, default, enum or const: a value the schema states rather than one built from its type. */
const ownValue = (schema: NormalizedSchema) =>
  schema.example !== undefined || !!schema.examples?.length || schema.default !== undefined || !!schema.enum?.length || schema.const !== undefined;

function build(schema: NormalizedSchema, walk: Walk): unknown {
  // Use explicit example first
  if (schema.example !== undefined) return schema.example;
  if (schema.examples?.length) return schema.examples[0];

  // Use default value
  if (schema.default !== undefined) return schema.default;

  // Use first enum value
  if (schema.enum?.length) return schema.enum[0];

  // Use const
  if (schema.const !== undefined) return schema.const;

  const type = namedType(schema);
  if (type && objectLike(schema)) walk = { ...walk, ancestors: new Set(walk.ancestors).add(type) };

  // Handle composition — pick first option
  if (schema.allOf?.length) {
    return mergeAllOfExamples(schema.allOf, walk);
  }
  if (schema.oneOf?.length) {
    return build(schema.oneOf[0], walk);
  }
  if (schema.anyOf?.length) {
    return build(schema.anyOf[0], walk);
  }

  switch (Array.isArray(schema.type) ? schema.type[0] : schema.type) {
    case "object":
      return generateObjectExample(schema, walk);
    case "array":
      return generateArrayExample(schema, walk);
    case "string":
      return generateStringExample(schema);
    case "integer":
      return schema.minimum ?? 0;
    case "number":
      return schema.minimum ?? 0.0;
    case "boolean":
      return true;
    case "null":
      return null;
    default:
      // If it has properties, treat as object
      if (schema.properties) return generateObjectExample(schema, walk);
      return undefined;
  }
}

/** Whether a value at `path` of this schema is shown elsewhere: around it, or at its type's shallower place. */
function shownElsewhere(schema: NormalizedSchema, path: string, walk: Walk): boolean {
  const type = namedType(schema);
  if (!type || !objectLike(schema)) return false;
  return walk.ancestors.has(type) || (walk.homes !== undefined && walk.homes.get(type) !== path);
}

function generateObjectExample(schema: NormalizedSchema, walk: Walk): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    if (omittedField(prop, walk.usage)) continue;
    const path = `${walk.path}.${key}`;
    const array = prop.type === "array" && prop.items;
    if (shownElsewhere(array ? prop.items! : prop, array ? `${path}[]` : path, walk)) {
      // A property that would repeat a type shown elsewhere is left out, or empty where it is required.
      if (schema.required?.includes(key)) obj[key] = array ? [] : {};
      continue;
    }
    const val = build(prop, { ...walk, path });
    if (val !== undefined) obj[key] = val;
  }
  return obj;
}

function generateArrayExample(schema: NormalizedSchema, walk: Walk): unknown[] {
  if (!schema.items) return [];
  const path = `${walk.path}[]`;
  if (shownElsewhere(schema.items, path, walk)) return [];
  const item = build(schema.items, { ...walk, path });
  return item !== undefined ? [item] : [];
}

/**
 * Where an example shows each named object type: the first place a breadth
 * first walk of the fields it is built from reaches it, so its shallowest.
 */
function exampleHomes(schema: NormalizedSchema, usage: SchemaUsage | undefined): Map<string, string> {
  const homes = new Map<string, string>();
  const queue: { schema: NormalizedSchema; path: string }[] = [{ schema, path: "" }];
  const rootType = namedType(schema);
  if (rootType && objectLike(schema)) homes.set(rootType, "");
  for (let next = 0; next < queue.length; next++) {
    for (const child of exampleChildren(queue[next].schema, queue[next].path, usage)) {
      const type = namedType(child.schema);
      if (type && objectLike(child.schema)) {
        if (homes.has(type)) continue;
        homes.set(type, child.path);
      }
      queue.push(child);
    }
  }
  return homes;
}

/** The values an example is built from directly beneath a schema's own, with their paths, as build visits them. */
function exampleChildren(schema: NormalizedSchema, path: string, usage: SchemaUsage | undefined): { schema: NormalizedSchema; path: string }[] {
  if (ownValue(schema)) return [];
  if (schema.allOf?.length) return schema.allOf.flatMap((part) => exampleChildren(part, path, usage));
  const variant = schema.oneOf?.[0] ?? schema.anyOf?.[0];
  if (variant) return exampleChildren(variant, path, usage);
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === "array") return schema.items ? [{ schema: schema.items, path: `${path}[]` }] : [];
  if (type !== "object" && !(type === undefined && schema.properties)) return [];
  return Object.entries(schema.properties ?? {}).filter(([, prop]) => !omittedField(prop, usage)).map(([key, prop]) => ({ schema: prop, path: `${path}.${key}` }));
}

function generateStringExample(schema: NormalizedSchema): string {
  switch (schema.format) {
    case "date-time":
      return "2024-01-15T09:30:00Z";
    case "date":
      return "2024-01-15";
    case "time":
      return "09:30:00Z";
    case "email":
      return "user@example.com";
    case "uri":
    case "url":
      return "https://example.com";
    case "uuid":
      return "550e8400-e29b-41d4-a716-446655440000";
    case "ipv4":
      return "192.168.1.1";
    case "ipv6":
      return "::1";
    case "hostname":
      return "example.com";
    case "binary":
      return "<binary>";
    case "byte":
      return "dGVzdA==";
    case "password":
      return "********";
    default:
      return "string";
  }
}

function mergeAllOfExamples(schemas: NormalizedSchema[], walk: Walk): unknown {
  const merged: Record<string, unknown> = {};
  for (const sub of schemas) {
    const example = build(sub, walk);
    if (example && typeof example === "object" && !Array.isArray(example)) {
      Object.assign(merged, example);
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}
