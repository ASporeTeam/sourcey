import type { NormalizedSchema } from "../core/types.js";
import { omittedField, type SchemaUsage } from "../core/schema.js";

/**
 * Generate an example value from a JSON Schema definition.
 *
 * Improvements over legacy:
 * - Handles anyOf/oneOf (picks first option)
 * - Uses default values and first enum value
 * - Returns "[circular]" instead of raw $ref string on cycles
 * - Cycle detection via Set<string> instead of array linear scan
 *
 * A request example leaves out read-only properties and a response example
 * write-only ones, as OpenAPI defines them; with no usage, both stay.
 */
export function generateExample(
  schema: NormalizedSchema,
  usage?: SchemaUsage,
  seen: Set<string> = new Set(),
): unknown {
  // Cycle detection using schema name
  if (schema.name) {
    if (seen.has(schema.name)) return "[circular]";
    seen = new Set(seen);
    seen.add(schema.name);
  }

  // Use explicit example first
  if (schema.example !== undefined) return schema.example;
  if (schema.examples?.length) return schema.examples[0];

  // Use default value
  if (schema.default !== undefined) return schema.default;

  // Use first enum value
  if (schema.enum?.length) return schema.enum[0];

  // Use const
  if (schema.const !== undefined) return schema.const;

  // Handle composition — pick first option
  if (schema.allOf?.length) {
    return mergeAllOfExamples(schema.allOf, usage, seen);
  }
  if (schema.oneOf?.length) {
    return generateExample(schema.oneOf[0], usage, seen);
  }
  if (schema.anyOf?.length) {
    return generateExample(schema.anyOf[0], usage, seen);
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  switch (type) {
    case "object":
      return generateObjectExample(schema, usage, seen);
    case "array":
      return generateArrayExample(schema, usage, seen);
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
      if (schema.properties) return generateObjectExample(schema, usage, seen);
      return undefined;
  }
}

function generateObjectExample(
  schema: NormalizedSchema,
  usage: SchemaUsage | undefined,
  seen: Set<string>,
): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (omittedField(prop, usage)) continue;
      const val = generateExample(prop, usage, seen);
      if (val !== undefined) {
        obj[key] = val;
      }
    }
  }
  return obj;
}

function generateArrayExample(
  schema: NormalizedSchema,
  usage: SchemaUsage | undefined,
  seen: Set<string>,
): unknown[] {
  if (schema.items) {
    const item = generateExample(schema.items, usage, seen);
    return item !== undefined ? [item] : [];
  }
  return [];
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

function mergeAllOfExamples(
  schemas: NormalizedSchema[],
  usage: SchemaUsage | undefined,
  seen: Set<string>,
): unknown {
  const merged: Record<string, unknown> = {};
  for (const sub of schemas) {
    const example = generateExample(sub, usage, seen);
    if (example && typeof example === "object" && !Array.isArray(example)) {
      Object.assign(merged, example);
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}
