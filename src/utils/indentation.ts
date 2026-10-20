/** Leading whitespace as columns, with tabs to CommonMark's four-column stops. */
export function indentColumns(prefix: string): number {
  return [...prefix].reduce((width, character) => (character === "\t" ? width + 4 - (width % 4) : width + 1), 0);
}

/**
 * Text without the indentation its lines share, measured in columns, so text
 * that mixes tabs and spaces loses its common indent too; a tab crossing the
 * common indent leaves its remaining columns as spaces. A leading newline and
 * trailing blank lines go.
 */
export function dedent(value: string): string {
  const lines = value.replace(/^\n|\n\s*$/g, "").split("\n");
  const indents = lines.filter((line) => line.trim()).map((line) => indentColumns(line.match(/^[ \t]*/)![0]));
  const common = indents.length ? Math.min(...indents) : 0;
  return lines
    .map((line) => {
      let width = 0;
      let index = 0;
      while (width < common && index < line.length && (line[index] === " " || line[index] === "\t")) width = indentColumns(line.slice(0, ++index));
      return " ".repeat(Math.max(0, width - common)) + line.slice(index);
    })
    .join("\n");
}
