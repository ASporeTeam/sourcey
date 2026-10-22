import { describe, expect, it } from "vitest";
import { Parser } from "htmlparser2";
import { decodeHTML } from "entities";
import { createHighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import githubLight from "shiki/themes/github-light-default.mjs";
import darkPlus from "shiki/themes/dark-plus.mjs";
import ts from "shiki/langs/typescript.mjs";
import yaml from "shiki/langs/yaml.mjs";
import bash from "shiki/langs/bash.mjs";
import html from "shiki/langs/html.mjs";
import javascript from "shiki/langs/javascript.mjs";
import { highlightCode } from "../../src/utils/highlighter.js";

const samples: [string, string][] = [
  ["typescript", "interface A<T> { x: T }\nconst re = /\\d+\\.\\w/g; // escapes are bold in light\nexport default async function f(): Promise<void> { await g(`x${y}`); }"],
  ["yaml", "apiVersion: v1\nkind: ConfigMap\ndata:\n  key: |\n    multi\n    line\n  list:\n    - a: 1\n      b: true # comment\n"],
  ["bash", "cat <<EOF > /tmp/x\nhello $USER\nEOF\nfor f in *.md; do echo \"$f\"; done"],
  ["html", "<style>a { color: red }</style>\n<script>const a = 1 < 2;</script>\n<a href=\"x\">&amp;</a>"],
  ["javascript", "\n\nconst a = 1;\n\n\nlet b = a;\n"],
];

const vars = (style?: string) => Object.fromEntries((style ?? "").split(";").filter(Boolean).map((declaration) => {
  const at = declaration.indexOf(":");
  return [declaration.slice(0, at), declaration.slice(at + 1)];
}));

/** Every character as a reader sees it: its colour and font in light and dark mode. Whitespace shows neither. */
function appearance(markup: string): string[] {
  const stack: Record<string, string>[] = [], seen: string[] = [];
  let block: Record<string, string> = {};
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name === "pre") block = vars(attributes.style);
      if (name === "span" && attributes.class?.split(" ").includes("line")) seen.push(`line ${attributes.class}`);
      stack.push(name === "span" ? vars(attributes.style) : {});
    },
    ontext(text) {
      const own = Object.assign({}, ...stack) as Record<string, string>;
      const look = (mode: string) => ["", "-font-style", "-font-weight", "-text-decoration"]
        .map((key) => (own[`--shiki-${mode}${key}`] ?? (key ? "inherit" : block[`--shiki-${mode}`])).toLowerCase()).join(" ");
      for (const char of decodeHTML(text)) seen.push(/\s/.test(char) ? char : `${char} ${look("light")} ${look("dark")}`);
    },
    onclosetag() { stack.pop(); },
  }, { decodeEntities: false });
  parser.end(markup);
  return seen;
}

describe("highlightCode", () => {
  it("colours every character in both themes as Shiki's own two-theme output does, from one tokenizing", async () => {
    const shiki = await createHighlighterCore({ themes: [githubLight, darkPlus], langs: [ts, yaml, bash, html, javascript], engine: createOnigurumaEngine(import("shiki/wasm")) });
    for (const [lang, code] of samples) {
      const expected = shiki.codeToHtml(code, {
        lang, themes: { light: "github-light-default", dark: "dark-plus" }, defaultColor: false,
        transformers: [{ line(node, line) { this.addClassToHast(node, [line === 2 && "highlighted", line === 3 && "diff-added"].filter(Boolean).join(" ")); } }],
      });
      expect(appearance(highlightCode(code, lang, { language: lang, highlight: [2], focus: [], add: [3], remove: [] })), lang).toEqual(appearance(expected));
    }
  });
});
