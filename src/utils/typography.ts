/**
 * SmartyPants over rendered HTML, as Astro and MkDocs' `smarty` render
 * Markdown: straight quotes become curly, `--` an em dash and `...` an
 * ellipsis. Only text changes: tags and their attributes stay as written, and
 * code, preformatted text, scripts, styles and drawings keep every character.
 */
const VERBATIM = new Set(["code", "pre", "kbd", "samp", "var", "script", "style", "svg", "math", "textarea"]);
/** A new block starts a new sentence, so a quote after it opens. */
const BLOCKS = new Set(["p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "dt", "dd", "div", "blockquote", "br", "figcaption", "summary", "caption", "section", "article"]);

export function smartypants(html: string): string {
  let verbatim = 0;
  let before = " ";
  return html.replace(/<[^>]*>|[^<]+/g, (run) => {
    if (run.startsWith("<")) {
      const tag = /^<(\/?)([a-zA-Z][\w-]*)/.exec(run);
      const name = tag?.[2].toLowerCase();
      if (name && VERBATIM.has(name)) verbatim = Math.max(0, verbatim + (tag![1] ? -1 : run.endsWith("/>") ? 0 : 1));
      if (name && BLOCKS.has(name)) before = " ";
      return run;
    }
    if (verbatim) {
      before = run.at(-1)!;
      return run;
    }
    const text = educate(run, before);
    before = text.at(-1)!;
    return text;
  });
}

const OPENS_AFTER = /[\s([{—–“‘-]/;

function educate(run: string, before: string): string {
  const text = run
    .replace(/&quot;/g, "\"")
    .replace(/&#(?:39|x27);/g, "'")
    .replace(/\.\.\./g, "…")
    .replace(/--/g, "—");
  let out = "";
  let previous = before;
  for (let index = 0; index < text.length; index++) {
    let character = text[index];
    if (character === "\"" || character === "'") {
      // At the end of the run the next character is behind a tag: the one before decides.
      const next = text[index + 1] ?? "x";
      const opens = OPENS_AFTER.test(previous) && !/\s/.test(next);
      // An apostrophe that shortens a year ('90s) closes, though it starts a word.
      const year = character === "'" && /^\d\ds/.test(text.slice(index + 1, index + 4));
      character = character === "\""
        ? opens ? "“" : "”"
        : opens && !year ? "‘" : "’";
    }
    out += character;
    previous = character;
  }
  return out;
}
