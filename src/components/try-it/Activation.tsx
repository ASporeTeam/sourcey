import { useContext } from "preact/hooks";
import { OptionsContext, PageContext, SiteContext } from "../../renderer/context.js";
import type { NormalizedOperation } from "../../core/types.js";
import { consoleArtifactPath } from "../../renderer/try-it.js";
import { createContext, type ComponentChildren } from "preact";

export const ConsoleIdentity = createContext("");

export function TryItButton({ operation }: { operation: NormalizedOperation }) {
  const page = useContext(PageContext);
  const site = useContext(SiteContext);
  const options = useContext(OptionsContext);
  const id = useContext(ConsoleIdentity);
  if (operation.mcpExtras || page.kind !== "spec" || (page.tryIt ?? site.tryIt) === false)
    return null;
  return (
    <button
      type="button"
      class="sourcey-button sourcey-button-quiet tryit-trigger"
      hidden
      data-try-it-trigger
      data-try-it-data={options.assetBase + consoleArtifactPath(page.specKey ?? "api", operation)}
      data-try-it-module={options.assets?.tryIt}
      aria-expanded="false"
      aria-controls={id}
    >
      Try it
    </button>
  );
}

export function ConsoleExamples({
  operation,
  children,
}: {
  operation: NormalizedOperation;
  children: ComponentChildren;
}) {
  const page = useContext(PageContext);
  const site = useContext(SiteContext);
  const id = useContext(ConsoleIdentity);
  if (operation.mcpExtras || page.kind !== "spec" || (page.tryIt ?? site.tryIt) === false)
    return <>{children}</>;
  return (
    <>
      <div data-try-it-examples class="tryit-examples">
        {children}
      </div>
      <div id={id} data-try-it-mount hidden />
    </>
  );
}
