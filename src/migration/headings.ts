/**
 * A page titled by its opening heading. Some layouts print no title, and the
 * page opens with its one heading at that level (`## Getting started` above
 * `###` sections), styled as the title. Native titles a page with its `#`
 * heading, so the outline rises until that heading is one.
 */
import { parseDocument, walk, type Dialect, type SyntaxNode } from "./mdx.js";
import { applyEdits, readFrontmatter } from "./text-edits.js";

const ATX = /^ {0,3}#/;

/** The level of the heading that titles this page, when it opens with one and nothing else shares its level or above. */
export function titleHeadingLevel(source: string, tree: SyntaxNode): number | undefined {
  const opening = tree.children?.find((node) => node.type !== "mdxjsEsm" && !(node.type === "html" && /^\s*<!--/.test(node.value ?? "")));
  if (opening?.type !== "heading") return undefined;
  const headings = [...walk(tree)].map(({ node }) => node).filter((node) => node.type === "heading");
  // A setext heading's level is its underline; such a page keeps its outline.
  if (headings.some((node) => !ATX.test(source.slice(node.position!.start.offset)))) return undefined;
  return headings.filter((node) => node.depth! <= opening.depth!).length === 1 ? opening.depth : undefined;
}

/** Every heading `levels` higher, so the page's title heading is its `#` heading. */
export async function raiseHeadings(file: string, text: string, dialect: Dialect, levels: number): Promise<string> {
  const tree = await parseDocument(file, text, readFrontmatter(text).bodyStart, dialect);
  const edits = [...walk(tree)]
    .map(({ node }) => node)
    .filter((node) => node.type === "heading" && node.depth! > levels && ATX.test(text.slice(node.position!.start.offset)))
    .map((node) => {
      const start = text.indexOf("#", node.position!.start.offset);
      return { start, end: start + levels, text: "" };
    });
  return applyEdits(text, edits);
}
