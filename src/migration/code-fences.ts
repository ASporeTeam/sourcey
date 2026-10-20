/**
 * Code fence info strings in the native vocabulary. Native reads a language,
 * `title="..."` and line sets (`{1,3}`, `highlight=`, `focus=`, `add=`,
 * `remove=`) and rejects anything else; source frameworks spell the same ideas
 * differently. The engine's own parser decides what is native.
 */
import { parseCodeFenceInfo } from "../utils/markdown.js";
import { parseDocument, walk } from "./mdx.js";
import type { SourceDialect } from "./plan.js";
import { applyEdits, lineEnd, type TextEdit } from "./text-edits.js";

/** Source spellings of native line-set annotations: Expressive Code's ins/del/mark, Python-Markdown's hl_lines. */
const ANNOTATIONS: [RegExp, (match: RegExpMatchArray) => string][] = [
  [/^(?:ins|add)=\{([^}]+)\}/, (match) => `add={${match[1]}}`],
  [/^(?:del|remove)=\{([^}]+)\}/, (match) => `remove={${match[1]}}`],
  [/^(?:mark|highlight)=\{([^}]+)\}/, (match) => `highlight={${match[1]}}`],
  [/^focus=\{([^}]+)\}/, (match) => `focus={${match[1]}}`],
  [/^\{([^}]+)\}/, (match) => `{${match[1]}}`],
  [/^hl_lines=(["'])([\d\s-]+)\1/, (match) => `{${match[2].trim().split(/\s+/).join(",")}}`],
  [/^title=("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/, (match) => `title=${match[1]}`],
];

/** Mintlify's fence flags, which native has no equivalent for; its other bare words are the title. */
const FENCE_FLAGS = new Set(["wrap", "lines", "expandable"]);

/** The native spelling of a fence's metadata, and the parts native cannot carry. */
function nativeFenceMeta(language: string, meta: string, titleWords: boolean): { meta: string; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  const title: string[] = [];
  let rest = meta.trim();
  while (rest) {
    const known = ANNOTATIONS.map(([pattern, write]) => [rest.match(pattern), write] as const).find(([match]) => match);
    if (known) {
      kept.push(known[1](known[0]!));
      rest = rest.slice(known[0]![0].length).trimStart();
      continue;
    }
    const token = rest.match(/^(?:[\w-]+=(?:"[^"]*"|'[^']*'|\{[^}]*\}|\S+)|"[^"]*"|\([^)]*\)|\S+)/)![0];
    if (titleWords && !/^[\w-]+=/.test(token) && !FENCE_FLAGS.has(token)) title.push(token);
    else dropped.push(token);
    rest = rest.slice(token.length).trimStart();
  }
  if (title.length) kept.unshift(`title=${JSON.stringify(title.join(" "))}`);
  try {
    parseCodeFenceInfo([language, ...kept].join(" "));
    return { meta: kept.join(" "), dropped };
  } catch {
    return { meta: "", dropped: [meta.trim()] };
  }
}

/**
 * Rewrite fence info lines whose metadata native would reject; returns the text
 * and what was dropped, by line. The document is read in its own dialect, so a
 * fence indented inside a component is the fence native reads there.
 */
export async function normaliseFences(file: string, text: string, bodyStart: number, dialect: SourceDialect): Promise<{ text: string; dropped: { line: number; meta: string }[] }> {
  const edits: TextEdit[] = [];
  const dropped: { line: number; meta: string }[] = [];
  for (const { node } of walk(await parseDocument(file, text, bodyStart, dialect))) {
    if (node.type !== "code" || !node.meta || !node.position) continue;
    try {
      parseCodeFenceInfo(`${node.lang ?? ""} ${node.meta}`);
      continue;
    } catch {
      // Not native as written; rewritten below.
    }
    const native = nativeFenceMeta(node.lang ?? "", node.meta, dialect.fenceTitles === true);
    const start = node.position.start.offset;
    const line = text.slice(start, lineEnd(text, start)).replace(/\r?\n$/, "");
    const at = line.lastIndexOf(node.meta);
    // With nothing left to say, the space before the metadata goes too.
    const from = native.meta ? at : line.slice(0, at).replace(/[ \t]+$/, "").length;
    edits.push({ start: start + from, end: start + at + node.meta.length, text: native.meta });
    if (native.dropped.length) dropped.push({ line: node.position.start.line, meta: native.dropped.join(" ") });
  }
  return { text: applyEdits(text, edits), dropped };
}
