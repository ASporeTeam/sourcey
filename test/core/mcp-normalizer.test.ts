import { describe, expect, it } from "vitest";
import { normalizeMcpSpec } from "../../src/core/mcp-normalizer.js";
import type { McpSpec } from "mcp-parser";

describe("normalizeMcpSpec", () => {
  it("renders nested tool inputs as a body instead of duplicate parameters", () => {
    const spec = normalizeMcpSpec(
      createSpec({
        tools: [
          {
            name: "search_contacts",
            description: "Search contacts.",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string", description: "Search term" },
                filters: {
                  type: "object",
                  properties: {
                    country: { type: "string" },
                  },
                },
              },
              required: ["query"],
            },
          },
        ],
      }),
    );

    const op = spec.operations[0];
    expect(op.parameters).toEqual([]);
    expect(op.requestBody?.content["application/json"].schema?.properties?.query).toBeDefined();
    expect(op.requestBody?.content["application/json"].schema?.properties?.filters).toBeDefined();
  });

  it("keeps client configuration and callable JSON-RPC and SDK examples aligned with the snapshot", () => {
    const spec = normalizeMcpSpec(createSpec({
      transport: { type: "stdio", command: "npx", args: ["--yes", "fixture-server"], env: { API_URL: "https://example.test", API_KEY: "your-api-key" } },
      tools: [{ name: "translate", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], examples: [{ text: "Hello" }] } }],
    }));
    const tool = spec.operations[0];
    expect(tool.mcpExtras?.connection?.transport?.env).toEqual({ API_URL: "https://example.test", API_KEY: "your-api-key" });
    const rpc = JSON.parse(tool.codeSamples!.find(sample => sample.label === "JSON-RPC")!.source);
    expect(rpc).toMatchObject({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "translate", arguments: { text: "Hello" } } });
    const typescript = tool.codeSamples!.find(sample => sample.lang === "typescript")!.source;
    const params = JSON.parse(typescript.slice(typescript.indexOf("(") + 1, typescript.lastIndexOf(")")));
    expect(params).toEqual(rpc.params);
  });

  it("keeps an HTTP transport's header placeholders for the client configuration", () => {
    const transport = { type: "streamable-http", url: "https://tasks.example/api/v2/mcp", headers: { Authorization: "Bearer YOUR_TOKEN", Retries: 3 } };
    const spec = normalizeMcpSpec(createSpec({ transport: transport as never, tools: [{ name: "tasks_list", inputSchema: { type: "object" } }] }));
    expect(spec.operations[0].mcpExtras?.connection?.transport).toEqual({ type: "streamable-http", url: transport.url, headers: { Authorization: "Bearer YOUR_TOKEN" } });
  });

  it("renders flat tool inputs as parameters", () => {
    const spec = normalizeMcpSpec(
      createSpec({
        tools: [
          {
            name: "get_contact",
            inputSchema: {
              type: "object",
              properties: {
                email: { type: "string" },
              },
              required: ["email"],
            },
          },
        ],
      }),
    );

    const op = spec.operations[0];
    expect(op.parameters.map((param) => param.name)).toEqual(["email"]);
    expect(op.requestBody).toBeUndefined();
  });
});

function createSpec(overrides: Partial<McpSpec>): McpSpec {
  return {
    mcpSpec: "0.2.0",
    mcpVersion: "2025-11-25",
    server: { name: "test", version: "1.0.0" },
    tools: [],
    resources: [],
    resourceTemplates: [],
    prompts: [],
    ...overrides,
  } as unknown as McpSpec;
}
