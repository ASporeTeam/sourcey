import { useContext } from "preact/hooks";
import { PageContext, isOperationPage } from "../../renderer/context.js";

interface SectionLabelProps {
  children: preact.ComponentChildren;
  meta?: preact.ComponentChildren;
}

/**
 * Section heading with bottom border and optional right-aligned metadata.
 * Used for "Body", "Parameters", "Response" sections. It sits one level below
 * its operation's title: the page's h1 on an operation's own page, an h2 in a
 * reference listing many.
 */
export function SectionLabel({ children, meta }: SectionLabelProps) {
  const Heading = isOperationPage(useContext(PageContext)) ? "h2" : "h3";
  return (
    <div class="flex items-baseline border-b pb-2.5 border-[rgb(var(--color-gray-100))] dark:border-[rgb(var(--color-gray-800))] w-full mb-4">
      <Heading class="flex-1 mb-0 text-sm font-semibold text-[rgb(var(--color-gray-900))] dark:text-[rgb(var(--color-gray-200))]">{children}</Heading>
      {meta && (
        <div class="flex items-center gap-2 text-xs font-medium font-mono text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]">
          {meta}
        </div>
      )}
    </div>
  );
}
