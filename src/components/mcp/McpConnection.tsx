/**
 * Connection config card for MCP docs.
 * Rendered below Introduction in SpecPageContent.
 * Uses the same bordered card pattern as Introduction's Base URLs table.
 */

import type { McpConnectionInfo } from "../../core/types.js";
import { Markdown } from "../ui/Markdown.js";

export function McpConnection({ connection }: { connection: McpConnectionInfo }) {
  const transport = connection.transport;
  if (!transport) return null;

  // Build the config JSON snippet
  const serverEntry: Record<string, unknown> = {};
  if (transport.type === "stdio") {
    if (transport.command) serverEntry.command = transport.command;
    if (transport.args?.length) serverEntry.args = transport.args;
    if (transport.env && Object.keys(transport.env).length) serverEntry.env = transport.env;
  } else {
    if (transport.url) serverEntry.url = transport.url;
    if (transport.headers) serverEntry.headers = transport.headers;
  }

  const configJson = JSON.stringify(
    { mcpServers: { [connection.serverName]: serverEntry } },
    null,
    2,
  );

  // Capabilities summary
  const caps: string[] = [];
  if (connection.capabilities) {
    if (connection.capabilities.tools) caps.push("tools");
    if (connection.capabilities.resources) caps.push("resources");
    if (connection.capabilities.prompts) caps.push("prompts");
    if (connection.capabilities.logging) caps.push("logging");
  }

  return (
    <section class="sourcey-mcp-connection min-w-0 mb-8">
        <h2 class="mb-3 text-base font-semibold text-[rgb(var(--color-gray-900))] dark:text-[rgb(var(--color-gray-200))]">Connect your client</h2>
        <p class="text-sm text-[rgb(var(--color-gray-600))] dark:text-[rgb(var(--color-gray-400))] mb-4">
          Add to your MCP client configuration:
        </p>
        <Markdown content={`\`\`\`json\n${configJson}\n\`\`\``} />
        <div class="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]">
          {connection.mcpVersion && (
            <span>Protocol <span class="font-medium text-[rgb(var(--color-gray-700))] dark:text-[rgb(var(--color-gray-300))]">MCP {connection.mcpVersion}</span></span>
          )}
          <span>Transport <span class="font-medium text-[rgb(var(--color-gray-700))] dark:text-[rgb(var(--color-gray-300))]">{transport.type}</span></span>
          {caps.length > 0 && (
            <span>Capabilities <span class="font-medium text-[rgb(var(--color-gray-700))] dark:text-[rgb(var(--color-gray-300))]">{caps.join(", ")}</span></span>
          )}
        </div>
    </section>
  );
}
