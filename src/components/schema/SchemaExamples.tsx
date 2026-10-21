import { useContext } from "preact/hooks";
import type { NormalizedSchema } from "../../core/types.js";
import { OptionsContext } from "../../renderer/context.js";
import { CopyButton } from "../ui/CopyButton.js";

/** Authored field examples remain visible beside their schema, including false/null/zero. */
export function SchemaExamples({ schema }: { schema: NormalizedSchema }) {
  const messages = useContext(OptionsContext).messages;
  const values = schema.example !== undefined ? [schema.example] : schema.examples ?? [];
  return <>{values.map((value, index) => <div key={index} class="code-group schema-example">
    <span class="schema-example-label">{messages?.example ?? "Example"}</span>
    {/* A long example scrolls, so a keyboard can reach it to scroll. */}
    <pre tabIndex={0}><code>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</code></pre>
    <CopyButton />
  </div>)}</>;
}
