import { useContext } from "preact/hooks";
import type { PageHeading } from "../../core/markdown-loader.js";
import type { NormalizedTag } from "../../core/types.js";
import { english } from "../../core/messages.js";
import { walkNavGroups } from "../../core/navigation.js";
import { operationSectionAnchor, operationSections, referenceOperation, tagAnchor } from "../../core/reference-identity.js";
import { tagDisplayName, tagLineage } from "../../core/tag-utils.js";
import { extractHeadings } from "../../utils/markdown.js";
import { NavigationContext, OptionsContext, PageContext, SpecContext } from "../../renderer/context.js";

/** The heading over each section of an operation. */
export const SECTION_LABELS: Record<ReturnType<typeof operationSections>[number], string> = {
  "request-body": "Body",
  parameters: "Parameters",
  returns: "Returns",
  responses: "Response",
  authentication: "Authorization",
};

/** A tag's name as the reference shows it: authored navigation can rename it. */
export function useTagLabel(): (tag: NormalizedTag) => string {
  const spec = useContext(SpecContext);
  const nav = useContext(NavigationContext);
  const labels = new Map([...walkNavGroups(nav.tabs.find((tab) => tab.slug === nav.activeTabSlug)?.groups ?? [])].map((group) => [group.id, group.label]));
  return (tag) => labels.get(tagAnchor(tag.name, spec)) || tagDisplayName(tag);
}

/**
 * What a page of a split reference lists under "On this page": an operation's
 * sections, or the overview's own headings, authentication, tags and models.
 * The reference on one page leaves that to its sidebar.
 */
export function useReferenceOutline(): PageHeading[] {
  const page = useContext(PageContext);
  const spec = useContext(SpecContext);
  const { messages = english } = useContext(OptionsContext);
  const tagLabel = useTagLabel();
  if (page.kind !== "spec" || !page.view || page.view.kind === "schema") return [];
  if (page.view.kind === "operation") {
    const operation = referenceOperation(spec, page.view.id);
    return operationSections(operation).map((section) => ({ level: 2, text: SECTION_LABELS[section], id: operationSectionAnchor(operation, spec, section, true) }));
  }
  const section = (text: string, id: string, level: PageHeading["level"] = 2): PageHeading => ({ level, text, id });
  // A child tag the page shows within its family, after its top tag, sits beneath that tag.
  const tags = spec.tags.filter((tag) => !tag.hidden);
  const byName = new Map(spec.tags.map((tag) => [tag.name, tag]));
  const family = (tag: NormalizedTag) => (tagLineage(tag, byName)[0] ?? tag).name;
  const nested = (tag: NormalizedTag, index: number) => !!tag.parent && index > 0 && family(tags[index - 1]) === family(tag);
  return [
    ...extractHeadings(spec.info.description ?? ""),
    ...(Object.keys(spec.securitySchemes).length ? [section(messages.authentication, "authentication")] : []),
    ...tags.map((tag, index) => section(tagLabel(tag), tagAnchor(tag.name, spec), nested(tag, index) ? 3 : 2)),
    ...(Object.keys(spec.schemas).length ? [section(messages.models, "models")] : []),
  ];
}
