import { describe, expect, it } from "vitest";
import { normalizeSpec } from "../../src/core/normalizer.js";
import { initialDraft } from "../../src/core/request.js";
import type { ConsoleData } from "../../src/core/try-it.js";
import { filterDraft } from "../../src/components/try-it/values.js";
import { restoreDraft, saveDraft, storedDraft } from "../../src/components/try-it/drafts.js";

function fixture() {
  const spec = normalizeSpec({
    source: "/tmp/privacy.json",
    document: {
      openapi: "3.1.0",
      info: { title: "Test", version: "1" },
      paths: {
        "/check": {
          post: {
            parameters: [
              {
                name: "pin",
                in: "query",
                schema: { allOf: [{ type: "string", writeOnly: true }] },
              },
              { name: "label", in: "query", schema: { type: "string" } },
            ],
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      {
                        type: "object",
                        properties: {
                          label: { type: "string" },
                          code: {
                            anyOf: [{ type: "string" }, { type: "string", format: "password" }],
                          },
                          nested: {
                            oneOf: [
                              { properties: { pin: { type: "string" } } },
                              { properties: { pin: { writeOnly: true } } },
                            ],
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
            responses: { "200": { description: "OK" } },
          },
        },
      },
    },
  });
  const data: ConsoleData = {
    operation: spec.operations[0],
    servers: spec.servers,
    securitySchemes: {},
    languages: ["curl"],
    credentials: "same-origin",
    specKey: "api",
    version: "1",
  };
  const draft = initialDraft(data.operation);
  draft.parameters = { "query:pin": "private-query", "query:label": "public" };
  draft.body = { label: "useful", code: "private-code", nested: { pin: "private-nested" } };
  draft.auth = { Key: { value: "private-auth" } };
  return { data, draft };
}

describe("Try-it privacy policy", () => {
  it("uses composed annotations consistently for storage, preview and clear", () => {
    const { data, draft } = fixture();
    const stored = storedDraft(data, draft);
    expect(JSON.stringify(stored)).not.toContain("private");
    expect(stored.parameters).toEqual({ "query:label": "public" });
    expect(stored.body).toEqual({ label: "useful" });
    const preview = filterDraft(draft, data, "preview");
    expect(JSON.stringify(preview)).not.toContain("private");
    expect(preview.parameters["query:pin"]).toBe("YOUR_VALUE");
    expect(preview.body).toEqual({
      label: "useful",
      code: "YOUR_VALUE",
      nested: { pin: "YOUR_VALUE" },
    });
    expect(filterDraft(draft, data, "clear").body).toEqual({ label: "useful", nested: {} });
    expect(draft.parameters["query:pin"]).toBe("private-query");
  });

  it("purges older unsafe cache bytes while restoring the safe fields", () => {
    const { data, draft } = fixture();
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    const safe = storedDraft(data, draft);
    values.set(
      "draft",
      JSON.stringify({ ...safe, parameters: draft.parameters, body: draft.body }),
    );
    const restored = restoreDraft(storage, "draft", data, initialDraft(data.operation));
    expect(restored?.parameters).toEqual({ "query:label": "public" });
    expect(JSON.stringify(restored)).not.toContain("private");
    expect(values.has("draft")).toBe(false);
    saveDraft(storage, "draft", data, draft);
    expect(values.get("draft")).not.toContain("private");
    expect(restoreDraft(storage, "draft", data, initialDraft(data.operation))?.body).toEqual({
      label: "useful",
    });
    expect(values.has("draft")).toBe(true);
  });
});
