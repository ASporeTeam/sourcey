import { describe, expect, it } from "vitest";
import { identityKey } from "../../src/migration/components.js";
import { builtinConverters } from "../../src/migration/mapping.js";
import { Diagnostics } from "../../src/migration/diagnostics.js";
import { convertDocuments, type PlannedDocument } from "../../src/migration/plan.js";
import { ProjectFiles } from "../../src/migration/project-files.js";
import { withProject } from "./helpers.js";

async function convert(
  files: Record<string, string>,
  frontmatter: PlannedDocument["frontmatter"] = { set: {}, remove: [] },
  globals?: ReadonlyMap<string, string>,
) {
  let result: { text: string; diagnostics: Diagnostics } | undefined;
  await withProject(files, async (root) => {
    const project = new ProjectFiles(root);
    const diagnostics = new Diagnostics();
    const converters = builtinConverters();
    converters.set(identityKey("framework", "Note"), () => ({ keep: true }));
    converters.set(identityKey("framework", "Check"), () => ({ component: "Tip", props: { title: "Done" } }));
    converters.set(identityKey("src/components/Callout.tsx", "Callout"), ({ props }) => ({
      component: props.type === "warning" ? "Warning" : "Info",
      props: typeof props.title === "string" ? { title: props.title } : {},
    }));
    await convertDocuments([{ file: "page.mdx", route: "/page/", dialect: { fragments: "github", globals }, frontmatter }], {
      project,
      diagnostics,
      converters,
      elementOverrides: new Set([identityKey("src/utils/markdown.tsx", "markdownComponents")]),
    });
    result = { text: await project.readText("page.mdx"), diagnostics };
  });
  return result!;
}

describe("MDX conversion", () => {
  it("converts imported components by module identity, including renamed bindings", async () => {
    const { text, diagnostics } = await convert({
      "page.mdx": [
        "---",
        "title: Start",
        "---",
        "",
        "import { LinkCard as Link, CardGrid } from '@astrojs/starlight/components';",
        "",
        "Intro with `<LinkCard>` in code.",
        "",
        "<CardGrid>",
        '\t<Link title="Install" href="/install/" description="Get *running* fast." />',
        "</CardGrid>",
        "",
        "```mdx",
        '<Link title="kept" />',
        "```",
        "",
      ].join("\n"),
    });
    expect(diagnostics.errors).toEqual([]);
    expect(text).toBe(
      [
        "---",
        "title: Start",
        "---",
        "",
        "Intro with `<LinkCard>` in code.",
        "",
        "<CardGroup cols={2}>",
        '\t<Card title="Install" href="/install/">Get \\*running\\* fast.</Card>',
        "</CardGroup>",
        "",
        "```mdx",
        '<Link title="kept" />',
        "```",
        "",
      ].join("\n"),
    );
  });

  it("maps project components through the mapping and keeps their children's bytes", async () => {
    const { text, diagnostics } = await convert({
      "src/components/Callout.tsx": "export function Callout() {}\n",
      "page.mdx": [
        "import { Callout } from './src/components/Callout';",
        "",
        '<Callout type="warning" title="Careful">',
        "  Only with **RoadRunner**.",
        "</Callout>",
        "",
      ].join("\n"),
    });
    expect(diagnostics.errors).toEqual([]);
    expect(text).toBe(['<Warning title="Careful">', "  Only with **RoadRunner**.", "</Warning>", ""].join("\n"));
  });

  it("stops on unmapped components and executable exports with their locations", async () => {
    const { diagnostics } = await convert({
      "page.mdx": [
        "import Widget from './Widget.astro';",
        "export const answer = compute();",
        "",
        "<Widget />",
        "",
      ].join("\n"),
    });
    expect(diagnostics.errors.map((error) => [error.line, error.message])).toEqual([
      [2, "This export runs code when the page renders, which native Markdown does not execute"],
      [4, "<Widget> (Widget.astro#default) has no native conversion"],
    ]);
  });

  it("removes comments, inlines imported constants and drops covered element overrides", async () => {
    const { text, diagnostics } = await convert({
      "src/links.ts": 'export const CLOUD = "https://cloud.example.com";\n',
      "src/utils/markdown.tsx": "export const markdownComponents = {};\n",
      "page.mdx": [
        "import { CLOUD } from './src/links';",
        "import { markdownComponents } from './src/utils/markdown';",
        "export const components = markdownComponents;",
        "",
        "{/* editorial note */}",
        "",
        'Visit {CLOUD} or <a href={CLOUD} className="cta">sign up</a>.',
        "",
      ].join("\n"),
    });
    expect(diagnostics.errors).toEqual([]);
    expect(text).toBe('Visit https://cloud.example.com or <a href="https://cloud.example.com" class="cta">sign up</a>.\n');
  });

  it("writes Mermaid components as fenced diagrams", async () => {
    const { text } = await convert({
      "page.mdx": [
        "import { Mermaid } from 'mdx-mermaid/lib/Mermaid';",
        "",
        "<Mermaid",
        "  chart={`",
        "sequenceDiagram",
        "    A->>B: Hello`}",
        '  client:only="react"',
        "/>",
        "",
      ].join("\n"),
    });
    // MDX strips the element's indentation from the expression's continuation lines; the
    // component received this text, so the fence holds it.
    expect(text).toBe(["```mermaid", "sequenceDiagram", "  A->>B: Hello", "```", ""].join("\n"));
  });

  it("refuses a replacement that would discard authored children", async () => {
    const { diagnostics } = await convert({
      "page.mdx": [
        "import { LinkCard } from '@astrojs/starlight/components';",
        "",
        '<LinkCard title="A" href="/a/">Body text</LinkCard>',
        "",
      ].join("\n"),
    });
    expect(diagnostics.errors.map((error) => error.message)).toEqual(["<LinkCard> has children that its native replacement would discard"]);
  });

  it("uses a framework's global components without imports, keeping native ones as written", async () => {
    const { text, diagnostics } = await convert(
      { "page.mdx": ['<Note   title="Spacing kept">', "  Read me.", "</Note>", "", "<Check>Saved.</Check>", ""].join("\n") },
      undefined,
      new Map([["Note", "framework#Note"], ["Check", "framework#Check"]]),
    );
    expect(diagnostics.errors).toEqual([]);
    expect(text).toBe(['<Note   title="Spacing kept">', "  Read me.", "</Note>", "", '<Tip title="Done">Saved.</Tip>', ""].join("\n"));
  });

  it("includes an imported Markdown partial natively, and refuses one given props", async () => {
    const included = await convert({
      "snippets/intro.mdx": "Shared text.\n",
      "page.mdx": ["import Intro from './snippets/intro.mdx';", "", "<Intro />", ""].join("\n"),
    });
    expect(included.text).toBe('<Include src="./snippets/intro.mdx" />\n');
    // A page lending itself the partial's headings needs nothing: the native include puts them in its outline.
    const outlined = await convert({
      "snippets/glossary.md": "## Terms\n",
      "page.mdx": ["import Glossary, { toc as GlossaryTOC } from './snippets/glossary.md';", "", "<Glossary />", "", "export const toc = GlossaryTOC;", ""].join("\n"),
    });
    expect(outlined.diagnostics.errors).toEqual([]);
    expect(outlined.text).toBe('<Include src="./snippets/glossary.md" />\n');
    const refused = await convert({
      "snippets/intro.mdx": "Hello {props.name}.\n",
      "page.mdx": ["import Intro from './snippets/intro.mdx';", "", '<Intro name="Kam" />', ""].join("\n"),
    });
    expect(refused.diagnostics.errors.map((error) => error.message)).toEqual(["A partial with props or children has no native include form"]);
  });

  it("moves back a paragraph MDX reads as text that native Markdown would read as indented code", async () => {
    const { text, diagnostics } = await convert(
      {
        "page.mdx": [
          "    A top-level paragraph indented four.",
          "",
          "<Note>",
          "    As per the notice, this is a paragraph in MDX.",
          "    It continues here.",
          "",
          "Back at the margin.",
          "</Note>",
          "",
          "<Note>",
          "  First.",
          "",
          "      Four past the body's two.",
          "</Note>",
          "",
        ].join("\n"),
      },
      undefined,
      new Map([["Note", "framework#Note"]]),
    );
    expect(diagnostics.errors).toEqual([]);
    expect(text).toBe(
      [
        "A top-level paragraph indented four.",
        "",
        "<Note>",
        "As per the notice, this is a paragraph in MDX.",
        "    It continues here.",
        "",
        "Back at the margin.",
        "</Note>",
        "",
        "<Note>",
        "  First.",
        "",
        "  Four past the body's two.",
        "</Note>",
        "",
      ].join("\n"),
    );
  });

  it("ends a block HTML element before Markdown, but leaves an element's children in its one HTML block", async () => {
    const { text, diagnostics } = await convert({
      "page.mdx": [
        '<div class="badges">',
        '<a href="https://one.example"><svg viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg></a>',
        '<a href="https://two.example"><svg viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg></a>',
        "</div>",
        "Text after the badges.",
        "",
      ].join("\n"),
    });
    expect(diagnostics.errors).toEqual([]);
    expect(text).toBe(
      [
        '<div class="badges">',
        '<a href="https://one.example"><svg viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg></a>',
        '<a href="https://two.example"><svg viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg></a>',
        "</div>",
        "",
        "Text after the badges.",
        "",
      ].join("\n"),
    );
  });

  it("edits frontmatter keys in place and leaves the rest as written", async () => {
    const { text } = await convert(
      { "page.mdx": ["", "---", "title: Guide", "template: doc", "sidebar:", "  order: 2", "  label: Short", "---", "", "Body.", ""].join("\n") },
      { set: { slug: "guides/my_guide", navTitle: "Short" }, remove: ["template", "sidebar"] },
    );
    expect(text).toBe(["---", "title: Guide", "slug: guides/my_guide", "navTitle: Short", "---", "", "Body.", ""].join("\n"));
  });
});
