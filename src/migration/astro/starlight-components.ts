/** Starlight's components as native components, by module and export identity. */
import { attributeText, identityKey, rejectDynamic, tabSelectionReview, unsupportedAttributes, type ConversionFailure, type ConverterTable, type ElementInput } from "../components.js";
import { markdownText } from "../text-edits.js";

const STARLIGHT = "@astrojs/starlight/components";

/** Starlight icon names with a matching native (Heroicons outline) icon. */
const STARLIGHT_ICONS: Record<string, string> = {
  rocket: "rocket-launch",
  star: "star",
  pencil: "pencil",
  document: "document",
  "open-book": "book-open",
  setting: "cog-6-tooth",
  puzzle: "puzzle-piece",
  information: "information-circle",
  warning: "exclamation-triangle",
  "approve-check": "check-badge",
  "approve-check-circle": "check-circle",
  "external": "arrow-top-right-on-square",
  "right-arrow": "arrow-right",
  "left-arrow": "arrow-left",
  "up-arrow": "arrow-up",
  "down-arrow": "arrow-down",
  magnifier: "magnifying-glass",
  laptop: "computer-desktop",
  "list-format": "list-bullet",
  error: "x-circle",
  "add-document": "document-plus",
  download: "arrow-down-tray",
  seti: "code-bracket",
};

function icon(element: ElementInput): { icon?: string } | ConversionFailure {
  const value = attributeText(element.props.icon);
  if (value === undefined) return {};
  const native = STARLIGHT_ICONS[value];
  if (!native)
    return {
      error: `<${element.name}> icon "${value}" has no native equivalent`,
      suggestion: "Choose a Heroicons outline name (https://heroicons.com) for it in the --mapping file.",
    };
  return { icon: native };
}

const CALLOUTS: Record<string, string> = { note: "Note", tip: "Tip", caution: "Caution", danger: "Danger" };

/** Starlight's components, by their export from `@astrojs/starlight/components`. */
export function starlightConverters(): ConverterTable {
  const table: ConverterTable = new Map();

  table.set(identityKey(STARLIGHT, "Aside"), (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const type = attributeText(element.props.type) ?? "note";
    const component = CALLOUTS[type];
    if (!component) return { error: `<${element.name}> type "${type}" is not a Starlight aside type` };
    const extra = unsupportedAttributes(element, ["type", "title", "icon"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent` };
    if (element.props.icon !== undefined)
      return { error: `<${element.name}> custom aside icons have no native equivalent`, suggestion: "Remove the icon or map the element." };
    const title = attributeText(element.props.title);
    return { component, ...(title ? { props: { title } } : {}) };
  });

  table.set(identityKey(STARLIGHT, "Card"), (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const extra = unsupportedAttributes(element, ["title", "icon"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent` };
    const mapped = icon(element);
    if ("error" in mapped) return mapped;
    return { component: "Card", props: { title: attributeText(element.props.title) ?? "", ...mapped } };
  });

  table.set(identityKey(STARLIGHT, "CardGrid"), (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const extra = unsupportedAttributes(element, ["stagger"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent` };
    return {
      component: "CardGroup",
      props: { cols: 2 },
      review: element.props.stagger ? "The staggered card offset is presentation only; native card groups align their rows." : undefined,
    };
  });

  table.set(identityKey(STARLIGHT, "LinkCard"), (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const extra = unsupportedAttributes(element, ["title", "href", "description", "target", "rel"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent` };
    const href = attributeText(element.props.href);
    if (!href) return { error: `<${element.name}> has no href` };
    const description = attributeText(element.props.description);
    const opens = attributeText(element.props.target);
    return {
      component: "Card",
      props: { title: attributeText(element.props.title) ?? "", href },
      children: description === undefined ? "" : markdownText(description),
      review:
        opens || element.props.rel
          ? `The card's ${["target", "rel"].filter((name) => element.props[name] !== undefined).join(" and ")} attribute is not carried over; native cards link in the same tab.`
          : undefined,
    };
  });

  table.set(identityKey(STARLIGHT, "Tabs"), (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const extra = unsupportedAttributes(element, ["syncKey"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent` };
    return { component: "Tabs", review: tabSelectionReview(element, ["syncKey"]) };
  });

  table.set(identityKey(STARLIGHT, "TabItem"), (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const extra = unsupportedAttributes(element, ["label", "icon"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent` };
    if (element.props.icon !== undefined)
      return { error: `<${element.name}> tab icons have no native equivalent`, suggestion: "Remove the icon or map the element." };
    return { component: "Tab", props: { title: attributeText(element.props.label) ?? "" } };
  });

  table.set(identityKey(STARLIGHT, "Badge"), (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const extra = unsupportedAttributes(element, ["text", "variant", "size"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent` };
    return {
      component: "Badge",
      props: { text: attributeText(element.props.text) ?? "" },
      review: element.props.variant !== undefined || element.props.size !== undefined ? "The badge's variant and size are not carried over; native badges share one style." : undefined,
    };
  });

  // A FileTree holds a Markdown list, which the native FileTree reads as written.
  table.set(identityKey(STARLIGHT, "FileTree"), (element) => rejectDynamic(element) ?? { component: "FileTree" });

  for (const name of ["Steps", "Icon", "Code", "LinkButton"]) {
    table.set(identityKey(STARLIGHT, name), (element) => ({
      error: `<${element.name}> has no native conversion yet`,
      suggestion: "Convert it in the --mapping file's components.",
    }));
  }

  return table;
}
