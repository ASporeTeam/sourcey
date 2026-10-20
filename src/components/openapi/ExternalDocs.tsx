import { useContext } from "preact/hooks";
import type { ExternalDocs } from "../../core/types.js";
import { SiteContext } from "../../renderer/context.js";
import { linkTarget, safeUrl } from "../../utils/html.js";

/** OpenAPI `externalDocs`: further reading the spec names for its API, a tag or an operation. */
export function ExternalDocsLink({ docs }: { docs?: ExternalDocs }) {
  const site = useContext(SiteContext);
  const href = docs ? safeUrl(docs.url) : null;
  if (!docs || !href) return null;
  return (
    <p class="reference-external-docs mb-6">
      <a href={href} {...linkTarget(href, site.siteUrl)}>
        {docs.description?.trim() || docs.url}
        <span aria-hidden="true"> →</span>
      </a>
    </p>
  );
}
