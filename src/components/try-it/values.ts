import { isRecord, propertySchema, schemaHas } from "../../core/schema.js";
import { parameterKey, type RequestDraft } from "../../core/request.js";
import type { NormalizedSchema } from "../../core/types.js";
import type { ConsoleData } from "../../core/try-it.js";

const sensitive = /authorization|cookie|password|passwd|secret|token|api[-_]?key/i;
type Purpose = "storage" | "preview" | "clear";

/** One privacy policy for browser persistence, safe previews and credential clearing. */
function filterValue(
  value: unknown,
  schema: NormalizedSchema | undefined,
  purpose: Purpose,
  depth = 0,
): unknown {
  if (value === undefined) return undefined;
  if (
    depth > 24 ||
    schemaHas(schema, (part) => part.writeOnly === true || part.format === "password")
  )
    return purpose === "preview" ? "YOUR_VALUE" : undefined;
  if (value instanceof Blob) return purpose === "storage" ? undefined : value;
  if (Array.isArray(value)) {
    const items: NormalizedSchema[] = [];
    schemaHas(schema, (part) => {
      if (part.items) items.push(part.items);
      return false;
    });
    const itemSchema = items.length > 1 ? { allOf: items } : items[0];
    const filtered = value.map((item) => filterValue(item, itemSchema, purpose, depth + 1));
    // Dropping individual items would silently change their positions on restore.
    return purpose === "storage" && filtered.some((item) => item === undefined)
      ? undefined
      : filtered;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).flatMap(([name, item]) => {
      const declared = propertySchema(schema, name, false);
      if (purpose === "storage" && !declared) return [];
      const filtered = sensitive.test(name)
        ? purpose === "preview"
          ? "YOUR_VALUE"
          : undefined
        : filterValue(item, propertySchema(schema, name), purpose, depth + 1);
      return filtered === undefined ? [] : [[name, filtered]];
    });
    return purpose === "storage" && !entries.length ? undefined : Object.fromEntries(entries);
  }
  return value;
}

export function filterDraft(
  draft: RequestDraft,
  data: ConsoleData,
  purpose: Purpose,
): RequestDraft {
  const parameters = Object.fromEntries(
    data.operation.parameters.flatMap((parameter) => {
      const key = parameterKey(parameter);
      const schema = parameter.schema ?? Object.values(parameter.content ?? {})[0]?.schema;
      const value = sensitive.test(parameter.name)
        ? purpose === "preview" && draft.parameters[key] !== undefined
          ? "YOUR_VALUE"
          : undefined
        : filterValue(draft.parameters[key], schema, purpose);
      return value === undefined ? [] : [[key, value]];
    }),
  );
  const schema = data.operation.requestBody?.content[draft.mediaType]?.schema;
  // Only structured, declared bodies are eligible for persistence.
  const body =
    purpose === "storage" && !schemaHas(schema, (part) => !!part.properties)
      ? undefined
      : filterValue(draft.body, schema, purpose);
  return {
    ...draft,
    parameters,
    body,
    serverVariables: Object.fromEntries(
      Object.entries(draft.serverVariables).flatMap(([name, value]) =>
        sensitive.test(name)
          ? purpose === "preview"
            ? [[name, "YOUR_VALUE"]]
            : []
          : [[name, value]],
      ),
    ),
    auth:
      purpose === "preview"
        ? Object.fromEntries(
            Object.keys(draft.auth).map((name) => [
              name,
              { value: "YOUR_TOKEN", username: "YOUR_USERNAME", password: "YOUR_PASSWORD" },
            ]),
          )
        : {},
  };
}
