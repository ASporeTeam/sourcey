import { useContext } from "preact/hooks";
import { PageContext, SpecContext } from "../../renderer/context.js";
import type { NormalizedSchema } from "../../core/types.js";
import { definitionAnchor, definitionFieldRoot } from "../../core/reference-identity.js";
import { SchemaView } from "../schema/SchemaView.js";
import { ExampleView } from "../schema/ExampleView.js";
import { AnchorAliases } from "../ui/AnchorAliases.js";

interface DefinitionProps {
  name: string;
  schema: NormalizedSchema;
}

/**
 * A schema's fields with its example, laid out as an operation is: the example
 * beside the fields where the column has room, after them where it has not. On
 * a page of its own it heads the page, as a standalone operation does.
 */
export function Definition({ name, schema }: DefinitionProps) {
  const id = definitionAnchor(name, useContext(SpecContext));
  const page = useContext(PageContext);
  const standalone = page.kind === "spec" && page.view?.kind === "schema";
  const Heading = standalone ? "h1" : "h2";

  return (
    <div id={id} class={`sourcey-definition ${standalone ? "pb-8" : "py-8 border-t border-[rgb(var(--color-gray-100))] dark:border-[rgb(var(--color-gray-800))]"}`} data-traverse-target={id}>
      <AnchorAliases target={id} />
      <AnchorAliases target={`/definitions/${name}`} />
      <a id={`/definitions/${name}`} />
      <header class={standalone ? "mb-6" : "mb-4"}>
        <div class="flex items-baseline gap-2">
          <Heading class={`${standalone ? "reference-page-title text-2xl sm:text-3xl tracking-tight" : "text-xl"} font-bold text-[rgb(var(--color-gray-900))] dark:text-[rgb(var(--color-gray-200))]`}>{name}</Heading>
          <span class="text-sm text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))] font-normal">{schema.type ?? "object"}</span>
        </div>
      </header>
      <div class="operation-layout">
        <div class="operation-details"><SchemaView schema={schema} anchorRoot={definitionFieldRoot(name)} /></div>
        <aside class="sourcey-operation-examples"><ExampleView schema={schema} title="Example" /></aside>
      </div>
    </div>
  );
}
