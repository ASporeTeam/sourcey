import type { ParsedSpec } from "./types.js";

/**
 * Convert a Swagger 2.0 spec to OpenAPI 3.0 format.
 * If the spec is already OpenAPI 3.x, returns it as-is.
 *
 * Expects the spec to already be dereferenced (all $refs resolved).
 */
export async function convertToOpenApi3(parsed: ParsedSpec): Promise<ParsedSpec> {
  const doc = parsed.document;

  // Already OpenAPI 3.x — return as-is
  if (typeof doc.openapi === "string" && doc.openapi.startsWith("3.")) {
    return parsed;
  }

  // Swagger 2.0 — convert to OpenAPI 3.0
  const { convertObj } = await import("swagger2openapi");

  // Break circular references (from dereferencing) before converting,
  // and enable anchors mode so swagger2openapi handles any remaining ones.
  const cleanDoc = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
  preserveFormFieldSchemas(cleanDoc);
  const result = await convertObj(cleanDoc, {
    patch: true,
    warnOnly: true,
    direct: true,
    anchors: true,
    // The normalizer consumes dereferenced values. Do not introduce shared
    // request-body references after the parser has resolved the input.
    resolveInternal: true,
  });

  // swagger2openapi merges required properties but omits body.required in
  // its schema-bearing form-field branch.
  for (const path of Object.values(result.paths ?? {})) {
    for (const operation of Object.values(path as Record<string, unknown>)) {
      if (!isRecord(operation) || !isRecord(operation.requestBody)) continue;
      const body = operation.requestBody;
      if (!isRecord(body.content)) continue;
      for (const type of ["application/x-www-form-urlencoded", "multipart/form-data"]) {
        const media = body.content[type];
        if (isRecord(media) && isRecord(media.schema) && Array.isArray(media.schema.required) && media.schema.required.length)
          body.required = true;
      }
    }
  }

  return {
    document: result as ParsedSpec["document"],
    source: parsed.source,
    publicDocument: parsed.publicDocument,
  };
}

/** Some Swagger producers attach a schema to each named form field. */
function preserveFormFieldSchemas(doc: Record<string, unknown>): void {
  const parameters: unknown[] = Object.values(isRecord(doc.parameters) ? doc.parameters : {});
  for (const path of Object.values(isRecord(doc.paths) ? doc.paths : {})) {
    if (!isRecord(path)) continue;
    if (Array.isArray(path.parameters)) parameters.push(...path.parameters);
    for (const operation of Object.values(path)) {
      if (isRecord(operation) && Array.isArray(operation.parameters)) parameters.push(...operation.parameters);
    }
  }
  for (const parameter of parameters) {
    if (!isRecord(parameter) || parameter.in !== "formData" || typeof parameter.name !== "string" || !isRecord(parameter.schema)) continue;
    parameter.schema = {
      type: "object",
      properties: { [parameter.name]: { ...parameter.schema, ...(typeof parameter.description === "string" ? { description: parameter.description } : {}) } },
      ...(parameter.required === true ? { required: [parameter.name] } : {}),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
