import { describe, expect, it } from "vitest";
import { parseShared, stringifyShared } from "../../src/core/shared-json.js";

describe("shared JSON", () => {
  it("writes an object used in many places once, and reads it back shared", () => {
    const type = { type: "object", properties: { name: { type: "string" } }, required: ["name"] };
    const value = { parameters: [{ schema: type }, { schema: type }], body: { items: type, list: [type, type] } };
    const text = stringifyShared(value);
    expect(text.match(/"properties"/g)).toHaveLength(1);
    const read = parseShared<typeof value>(text);
    expect(read).toEqual(value);
    expect(read.parameters[0].schema).toBe(read.body.items);
    expect(read.body.list[1]).toBe(read.parameters[1].schema);
  });

  it("keeps the data's own keys that start with $, as JSON does undefined and null", () => {
    const value = { properties: { $: { type: "string" }, $ref: "x", $$weird: 1, plain: null }, missing: undefined, list: [1, undefined, "a"] };
    expect(parseShared(stringifyShared(value))).toEqual(JSON.parse(JSON.stringify(value)));
  });

  it("reads back an object that reaches itself", () => {
    const node: Record<string, unknown> = { name: "tree" };
    node.children = [node];
    const read = parseShared<typeof node>(stringifyShared(node));
    expect((read.children as unknown[])[0]).toBe(read);
  });
});
