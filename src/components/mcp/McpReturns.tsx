/**
 * MCP Returns section — replaces Responses for MCP operations.
 * Renders output schema as a schema view instead of status code tables.
 */

import type { NormalizedSchema } from "../../core/types.js";
import { SchemaView } from "../schema/SchemaView.js";
import { ExampleView } from "../schema/ExampleView.js";
import { SectionLabel } from "../ui/SectionLabel.js";
import { AnchorAliases } from "../ui/AnchorAliases.js";
import { SECTION_LABELS } from "../openapi/outline.js";

/**
 * Render only the output contract the server actually declares.
 */
export function McpReturnsCopy({ schema, id, anchorRoot }: { schema?: NormalizedSchema; id?: string; anchorRoot?: string }) {
  if (!schema) return null;

  return (
    <div class="mt-6" id={id}>
      {id && <AnchorAliases target={id} />}
      <SectionLabel>{SECTION_LABELS.returns}</SectionLabel>
      <SchemaView schema={schema} anchorRoot={anchorRoot} usage="response" />
    </div>
  );
}

/**
 * Right column (sticky panel): example JSON for the output schema.
 */
export function McpReturnsExample({ schema }: { schema?: NormalizedSchema }) {
  if (!schema) return null;

  return <ExampleView schema={schema} title="Response" />;
}
