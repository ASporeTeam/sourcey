import { useContext } from "preact/hooks";
import { OptionsContext, SiteContext } from "../../renderer/context.js";
import { renderMarkdown, renderMarkdownInline, siteMarkdownOptions } from "../../utils/markdown.js";
import { smartypants } from "../../utils/typography.js";

interface MarkdownProps {
  content?: string;
  inline?: boolean;
  class?: string;
}

/** Authored Markdown in generated reference pages; its alerts are the site's callouts. */
export function Markdown({ content, inline, class: className }: MarkdownProps) {
  const site = useContext(SiteContext);
  const { messages } = useContext(OptionsContext);
  if (!content) return null;

  const rendered = inline ? renderMarkdownInline(content) : renderMarkdown(content, siteMarkdownOptions(site.theme.icons, messages));
  const html = site.smartypants ? smartypants(rendered) : rendered;

  if (inline) {
    return <span class={className} dangerouslySetInnerHTML={{ __html: html }} />;
  }

  const cls = className ? `prose prose-gray dark:prose-invert ${className}` : "prose prose-gray dark:prose-invert";
  return (
    <div class={cls} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
