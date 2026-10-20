/** CommonMark code spans close on a run of exactly the opening length. */
export function inlineCodeEnd(input: string, cursor: number): number | undefined {
  if (input[cursor] !== "`" || input[cursor - 1] === "`") return undefined;
  let escapes = 0;
  for (let index = cursor - 1; input[index] === "\\"; index--) escapes++;
  if (escapes % 2) return undefined;
  let length = 1;
  while (input[cursor + length] === "`") length++;
  const run = "`".repeat(length);
  let position = cursor + length;
  const paragraphEnd = input.slice(position).search(/\n[ \t]*\r?\n/);
  const limit = paragraphEnd < 0 ? input.length : position + paragraphEnd;
  while ((position = input.indexOf(run, position)) >= 0) {
    if (position >= limit) return undefined;
    if (input[position - 1] !== "`" && input[position + length] !== "`") return position + length;
    position += length;
  }
  return undefined;
}
