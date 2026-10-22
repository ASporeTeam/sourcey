import { describe, it, expect } from "vitest";
import { loadSpec } from "../../src/core/loader.js";
import { parseSourceSpec, parseSpec } from "../../src/core/parser.js";
import { convertToOpenApi3 } from "../../src/core/converter.js";
import { resolve } from "node:path";
import { normalizeSpec } from "../../src/core/normalizer.js";
import { generateCodeSamples } from "../../src/utils/code-samples.js";

const FIXTURES = resolve(import.meta.dirname, "../fixtures");

describe("convertToOpenApi3", () => {
  it("preserves named form schemas, examples and reused bodies through normalization and executable samples", async () => {
    const parameters = [
      { in: "formData", name: "q", required: true, description: "Text(s) to translate", schema: { oneOf: [{ type: "string", example: "Hello world!" }, { type: "array", items: { type: "string" } }] } },
      { in: "formData", name: "target", required: true, schema: { type: "string", example: "es" } },
      { in: "formData", name: "format", schema: { type: "string", enum: ["text", "html"], default: "text" } },
    ];
    const raw = { swagger: "2.0", produces: ["application/json"], info: { title: "Form API", version: "fixture" }, paths: Object.fromEntries(["/translate", "/detect"].map(path => [path, { post: { parameters, responses: { "200": { description: "Translation", schema: { $ref: "#/definitions/Translation" } } } } }])), definitions: { Translation: { type: "object", properties: { translatedText: { type: "string", example: "¡Hola!" } } } } };
    const parsed = await parseSpec({ raw, format: "json", version: "swagger-2.0", source: "https://api.example.test/spec" });
    const converted = await convertToOpenApi3(parsed);
    const spec = normalizeSpec(converted);
    expect(raw.paths["/translate"].post.parameters).toEqual(parameters);
    for (const operation of spec.operations) {
      expect(operation.requestBody).toMatchObject({ required: true, content: { "application/x-www-form-urlencoded": { schema: { required: ["q", "target"], properties: { q: { description: "Text(s) to translate", oneOf: [{ type: "string", example: "Hello world!" }, { type: "array" }] }, target: { example: "es" }, format: { enum: ["text", "html"], default: "text" } } } } } });
      expect(operation.responses[0].content?.["application/json"].schema?.properties?.translatedText.example).toBe("¡Hola!");
      const [sample] = generateCodeSamples(operation, [{ url: "https://api.example.test" }], ["javascript"]);
      let sent: RequestInit | undefined;
      await new Function("fetch", `return (async () => { ${sample.source} })();`)(async (_url: string, options: RequestInit) => { sent = options; return new Response("{}"); });
      expect(new URLSearchParams(sent?.body as string).get("q")).toBe("Hello world!");
      expect(new URLSearchParams(sent?.body as string).get("target")).toBe("es");
    }
  });

  it("converts Swagger 2.0 before resolving references, so a type the document shares stays one object", async () => {
    const raw = {
      swagger: "2.0", info: { title: "Shared", version: "1" },
      paths: Object.fromEntries(["/a", "/b"].map(path => [path, { get: { responses: { "200": { description: "OK", schema: { $ref: "#/definitions/Owner" } } } } }])),
      definitions: { Owner: { type: "object", properties: { name: { type: "string" } } } },
    };
    const loaded = { raw, format: "json" as const, version: "swagger-2.0" as const, source: "https://api.example.test/spec" };
    const parsed = await parseSpec(loaded);
    expect(parsed.document.openapi).toMatch(/^3\./);
    const schema = (path: string) => (parsed.document.paths as Record<string, { get: { responses: Record<string, { content: Record<string, { schema: unknown }> }> } }>)[path].get.responses["200"].content["*/*"].schema;
    expect(schema("/a")).toBe(schema("/b"));
    const spec = normalizeSpec(parsed);
    expect(spec.operations[0].responses[0].content!["*/*"].schema).toBe(spec.operations[1].responses[0].content!["*/*"].schema);
    // A reference generator's own view: the document in its own version.
    expect((await parseSourceSpec(loaded)).document.swagger).toBe("2.0");
  });

  it("converts a Swagger 2.0 spec to OpenAPI 3.0", async () => {
    const loaded = await loadSpec(`${FIXTURES}/petstore-expanded.yml`);
    const parsed = await parseSpec(loaded);
    const result = await convertToOpenApi3(parsed);

    expect(result.document.openapi).toMatch(/^3\./);
    expect(result.document.info).toBeDefined();
    expect(result.document.paths).toBeDefined();
  });

  it("passes through an OpenAPI 3.0 spec unchanged", async () => {
    const loaded = await loadSpec(`${FIXTURES}/petstore-openapi3.yaml`);
    const parsed = await parseSpec(loaded);
    const result = await convertToOpenApi3(parsed);

    expect(result.document.openapi).toBe("3.0.3");
    expect(result).toBe(parsed); // Same reference, no conversion
  });

  it("preserves API info during conversion", async () => {
    const loaded = await loadSpec(`${FIXTURES}/cheese.yml`);
    const parsed = await parseSpec(loaded);
    const result = await convertToOpenApi3(parsed);

    const info = result.document.info as Record<string, unknown>;
    expect(info.title).toBe("Cheese Store");
  });

  it("converts paths and operations", async () => {
    const loaded = await loadSpec(`${FIXTURES}/cheese.yml`);
    const parsed = await parseSpec(loaded);
    const result = await convertToOpenApi3(parsed);

    expect(result.document.paths).toBeDefined();
    const paths = Object.keys(result.document.paths!);
    expect(paths.length).toBeGreaterThan(0);
  });
});
