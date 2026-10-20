import { describe, expect, it } from "vitest";
import {
  effectiveSchema,
  propertySchema,
  schemaHas,
  validateValue,
  formatSchemaType,
} from "../../src/core/schema.js";

describe("normalized request schema semantics", () => {
  it("summarizes repeated branch type names while retaining all distinct types and branch constraints", () => {
    const alternatives = Array.from({ length: 33 }, (_, index) => ({ type: "object", properties: { action: { const: `action-${index}` } } }));
    expect(formatSchemaType({ type: "array", items: { oneOf: alternatives } })).toBe("Array<object>");
    expect(formatSchemaType({ anyOf: [{ type: "string" }, { type: "number" }, { type: "string" }, { type: "null" }] })).toBe("string | number | null");
    expect(formatSchemaType({ allOf: [{ type: "object" }, { type: "object" }] })).toBe("object");
    expect(alternatives).toHaveLength(33);
    expect(alternatives[32].properties.action.const).toBe("action-32");
  });

  it("enforces parent constraints alongside every allOf branch", () => {
    const schema = { type: "string", minLength: 5, allOf: [{ type: "string", pattern: "^a" }] };
    expect(validateValue(schema, "a", "body")).toContainEqual({
      field: "body",
      message: "Use at least 5 characters.",
    });
    expect(validateValue(schema, "bcdef", "body")).toHaveLength(1);
    expect(validateValue(schema, "abcde", "body")).toEqual([]);
  });

  it("retains parent constraints and checks both anyOf and oneOf", () => {
    const schema = {
      minLength: 3,
      anyOf: [{ type: "string" }, { type: "number" }],
      oneOf: [{ type: "string" }, { const: "x" }],
    };
    expect(validateValue(schema, "x", "value")).toHaveLength(2);
    expect(validateValue(schema, "valid", "value")).toEqual([]);
    expect(validateValue({ not: { enum: ["reserved"] } }, "reserved", "value")).toHaveLength(1);
  });

  it("validates additional fields without flattening closed allOf branches", () => {
    expect(
      validateValue(
        { type: "object", properties: { name: { type: "string" } }, additionalProperties: false },
        { name: "ok", extra: true },
        "body",
      ),
    ).toEqual([{ field: "body.extra", message: "This field is not allowed." }]);
    expect(
      validateValue({ additionalProperties: { type: "integer" } }, { count: 1.5 }, "body")[0].field,
    ).toBe("body.count");
    const closed = {
      allOf: [
        { properties: { a: { type: "string" } }, additionalProperties: false },
        { properties: { b: { type: "string" } } },
      ],
    };
    expect(validateValue(closed, { a: "a", b: "b" }, "body")[0].field).toBe("body.b");
  });

  it("handles nullable alternatives and applies type-specific constraints conditionally", () => {
    expect(
      validateValue({ anyOf: [{ type: "null" }, { type: "string", minLength: 2 }] }, null, "value"),
    ).toEqual([]);
    expect(validateValue({ type: "string", nullable: true }, null, "value")).toEqual([]);
    expect(validateValue({ type: "string" }, null, "value")).not.toEqual([]);
    expect(validateValue({ minimum: 3 }, null, "value")).toEqual([]);
    expect(validateValue({ type: ["string", "number"], minimum: 3 }, 2, "value")).toHaveLength(1);
  });

  it("checks numeric multiples, semantic uniqueness and Unicode character counts", () => {
    expect(validateValue({ type: "number", multipleOf: 0.1 }, 0.3, "n")).toEqual([]);
    expect(validateValue({ type: "number", multipleOf: 0.1 }, 0.35, "n")).toHaveLength(1);
    expect(
      validateValue(
        { uniqueItems: true },
        [
          { a: 1, b: 2 },
          { b: 2, a: 1 },
        ],
        "list",
      ),
    ).toHaveLength(1);
    expect(validateValue({ enum: [{ a: 1, b: 2 }] }, { b: 2, a: 1 }, "value")).toEqual([]);
    expect(validateValue({ type: "string", maxLength: 1 }, "🧀", "value")).toEqual([]);
  });

  it("shares composed annotations while leaving validation on the original schema", () => {
    const schema = {
      type: "object",
      properties: { pin: { type: "string" } },
      allOf: [
        { properties: { pin: { allOf: [{ writeOnly: true }] }, generated: { readOnly: true } } },
      ],
      required: ["generated"],
    };
    expect(schemaHas(propertySchema(schema, "pin"), (part) => part.writeOnly === true)).toBe(true);
    expect(
      schemaHas(effectiveSchema(schema).properties?.pin, (part) => part.writeOnly === true),
    ).toBe(true);
    expect(validateValue(schema, { pin: "private" }, "body")).toEqual([]);
  });
});
