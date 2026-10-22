/** A name's text with a break opportunity after each underscore, so a snake_case name wraps between its words rather than inside one. */
export function Breakable({ text }: { text: string }) {
  const parts = text.split("_");
  return <>{parts.map((part, index) => (index < parts.length - 1 ? <>{part}_<wbr /></> : part))}</>;
}

/** Whether a summary is a bare name, such as an MCP tool's, rather than prose to read as Markdown. */
export const bareName = (text: string) => /^[\w.-]+$/.test(text) && text.includes("_");
