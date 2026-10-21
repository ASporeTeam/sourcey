import { describe, it, expect } from "vitest";
import { generateExample } from "../../src/utils/example-generator.js";
import type { NormalizedSchema } from "../../src/core/types.js";

describe("generateExample", () => {
  it("uses explicit example", () => {
    const schema: NormalizedSchema = { type: "string", example: "hello" };
    expect(generateExample(schema)).toBe("hello");
  });

  it("uses default value", () => {
    const schema: NormalizedSchema = { type: "integer", default: 42 };
    expect(generateExample(schema)).toBe(42);
  });

  it("uses first enum value", () => {
    const schema: NormalizedSchema = { type: "string", enum: ["a", "b", "c"] };
    expect(generateExample(schema)).toBe("a");
  });

  it("generates object example from properties", () => {
    const schema: NormalizedSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
    };
    const result = generateExample(schema) as Record<string, unknown>;
    expect(result).toHaveProperty("name", "string");
    expect(result).toHaveProperty("age", 0);
  });

  it("leaves read-only properties out of a request and write-only ones out of a response, at any depth", () => {
    const schema: NormalizedSchema = {
      type: "object",
      properties: {
        id: { type: "integer", readOnly: true },
        title: { type: "string" },
        password: { type: "string", writeOnly: true },
        owner: { type: "object", properties: { id: { type: "integer", readOnly: true }, name: { type: "string" } } },
      },
    };
    expect(generateExample(schema, "request")).toEqual({ title: "string", password: "string", owner: { name: "string" } });
    expect(generateExample(schema, "response")).toEqual({ id: 0, title: "string", owner: { id: 0, name: "string" } });
    expect(Object.keys(generateExample(schema) as object)).toEqual(["id", "title", "password", "owner"]);
  });

  it("generates array example from items", () => {
    const schema: NormalizedSchema = {
      type: "array",
      items: { type: "string" },
    };
    expect(generateExample(schema)).toEqual(["string"]);
  });

  it("handles format-specific strings", () => {
    expect(generateExample({ type: "string", format: "email" })).toBe(
      "user@example.com",
    );
    expect(generateExample({ type: "string", format: "date" })).toBe(
      "2024-01-15",
    );
    expect(generateExample({ type: "string", format: "uuid" })).toMatch(
      /^[0-9a-f-]+$/,
    );
  });

  it("handles boolean", () => {
    expect(generateExample({ type: "boolean" })).toBe(true);
  });

  it("handles null", () => {
    expect(generateExample({ type: "null" })).toBe(null);
  });

  it("never fills in a named type inside itself", () => {
    const node: NormalizedSchema = { name: "Node", type: "object", properties: { label: { type: "string" } } };
    node.properties!.child = node;
    node.properties!.children = { type: "array", items: node };
    expect(generateExample(node)).toEqual({ label: "string" });
    // A required property keeps its place, empty.
    expect(generateExample({ ...node, required: ["child", "children"] })).toEqual({ label: "string", child: {}, children: [] });
  });

  it("shows each named object type once in an example too long to read", () => {
    const leaf: NormalizedSchema = { refName: "Leaf", type: "object", properties: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}`, { type: "string" }])) };
    const branch: NormalizedSchema = { refName: "Branch", type: "object", properties: { first: leaf, second: leaf, third: leaf, fourth: leaf, fifth: leaf, sixth: leaf, seventh: leaf, eighth: leaf, ninth: leaf, tenth: leaf } };
    const example = generateExample({ type: "object", properties: { deep: { type: "object", properties: { branch } }, leaf } }) as { deep: { branch: unknown }; leaf: Record<string, string> };
    // Leaf is shown where it is shallowest; the branch's ten optional copies are left out.
    expect(Object.keys(example.leaf)).toHaveLength(40);
    expect(example.deep.branch).toEqual({});
    // A short example still shows every property.
    expect(generateExample({ type: "object", properties: { a: leaf, b: leaf } })).toEqual({ a: generateExample(leaf), b: generateExample(leaf) });
  });

  it("handles anyOf by picking first", () => {
    const schema: NormalizedSchema = {
      anyOf: [
        { type: "string" },
        { type: "integer" },
      ],
    };
    expect(generateExample(schema)).toBe("string");
  });

  it("handles oneOf by picking first", () => {
    const schema: NormalizedSchema = {
      oneOf: [
        { type: "integer", example: 5 },
        { type: "string" },
      ],
    };
    expect(generateExample(schema)).toBe(5);
  });

  it("merges allOf examples", () => {
    const schema: NormalizedSchema = {
      allOf: [
        { type: "object", properties: { id: { type: "integer" } } },
        { type: "object", properties: { name: { type: "string" } } },
      ],
    };
    const result = generateExample(schema) as Record<string, unknown>;
    expect(result).toEqual({ id: 0, name: "string" });
  });
});
