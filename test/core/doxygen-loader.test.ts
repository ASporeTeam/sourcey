import { describe, it, expect } from "vitest";
import { extractHeadings, renderMarkdown } from "../../src/utils/markdown.js";
import {
  normalizeDoxygenDescription,
  polishGeneratedDoxygenHtml,
  rewriteGeneratedDoxygenIncludePath,
  rewriteGeneratedDoxygenMarkdown,
  rewriteGeneratedDoxygenHtmlLinks,
} from "../../src/core/doxygen-loader.js";

describe("normalizeDoxygenDescription", () => {
  it("falls back to the resolved lead paragraph when the summary still contains Doxygen ref placeholders", () => {
    const description =
      "Session type documented in a different group from [PacketStream]({#ref classdemo_1_1PacketStream #}).";
    const markdown = `<a id="peersession"></a>

## PeerSession

\`\`\`cpp
#include <webrtc.h>
\`\`\`

> **Inherits:** \`Base\`

Session type documented in a different group from [PacketStream](demo-PacketStream.html#packetstream).

### Public Methods`;

    expect(normalizeDoxygenDescription(description, markdown)).toBe(
      "Session type documented in a different group from PacketStream.",
    );
  });

  it("returns plain-text descriptions when no placeholder refs remain", () => {
    const description = "Packet pipeline primitive owned by the [base](base.html) module.";

    expect(normalizeDoxygenDescription(description, "## PacketStream")).toBe(
      "Packet pipeline primitive owned by the base module.",
    );
  });

  it("strips pseudo-links emitted for C++ names in generated prose", () => {
    const html = "<p><a href=\"http::Request\">http::Request</a> <a href=\"[ServerPeer](icy-smpl-ServerPeer.html#serverpeer\"></a>&amp; peer <a href=\"std::string\">std::string</a></p>";

    expect(rewriteGeneratedDoxygenHtmlLinks(html)).toBe(
      "<p><code>http::Request</code> <code>ServerPeer</code>&amp; peer <code>std::string</code></p>",
    );
  });

  it("strips machine-local prefixes from generated include paths", () => {
    expect(rewriteGeneratedDoxygenIncludePath("/home/kam/dev/icey/src/graft/include/icy/graft/graft.h")).toBe("icy/graft/graft.h");
    expect(rewriteGeneratedDoxygenIncludePath("/home/kam/dev/icey/src/symple/src/server/detail.h")).toBe("src/symple/src/server/detail.h");
  });

  it("rewrites generated markdown include directives before rendering", () => {
    const markdown = [
      "```cpp",
      "#include </home/kam/dev/icey/src/graft/include/icy/graft/graft.h>",
      "#include </home/kam/dev/icey/src/symple/src/server/detail.h>",
      "```",
    ].join("\n");

    expect(rewriteGeneratedDoxygenMarkdown(markdown)).toBe([
      "```cpp",
      "#include <icy/graft/graft.h>",
      "#include <src/symple/src/server/detail.h>",
      "```",
    ].join("\n"));
  });
});

describe("polishGeneratedDoxygenHtml", () => {
  const classPage = `<a id="client-3"></a>

# Client

\`\`\`cpp
#include <icy/turn/client/client.h>
\`\`\`

\`\`\`cpp
class Client
\`\`\`

[Defined in src/turn/client.h:124](https://example.com/client.h#L124)

> **Inherits:** [\`Stateful< ClientState >\`](icy-Stateful.html#stateful), [\`IAllocation\`](icy-IAllocation.html#iallocation)
> **Subclassed by:** [\`TCPClient\`](icy-TCPClient.html#tcpclient)

TURN client that manages relay allocations.

## Inherited from [\`Stateful\`](icy-Stateful.html#stateful)

| Kind | Name | Description |
|------|------|-------------|
| \`function\` | [\`stateEquals\`](#stateequals) \`virtual\` \`const\` | Compares states. |

### start

\`virtual\` \`noexcept\`

\`\`\`cpp
virtual void start() noexcept
\`\`\`

Defined in src/turn/client.h:166
`;

  const html = polishGeneratedDoxygenHtml(renderMarkdown(rewriteGeneratedDoxygenMarkdown(classPage)), {
    title: "Client",
    description: "TURN client that manages relay allocations.",
  });

  it("drops the title and description the layout already shows, keeping the title's anchor", () => {
    expect(html).not.toContain("<h1");
    expect(html).toContain('<a id="client-3"></a>');
    expect(html).toContain('<a id="client"></a>');
    expect(html).not.toContain("<p>TURN client that manages relay allocations.</p>");
  });

  it("merges the include with the declaration into one code block", () => {
    expect(html.match(/prose-code-block/g)).toHaveLength(2);
    expect(html).toMatch(/#include[\s\S]*class<\/span><span[^>]*> Client/);
  });

  it("renders relations as a list and Defined in as metadata, not a quotation or body text", () => {
    expect(html).not.toContain("<blockquote>");
    expect(html).toMatch(/<dl class="api-relations"><div><dt>Inherits<\/dt><dd><a href="icy-Stateful\.html#stateful"><code>Stateful&lt; ClientState &gt;<\/code><\/a>, <a [^>]+><code>IAllocation<\/code><\/a><\/dd><\/div><div><dt>Subclassed by<\/dt><dd>/);
    expect(html).toContain('<p class="api-defined-in"><a href="https://example.com/client.h#L124"');
    expect(html).toContain('<p class="api-defined-in">Defined in src/turn/client.h:166</p>');
  });

  it("turns member badges into quiet labels in sections and table cells", () => {
    expect(html).toContain('<p class="api-qualifiers"><span class="api-qualifier">virtual</span> <span class="api-qualifier">noexcept</span></p>');
    expect(html).toContain('<code>stateEquals</code></a> <span class="api-qualifier">virtual</span> <span class="api-qualifier">const</span></td>');
    expect(html).toContain("<td><code>function</code></td>");
  });

  it("keeps a body h1 that is not the page title", () => {
    const other = polishGeneratedDoxygenHtml('<h1 id="overview">Overview</h1>\n<p>Text.</p>', { title: "Client" });
    expect(other).toContain('<h1 id="overview">Overview</h1>');
  });

  it("lists headings by their plain text, without code-span backticks, under unchanged ids", () => {
    const heading = extractHeadings(classPage).find((h) => h.text.startsWith("Inherited"));
    expect(heading).toEqual({ level: 2, text: "Inherited from Stateful", id: "inherited-from-stateful" });
    expect(html).toContain('<h2 id="inherited-from-stateful">');
  });
});
