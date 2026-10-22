import type { ParsedSpec } from "./types.js";

/**
 * A parsed spec as OpenAPI 3: one the parser already converted, or an
 * OpenAPI 3.x document, as it is; a dereferenced Swagger 2.0 document passed
 * in directly is converted here.
 */
export async function convertToOpenApi3(parsed: ParsedSpec): Promise<ParsedSpec> {
  const doc = parsed.document;
  if (typeof doc.openapi === "string" && doc.openapi.startsWith("3.")) return parsed;
  const document = await convertSwagger(doc as Record<string, unknown>);
  return { document: document as ParsedSpec["document"], source: parsed.source, publicDocument: parsed.publicDocument };
}

/**
 * Convert a Swagger 2.0 document to OpenAPI 3.0 before its references are
 * resolved, as the converter is written to, so the types it shares stay
 * shared once they are: converting a dereferenced document copied each type
 * at every use, 0.2 MB of Kubernetes API into 25 MB.
 */
export async function convertSwagger(document: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { convertObj } = await import("swagger2openapi");
  // Converted as a copy: the converter rewrites what it reads, and an object
  // the source uses twice, such as one parameter list for two paths, must be
  // rewritten once for each.
  const text = JSON.stringify(document);
  const copy = JSON.parse(text) as Record<string, unknown>;
  preserveFormFieldSchemas(copy);
  const result = await convertObj(copy, {
    // The source text, kept only for validators' messages. Without it
    // swagger2openapi writes the whole document out as YAML first.
    text,
    patch: true,
    warnOnly: true,
    direct: true,
    anchors: true,
    // Each operation keeps its request body, as the form-field fix below
    // reads it, rather than one shared through components/requestBodies.
    // Schema references stay references either way.
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

  return result as Record<string, unknown>;
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
