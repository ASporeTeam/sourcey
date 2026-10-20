/**
 * Docusaurus Markdown: the text rewrites its MDX loader applies before
 * parsing (`preprocessContent` in @docusaurus/mdx-loader 3), and its
 * admonition keywords as the native callouts they render as.
 */
import { parseMarkdown, walk } from "../mdx.js";
import { applyEdits, type TextEdit } from "../text-edits.js";

/** Docusaurus's default admonition keywords; `admonitions.keywords` extends them. */
export const DEFAULT_ADMONITIONS = ["secondary", "info", "success", "danger", "note", "tip", "warning", "important", "caution"];

/**
 * The native callout each keyword renders as. The theme's legacy aliases show
 * their own name as the title; a keyword the theme does not know falls back to info.
 */
const CALLOUTS: Record<string, { type: string; title?: string }> = {
  note: { type: "note" },
  tip: { type: "tip" },
  info: { type: "info" },
  warning: { type: "warning" },
  danger: { type: "danger" },
  caution: { type: "caution" },
  secondary: { type: "note", title: "Secondary" },
  important: { type: "info", title: "Important" },
  success: { type: "tip", title: "Success" },
};

export function nativeCallout(keyword: string): { type: string; title?: string } {
  return CALLOUTS[keyword] ?? { type: "info" };
}

/** ` ```mdx-code-block ` fences hold live MDX, which Docusaurus unwraps before parsing. */
export function unwrapMdxCodeBlocks(content: string): string {
  const replacer = (...args: unknown[]) => {
    const groups = args.at(-1) as Record<string, string>;
    return `${groups.begin}${groups.children}${groups.end}`;
  };
  return content
    .replaceAll(/(?<begin>^|\r?\n)(?<indentStart>\x20*)```(?<spaces>\x20*)mdx-code-block\r?\n(?<children>.*?)\r?\n(?<indentEnd>\x20*)```(?<end>\r?\n|$)/gs, replacer)
    .replaceAll(/(?<begin>^|\r?\n)(?<indentStart>\x20*)````(?<spaces>\x20*)mdx-code-block\r?\n(?<children>.*?)\r?\n(?<indentEnd>\x20*)````(?<end>\r?\n|$)/gs, replacer);
}

/** The legacy `:::note Title` form as a directive label, `:::note[Title]`, everywhere Docusaurus rewrites it (code included). */
function admonitionLabels(content: string, keywords: readonly string[]): string {
  const pattern = new RegExp(`^(?<quote>(> ?)*)(?<indentation>( +|\\t+))?(?<directive>:{3,}(${keywords.join("|")})) +(?<title>.*)$`, "gm");
  return content.replaceAll(pattern, (...args: unknown[]) => {
    const groups = args.at(-1) as Record<string, string | undefined>;
    return `${groups.quote ?? ""}${groups.indentation ?? ""}${groups.directive}[${groups.title}]`;
  });
}

/** How Docusaurus reads a document's text before parsing it. */
export function docusaurusPreprocess(keywords: readonly string[]): (source: string) => string {
  return (source) => admonitionLabels(unwrapMdxCodeBlocks(source), keywords);
}

/**
 * Admonitions as native callouts: the label form, then each keyword native
 * Markdown does not read renamed to the callout it rendered as, titled as it was.
 */
export async function nativeAdmonitions(text: string, keywords: readonly string[]): Promise<string> {
  const labelled = admonitionLabels(text, keywords);
  const edits: TextEdit[] = [];
  for (const { node } of walk(await parseMarkdown(labelled, 0, { directives: true }))) {
    if (node.type !== "containerDirective" || !node.name || !keywords.includes(node.name) || !node.position) continue;
    const callout = nativeCallout(node.name);
    if (callout.type === node.name) continue;
    const start = labelled.indexOf(node.name, node.position.start.offset);
    const label = node.children?.[0]?.data?.directiveLabel;
    edits.push({ start, end: start + node.name.length, text: `${callout.type}${!label && callout.title ? `[${callout.title}]` : ""}` });
  }
  return applyEdits(labelled, edits);
}
