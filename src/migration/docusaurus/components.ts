/** Docusaurus theme components as native components, by module and export identity. */
import { attributeText, identityKey, rejectDynamic, tabSelectionReview, unsupportedAttributes, type ConverterTable } from "../components.js";
import { markdownText } from "../text-edits.js";
import { nativeCallout } from "./markdown.js";

const NATIVE_CALLOUTS: Record<string, string> = { note: "Note", tip: "Tip", info: "Info", warning: "Warning", danger: "Danger", caution: "Caution" };

export function docusaurusConverters(): ConverterTable {
  const table: ConverterTable = new Map();

  table.set(identityKey("@theme/Tabs", "default"), (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const extra = unsupportedAttributes(element, ["groupId", "queryString", "defaultValue", "className", "lazy"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent` };
    return { component: "Tabs", review: tabSelectionReview(element, ["groupId", "queryString", "defaultValue"]) };
  });

  // A tab without a label shows its value.
  table.set(identityKey("@theme/TabItem", "default"), (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const extra = unsupportedAttributes(element, ["value", "label", "default", "className"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent` };
    return {
      component: "Tab",
      props: { title: attributeText(element.props.label) ?? attributeText(element.props.value) ?? "" },
      review: tabSelectionReview(element, ["default"]),
    };
  });

  table.set(identityKey("@theme/Admonition", "default"), (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const extra = unsupportedAttributes(element, ["type", "title"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent` };
    const callout = nativeCallout(attributeText(element.props.type) ?? "note");
    const title = attributeText(element.props.title) ?? callout.title;
    return { component: NATIVE_CALLOUTS[callout.type], ...(title ? { props: { title } } : {}) };
  });

  // Written `<DocCardList items={useCurrentSidebarCategory().items} />` or bare: the pages of the category this page lands.
  table.set(identityKey("@theme/DocCardList", "default"), (element) => {
    const extra = unsupportedAttributes(element, ["items", "className"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent` };
    const section = element.section(element.route);
    if (!section) return { error: `<${element.name}> lists a category, and ${element.route} is not a category's own page` };
    return { component: "PageCards", props: { section } };
  });

  table.set(identityKey("@docusaurus/Link", "default"), (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const extra = unsupportedAttributes(element, ["to", "href"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent` };
    const href = attributeText(element.props.to) ?? attributeText(element.props.href);
    if (!href) return { error: `<${element.name}> has no destination` };
    return { markdown: `[${element.children.trim() || markdownText(href)}](${href})` };
  });

  return table;
}
