import type { Links, Token, Tokens } from "marked";
import { forEachToken, lexMarkdown } from "./markdown.js";
import { inlineCodeEnd } from "./markdown-syntax.js";
function markerPrefix(input: string, kind: string): string {
  let prefix = `@@SOURCEY_${kind}_`;
  while (input.includes(prefix)) prefix += "_";
  return prefix;
}
function protectFencedCodeBlocks(input: string): { text: string; blocks: string[]; prefix: string } {
  const prefix = markerPrefix(input, "FENCE");
  const blocks: string[] = [];
  const output: string[] = [];
  const lines = input.split("\n");
  let fence: { char: string; length: number } | null = null;
  let buffer: string[] = [];

  const pushProtectedBlock = () => {
    const index = blocks.push(buffer.join("\n")) - 1;
    output.push(`${prefix}${index}@@`);
    buffer = [];
  };

  for (const line of lines) {
    const stripped = line.replace(/^ {1,3}/, "");
    const fenceMatch = stripped.match(/^(`{3,}|~{3,})(.*)$/);

    if (!fence) {
      if (!fenceMatch) {
        output.push(line);
        continue;
      }
      fence = { char: fenceMatch[1][0], length: fenceMatch[1].length };
      buffer.push(line);
      continue;
    }

    buffer.push(line);
    if (
      fenceMatch &&
      fenceMatch[1][0] === fence.char &&
      fenceMatch[1].length >= fence.length &&
      !fenceMatch[2].trim()
    ) {
      pushProtectedBlock();
      fence = null;
    }
  }

  if (buffer.length > 0) pushProtectedBlock();

  return { text: output.join("\n"), blocks, prefix };
}

// Restores take the saved text through a function, so a `$` in it is never read as
// a replacement pattern such as $` or $&. One pass restores every marker.
function restoreMarkers(input: string, saved: readonly string[], prefix: string): string {
  return input.replace(new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)@@`, "g"), (marker, index: string) => saved[Number(index)] ?? marker);
}

/**
 * Rewrite prose destinations while keeping examples and inline code
 * byte-for-byte. `definitions` are the reference definitions of the page
 * `markdown` is part of.
 */
export function rewriteMarkdownDestinations(markdown: string, rewrite: (href: string) => string, definitions?: Links): string {
  const fenced = protectFencedCodeBlocks(markdown);
  const inline = protectInlineCodeSpans(fenced.text);
  /** Each link and image among `tokens` as rewritten, in `text`, the source they were read from. */
  function rewriteLinks(text: string, tokens: Token[]): string {
    const replacements = new Map<string, string>();
    forEachToken(tokens, token => {
      if (token.type !== "link" && token.type !== "image") return;
      const link = token as Tokens.Link | Tokens.Image;
      const target = rewrite(link.href);
      // A link's label was read with it: the images and links inside are its own tokens.
      const label = token.type === "link" && link.text !== link.raw ? rewriteLinks(link.text, link.tokens ?? []) : link.text;
      if (target === link.href && label === link.text) return;
      const destination = /[\s()<>]/.test(target) ? `<${target.replace(/>/g, "%3E")}>` : target;
      const title = link.title ? ` ${JSON.stringify(link.title)}` : "";
      replacements.set(link.raw, `${token.type === "image" ? "!" : ""}[${label}](${destination}${title})`);
    });
    return replaceEach(text, replacements);
  }
  const links = rewriteLinks(inline.text, lexMarkdown(inline.text, definitions));
  return restoreMarkers(restoreMarkers(links, inline.spans, inline.prefix), fenced.blocks, fenced.prefix);
}

/**
 * Every occurrence of each raw text replaced in one pass. Where raws begin at
 * one place, the longest wins: a parent link before the image inside it.
 */
function replaceEach(text: string, replacements: ReadonlyMap<string, string>): string {
  if (!replacements.size) return text;
  const lengths = [...new Set([...replacements.keys()].map((raw) => raw.length))].sort((a, b) => b - a);
  const starts = new Set([...replacements.keys()].map((raw) => raw[0]));
  let output = "", last = 0;
  for (let at = 0; at < text.length; at += 1) {
    if (!starts.has(text[at])) continue;
    for (const length of lengths) {
      const replacement = replacements.get(text.slice(at, at + length));
      if (replacement === undefined) continue;
      output += text.slice(last, at) + replacement;
      last = at + length;
      at = last - 1;
      break;
    }
  }
  return output + text.slice(last);
}

/** Transform actual HTML tokens without touching HTML shown in code examples. */
export async function rewriteMarkdownHtml(markdown: string, rewrite: (html: string) => Promise<string>): Promise<string> {
  const fenced = protectFencedCodeBlocks(markdown), inline = protectInlineCodeSpans(fenced.text);
  const fragments = new Set<string>();
  forEachToken(lexMarkdown(inline.text), token => { if (token.type === "html") fragments.add(token.raw); });
  const replacements = new Map<string, string>();
  for (const raw of fragments) {
    const transformed = await rewrite(raw);
    if (transformed !== raw) replacements.set(raw, transformed);
  }
  return restoreMarkers(restoreMarkers(replaceEach(inline.text, replacements), inline.spans, inline.prefix), fenced.blocks, fenced.prefix);
}

function protectInlineCodeSpans(input: string): { text: string; spans: string[]; prefix: string } {
  const prefix = markerPrefix(input, "INLINE");
  const spans: string[] = [];
  let output = "";
  let i = 0;

  while (i < input.length) {
    if (input[i] !== "`") {
      const tick = input.indexOf("`", i);
      const end = tick === -1 ? input.length : tick;
      output += input.slice(i, end);
      i = end;
      continue;
    }

    let tickEnd = i + 1;
    while (tickEnd < input.length && input[tickEnd] === "`") tickEnd += 1;

    const end = inlineCodeEnd(input, i);
    if (end === undefined) {
      output += input.slice(i, tickEnd);
      i = tickEnd;
      continue;
    }
    const span = input.slice(i, end);
    const index = spans.push(span) - 1;
    output += `${prefix}${index}@@`;
    i = end;
  }

  return { text: output, spans, prefix };
}
