import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { markdown } from "../../src/index.js";
import { resolveConfigFromRaw } from "../../src/config.js";
import { buildSourceySite, sourceyArtifacts } from "../../src/site.js";
import { contentDiagnostics, parseComponents, renderContent } from "../../src/core/markdown-components.js";
import { messagesFor } from "../../src/core/messages.js";
import { InputReader } from "../../src/core/loader.js";

async function guide(body: string) {
  const root = await mkdtemp(join(tmpdir(), "sourcey-components-"));
  try {
    await writeFile(join(root, "guide.md"), body);
    const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, navigation: { tabs: [{ tab: "Docs", slug: "", source: markdown({ slugs: "file", groups: [{ group: "Start", pages: ["guide"] }] }) }] } }, root);
    const site = await buildSourceySite({ config, generateOgImages: false });
    const page = site.pages.find(entry => entry.outputPath === "guide.html")!.currentPage;
    if (page.kind !== "markdown") throw new Error("Expected a guide");
    return { ...page.markdown, searchIndex: JSON.stringify(site.searchRows) };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const FIELDS = [
  "# Settings",
  "",
  '<Field name="Password Length" type="number" default={12} min={8} max={128} required>',
  "  Length of the **generated** password.",
  "</Field>",
  "",
  '<Field name="options" type="object" deprecated>',
  "  Client options.",
  "",
  '  <Field name="SiteUrl" type="string" default="https://app.example.com" anchor="param-site-url">',
  "    The URL of the API.",
  "  </Field>",
  "</Field>",
  "",
].join("\n");

describe("native fields", () => {
  it("draw as the reference draws parameters, with nested child attributes and real anchors", async () => {
    const page = await guide(FIELDS);
    expect(page.html).toContain('<div class="param-item" id="field-password-length"><div class="param-header not-prose"><code class="param-name">Password Length</code><span class="param-type"><span class="json-property-type">number</span><span class="json-property-range">[8, 128]</span><span class="json-property-default-value">12</span></span><span class="required-badge');
    expect(page.html).toContain("Length of the <strong>generated</strong> password.");
    expect(page.html).toMatch(/id="field-options">[\s\S]*?>deprecated<[\s\S]*?Client options\.[\s\S]*?<details class="schema-expandable">[\s\S]*?Show child attributes[\s\S]*?id="param-site-url"/);
    expect(page.anchors).toEqual(expect.arrayContaining(["settings", "field-password-length", "field-options", "param-site-url"]));
  });

  it("group child fields under each titled shape a field can take", async () => {
    const page = await guide([
      '<Field name="metadata" type="object">',
      "  Depends on the actor.",
      "",
      '  <Expandable title="user actor">',
      '    <Field name="userId" type="string">The user.</Field>',
      '    <Field name="permission" type="object">Effective permissions.</Field>',
      "  </Expandable>",
      '  <Expandable title="identity actor">',
      '    <Field name="identityId" type="string">The identity.</Field>',
      '    <Field name="permission" type="object">Effective permissions.</Field>',
      "  </Expandable>",
      "</Field>",
      "",
    ].join("\n"));
    expect(page.html).toMatch(/Depends on the actor\.[\s\S]*?<\/div><\/div><details class="schema-expandable"><summary[^>]*>[\s\S]*?user actor<\/summary>[\s\S]*?id="field-userid"[\s\S]*?id="field-permission"[\s\S]*?<details class="schema-expandable"><summary[^>]*>[\s\S]*?identity actor<\/summary>[\s\S]*?id="field-identityid"[\s\S]*?id="field-permission-1"/);
    expect(page.markdown).toContain("**user actor**");
  });

  it("keep the same facts and prose in readable Markdown and search", async () => {
    const page = await guide(FIELDS);
    expect(page.markdown).toContain(
      ["- `Password Length` (number, required, default `12`, [8, 128])", "  Length of the **generated** password."].join("\n"),
    );
    expect(page.markdown).toContain(["- `options` (object, optional, deprecated)", "  Client options.", "  - `SiteUrl` (string, optional, default `https://app.example.com`)", "    The URL of the API."].join("\n"));
    expect(page.searchIndex).toContain("The URL of the API.");
  });

  it("share the page's anchors with headings: repeats are numbered, explicit duplicates stop the build", async () => {
    const repeated = await guide('# Host\n\n<Field name="Host" type="string">First.</Field>\n\n<Field name="Host" type="string">Second.</Field>\n');
    expect(repeated.anchors).toEqual(expect.arrayContaining(["host", "field-host", "field-host-1"]));
    await expect(guide('## Port {#port}\n\n<Field name="Port" anchor="port">Clash.</Field>\n')).rejects.toThrow("Duplicate explicit anchor: port");
  });

  it("stop at the component on attributes they do not read", async () => {
    await expect(guide('<Field name="Host" placeholder="db">Text.</Field>\n')).rejects.toThrow(/Field attribute placeholder is not supported at .*guide\.md:\d+/);
    await expect(guide('<Field type="string">Text.</Field>\n')).rejects.toThrow(/Field requires a name at .*guide\.md:\d+/);
    await expect(guide('<Field name="Port" min="8">Text.</Field>\n')).rejects.toThrow(/Field min must be a number/);
  });
});

describe("indented code", () => {
  it("is code to the component scanner, as it is to Markdown", async () => {
    const page = await guide([
      "# Registry",
      "",
      "Pull from your registry:",
      "",
      "    docker pull <REGISTRY.DOMAIN.COM:PORT>/rancher/rancher:latest",
      "    <Note>stays an example</Note>",
      "",
      "1. In a list item:",
      "",
      "        <Host>:8080",
      "",
      "<Note>",
      "Inside a callout:",
      "",
      "    <Port>",
      "</Note>",
      "",
    ].join("\n"));
    expect(page.html).toContain("docker pull &lt;REGISTRY.DOMAIN.COM:PORT&gt;/rancher/rancher:latest");
    expect(page.html).toContain("&lt;Note&gt;stays an example&lt;/Note&gt;");
    expect(page.html).toContain("&lt;Host&gt;:8080");
    expect(page.html).toMatch(/<div class="callout callout-note[^>]*role="note">[\s\S]*?Inside a callout:[\s\S]*?&lt;Port&gt;/);
    expect(page.html.match(/role="note"/g)).toHaveLength(1);
  });
});

describe("diagrams the renderer cannot draw", () => {
  const gitGraph = "# Workflow\n\n```mermaid\ngitGraph\n  commit\n  branch develop\n```\n";

  it("keep their source in the page, explained, with no picture claiming to be it", async () => {
    const page = await guide(gitGraph);
    expect(page.html).toMatch(/<figure class="sourcey-diagram sourcey-diagram-unrendered"><figcaption>This diagram could not be drawn, so its source is shown\.<\/figcaption>[\s\S]*?gitGraph[\s\S]*?branch develop[\s\S]*?<\/figure>/);
    expect(page.html).not.toContain("<img");
    expect(page.markdown).toContain("```mermaid\ngitGraph");
  });

  it("are reported where they are written", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-diagram-"));
    try {
      const file = join(root, "guide.md");
      await writeFile(file, gitGraph);
      const nodes = await parseComponents(gitGraph, { source: file, root, input: new InputReader() });
      const french = await parseComponents(gitGraph, { source: file, root, input: new InputReader(), context: { locale: "fr", lang: "fr", dir: "ltr", contentLocale: "fr", version: { id: "current", label: "Current" }, versionScope: "", messages: messagesFor("fr"), icons: "heroicons" } });
      expect(renderContent(french)).toContain("<figcaption>Ce diagramme n’a pas pu être dessiné ; sa source est affichée.</figcaption>");
      expect(contentDiagnostics(nodes)).toEqual([
        { severity: "warning", code: "diagram", file: await realpath(file), message: expect.stringMatching(/guide\.md at offset 12: the diagram could not be drawn \(Unsupported diagram type: "gitgraph"[^)]*\); the page shows its source instead$/) },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("agent-only content", () => {
  it("stays in machine exports and out of the page, its anchors, search and description", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-agents-"));
    try {
      await writeFile(join(root, "guide.md"), "# Guide\n\n<ForAgents>\nAgents: fetch the full spec.\n\n## For agents\n\nUse the tag filter.\n</ForAgents>\n\nPeople start here.\n\n## Setup\n\nInstall it.\n");
      const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, exports: { markdown: true }, navigation: { tabs: [{ tab: "Docs", slug: "", source: markdown({ slugs: "file", groups: [{ group: "Start", pages: ["guide"] }] }) }] } }, root);
      const site = await buildSourceySite({ config, generateOgImages: false });
      const page = site.pages.find(entry => entry.outputPath === "guide.html")!.currentPage;
      if (page.kind !== "markdown") throw new Error("Expected a guide");
      expect(page.markdown.html).not.toContain("fetch the full spec");
      expect(page.markdown.html).not.toContain("For agents");
      expect(page.markdown.headings.map(heading => heading.text)).toEqual(["Setup"]);
      expect(page.markdown.anchors).not.toContain("for-agents");
      expect(page.markdown.description).toBe("People start here.");
      expect(page.markdown.markdown).toContain("Agents: fetch the full spec.");
      expect(page.markdown.readerMarkdown).not.toContain("fetch the full spec");
      expect(JSON.stringify(site.searchRows)).not.toContain("fetch the full spec");
      const files = await sourceyArtifacts(site);
      expect(files.get("guide.md")!.toString()).toContain("Agents: fetch the full spec.");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("inline components", () => {
  it("stay in their sentence in readable Markdown and the description, and keep an opening paragraph in the page", async () => {
    const page = await guide('# Guide\n\nUse <Badge text="stable" /> with care.\n\nMore.\n');
    expect(page.markdown).toContain("Use stable with care.\n");
    expect(page.description).toBe("Use stable with care.");
    // A plain description cannot show the badge, so the paragraph stays in the page rather than becoming the lede.
    expect(page.hideLede).toBe(true);
    expect(page.html).toContain('<p>Use <span class="sourcey-badge"><strong>stable</strong></span> with care.</p>');
  });

  it("keep an opening paragraph with a link in the page, where the plain lede would lose it", async () => {
    const page = await guide("# Guide\n\nUse the [REST API](/api/) or the CLI.\n\nMore.\n");
    expect(page.description).toBe("Use the REST API or the CLI.");
    expect(page.hideLede).toBe(true);
    expect(page.html).toContain('<p>Use the <a href="/api/">REST API</a> or the CLI.</p>');
  });

  it("make a plain opening paragraph the lede", async () => {
    const page = await guide("# Guide\n\nUse the CLI.\n\nMore.\n");
    expect(page.hideLede).toBeUndefined();
    expect(page.html).not.toContain("Use the CLI.");
  });
});

describe("accordion anchors", () => {
  it("publish an accordion's own anchor among the page's, strict as a field's", async () => {
    const page = await guide('# Guide\n\n<AccordionGroup>\n<Accordion title="Billing" anchor="billing-faq">Monthly.</Accordion>\n</AccordionGroup>\n');
    expect(page.html).toContain('<details class="accordion-item" id="billing-faq"><summary class="accordion-trigger">Billing</summary>');
    expect(page.anchors).toContain("billing-faq");
    await expect(guide('# Guide\n\n## Billing faq\n\n<Accordion title="Billing" anchor="billing-faq">Monthly.</Accordion>\n')).rejects.toThrow("Duplicate explicit anchor: billing-faq");
    await expect(guide('# Guide\n\n<Accordion title="Billing" anchor="billing faq">Monthly.</Accordion>\n')).rejects.toThrow(/Accordion anchor must be a fragment such as billing-faq at .*guide\.md/);
  });
});

describe("callouts", () => {
  it("read as GitHub alerts in readable Markdown, so a page's summary is its prose rather than a callout's label", async () => {
    const page = await guide("# Subscriptions\n\n:::tip\nThis tutorial is unfinished.\n:::\n\n:::warning[Back up first]\nIt changes your data.\n:::\n\nTrack regular payments with subscriptions.\n");
    expect(page.description).toBe("Track regular payments with subscriptions.");
    expect(page.markdown).toContain("> [!TIP]\n> This tutorial is unfinished.");
    expect(page.markdown).toContain("> [!WARNING]\n> **Back up first**\n>\n> It changes your data.");
  });
});

describe("cards", () => {
  it("title themselves one level below the heading they sit under, so the page's outline never skips", async () => {
    const cards = '<CardGroup>\n<Card title="Install" href="/install">Run it.</Card>\n<Card title="Use" href="/use">Call it.</Card>\n</CardGroup>';
    const top = await guide(`Start here.\n\n${cards}\n`);
    expect(top.html.match(/<h2 class="card-item-title">/g)).toHaveLength(2);
    const nested = await guide(`Start here.\n\n## Next steps\n\n${cards}\n\n### Deeper\n\n${cards}\n`);
    expect(nested.html.match(/<h3 class="card-item-title">/g)).toHaveLength(2);
    expect(nested.html.match(/<h4 class="card-item-title">/g)).toHaveLength(2);
    expect(nested.html).not.toContain("<h2 class=\"card-item-title\">");
  });
});
