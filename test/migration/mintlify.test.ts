import { describe, expect, it } from "vitest";
import { operationFieldRoot, referenceFieldPath } from "../../src/core/reference-identity.js";
import { migrateProject, MigrationError } from "../../src/migration/index.js";
import { read, withProject } from "./helpers.js";

const site = {
  "docs.json": JSON.stringify(
    {
      $schema: "https://mintlify.com/docs.json",
      name: "Example",
      colors: { primary: "#0D9373", light: "#07C983", dark: "#0D9373" },
      appearance: { default: "dark" },
      logo: { light: "/logo/light.svg", dark: "/logo/dark.svg" },
      favicon: "/favicon.svg",
      navigation: {
        tabs: [
          { tab: "Guides", groups: [{ group: "Start", pages: ["index", "quickstart", "status", { group: "Deploy", pages: ["deploy/docker"] }] }] },
          { tab: "Products", menu: [{ item: "Vault", pages: ["vault/overview", "vault/missing"] }] },
          { tab: "Blog", href: "https://example.com/blog" },
        ],
      },
      navbar: { links: [{ label: "Community", href: "https://discord.gg/example" }], primary: { type: "button", label: "Sign up", href: "https://app.example.com" } },
      footer: { socials: { x: "https://x.com/example", github: "https://github.com/example" } },
      redirects: [{ source: "/old", destination: "/quickstart" }],
    },
    null,
    2,
  ),
  "index.mdx": '---\ntitle: Introduction\n---\n\n<Note>Read this first.</Note>\n\n<CardGroup cols={2}>\n  <Card title="Quickstart" icon="rocket" href="/quickstart">Start here.</Card>\n</CardGroup>\n\n![Hero](/images/hero.png)\n',
  "quickstart.mdx": '---\ntitle: Quickstart\nsidebarTitle: Start\n---\n\nimport Setup from "/snippets/setup.mdx";\n\n<Steps>\n  <Step title="Install">Run the installer.</Step>\n</Steps>\n\n<Check>Installed.</Check>\n\n<Setup />\n',
  "status.mdx": "---\ntitle: Status\nurl: https://status.example.com\n---\n",
  "deploy/docker.mdx": '---\ntitle: Docker\n---\n\n<Tabs>\n  <Tab title="Compose">Use Compose.</Tab>\n</Tabs>\n',
  "vault/overview.mdx": '---\nsidebarTitle: "Overview"\n---\n\n<AccordionGroup>\n  <Accordion title="Why?">Because.</Accordion>\n</AccordionGroup>\n',
  "unlisted.mdx": "---\ntitle: Unlisted\n---\n\nPublished, out of the menu.\n",
  "snippets/setup.mdx": "Set `EXAMPLE_TOKEN` before you start.\n",
  "images/hero.png": "png",
  "logo/light.svg": "<svg/>\n",
  "logo/dark.svg": "<svg/>\n",
  "favicon.svg": "<svg/>\n",
};

const CONFIG = `import { defineConfig, markdown } from "sourcey";

export default defineConfig({
  name: "Example",
  logo: { light: "./logo/light.svg", dark: "./logo/dark.svg" },
  favicon: "./favicon.svg",
  theme: {
    appearance: { default: "dark" },
    colors: { primary: "#0D9373", light: "#07C983", dark: "#0D9373" },
  },
  prettyUrls: "strip",
  navbar: {
    links: [
      {
        type: "discord",
        href: "https://discord.gg/example",
        label: "Community",
      },
    ],
    primary: { type: "button", label: "Sign up", href: "https://app.example.com" },
  },
  footer: {
    links: [
      { type: "twitter", href: "https://x.com/example" },
      { type: "github", href: "https://github.com/example" },
    ],
  },
  navigation: {
    tabs: [
      {
        tab: "Documentation",
        slug: "",
        source: markdown({
          root: ".",
          groups: [
            {
              group: "Guides",
              id: "guides",
              pages: [
                {
                  group: "Start",
                  id: "guides/start",
                  pages: [
                    "index",
                    "quickstart",
                    { href: "https://status.example.com", label: "Status" },
                    {
                      group: "Deploy",
                      id: "guides/start/deploy",
                      collapsed: true,
                      pages: ["deploy/docker"],
                    },
                    { page: "unlisted", hidden: true },
                  ],
                },
              ],
            },
            {
              group: "Products",
              id: "products",
              pages: ["vault/overview"],
            },
            {
              group: "",
              id: "ungrouped-3",
              pages: [
                { href: "https://example.com/blog", label: "Blog" },
              ],
            },
          ],
        }),
      },
    ],
  },
  redirects: { "/old": "/quickstart" },
});
`;

describe("sourcey migrate mintlify", () => {
  it("converts docs.json, navigation sets, pages and components, and verifies the native build", async () => {
    await withProject(site, async (root) => {
      const report = await migrateProject({ framework: "mintlify", root });
      expect(report.routes.map((route) => route.source).sort()).toEqual(["/", "/deploy/docker", "/quickstart", "/unlisted", "/vault/overview"]);
      expect(await read(root, "sourcey.config.ts")).toBe(CONFIG);
      // Native components stay as written; an icon outside native's set and a root image path are converted.
      expect(await read(root, "index.mdx")).toBe(
        '---\ntitle: Introduction\n---\n\n<Note>Read this first.</Note>\n\n<CardGroup cols={2}>\n  <Card title="Quickstart" href="/quickstart">Start here.</Card>\n</CardGroup>\n\n![Hero](./images/hero.png)\n',
      );
      expect(await read(root, "quickstart.mdx")).toBe(
        '---\ntitle: Quickstart\nnavTitle: Start\n---\n\n<Steps>\n  <Step title="Install">Run the installer.</Step>\n</Steps>\n\n<Tip>Installed.</Tip>\n\n<Include src="./snippets/setup.mdx" />\n',
      );
      // Mintlify anchors an accordion at its title, which links keep.
      expect(await read(root, "vault/overview.mdx")).toBe('---\ntitle: Overview\n---\n\n<AccordionGroup>\n  <Accordion title="Why?" anchor="why">Because.</Accordion>\n</AccordionGroup>\n');
      expect(report.diagnostics.map((item) => item.message)).toEqual([
        "docs.json lists 1 page with no file, which Mintlify left out and so does native navigation: vault/missing",
        "Navigation sets Guides, Products become sections of one sidebar: the navigation is reorganised, and every page keeps its URL",
        "Mintlify keeps the path it serves the docs at in its dashboard; set siteUrl and baseUrl if they are served below a site's root",
        '<Card> icon "rocket" is not carried over',
      ]);
    });
  });

  it("converts parameter and response fields to native fields, keeping Mintlify's anchors", async () => {
    const fields = [
      "---",
      "title: Settings",
      "---",
      "",
      '<ParamField path="Secret Name" type="string" required>',
      "  Name by which you want the secret to be referenced.",
      "</ParamField>",
      "",
      '<ParamField query="limit" type="number" optional default="12" min="8" max="128">',
      "  Page size.",
      "</ParamField>",
      "",
      '<ParamField path="options" type="object">',
      "  Client options.",
      "",
      '  <Expandable title="properties">',
      '    <ParamField path="SiteUrl" type="string" default="https://app.example.com">The URL.</ParamField>',
      "  </Expandable>",
      "</ParamField>",
      "",
      '<ResponseField name="TagIDs" type="string[]">Tags.</ResponseField>',
      "",
      '<ParamField path="Secret Name" type="string">Repeated.</ParamField>',
      "",
    ].join("\n");
    await withProject({ ...site, "settings.mdx": fields }, async (root) => {
      await migrateProject({ framework: "mintlify", root });
      expect(await read(root, "settings.mdx")).toBe(
        [
          "---",
          "title: Settings",
          "---",
          "",
          '<Field name="Secret Name" type="string" required anchor="param-secret-name">',
          "  Name by which you want the secret to be referenced.",
          "</Field>",
          "",
          '<Field name="limit" type="number" default="12" min={8} max={128} anchor="param-limit">',
          "  Page size.",
          "</Field>",
          "",
          '<Field name="options" type="object" anchor="param-options">',
          "  Client options.",
          "",
          '  <Expandable title="properties">',
          '    <Field name="SiteUrl" type="string" default="https://app.example.com" anchor="param-site-url">The URL.</Field>',
          "  </Expandable>",
          "</Field>",
          "",
          '<Field name="TagIDs" type="string[]" anchor="param-tag-ids">Tags.</Field>',
          "",
          '<Field name="Secret Name" type="string" anchor="param-secret-name-1">Repeated.</Field>',
          "",
        ].join("\n"),
      );
    });
  });

  it("converts columns of cards, captioned frames, views, visibility and presentation-only attributes", async () => {
    // A 1x1 PNG, so the figure has a real image to process.
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const page = [
      "---",
      "title: Components",
      "---",
      "",
      '<Columns cols="2">',
      '  <Card title="Signature">RSA</Card>',
      '  <Card title="Keys">ECDSA</Card>',
      "</Columns>",
      "",
      '<Frame caption="The audit sheet.">',
      '  <img src="/images/audit.png" alt="Audit sheet" />',
      "</Frame>",
      "",
      '<View title="Organization-level">',
      "Set it for the organization.",
      "</View>",
      "",
      '<Visibility for="humans">',
      "For people.",
      "</Visibility>",
      "",
      '<Badge color="green" size="sm">New</Badge>',
      "",
      "<AccordionGroup>",
      '  <Accordion title="FAQ" defaultOpen>Answer.</Accordion>',
      '  <Accordion title="Notes" id="release-notes">First.</Accordion>',
      '  <Accordion title="Release" id="release-notes">Second.</Accordion>',
      "</AccordionGroup>",
      "",
      "## Setup",
      "",
      '<Accordion title="Setup">Steps.</Accordion>',
      "",
    ].join("\n");
    await withProject({ ...site, "components.mdx": page, "images/audit.png": png }, async (root) => {
      const report = await migrateProject({ framework: "mintlify", root });
      const text = await read(root, "components.mdx");
      expect(text).toContain('<CardGroup cols={2}>\n  <Card title="Signature">RSA</Card>\n  <Card title="Keys">ECDSA</Card>\n</CardGroup>');
      expect(text).toContain('<Figure src="./images/audit.png" alt="Audit sheet" caption="The audit sheet." />');
      expect(text).toContain('<Accordion title="Organization-level">\nSet it for the organization.\n</Accordion>');
      expect(text).toContain("For people.");
      expect(text).not.toContain("Visibility");
      expect(text).toContain("<Badge>New</Badge>");
      expect(text).toContain('<Accordion title="FAQ" anchor="faq">Answer.</Accordion>');
      // An explicit id is the anchor; one the page already has stays with its first holder, a heading included.
      expect(text).toContain('<Accordion title="Notes" anchor="release-notes">First.</Accordion>\n  <Accordion title="Release">Second.</Accordion>');
      expect(text).toContain('## Setup\n\n<Accordion title="Setup">Steps.</Accordion>');
      expect(report.diagnostics.map((item) => item.message)).toEqual(expect.arrayContaining([
        '<View> "Organization-level" becomes a section the reader opens; native has no page-wide view switcher',
        '<Visibility for="humans"> content is also in the page\'s Markdown export, which agents read',
        "<Badge> color, size is not carried over",
        '<Accordion> "FAQ": defaultOpen is not carried over',
        '<Accordion> "Setup": its anchor #setup stays with the page\'s earlier heading or accordion',
        '<Accordion> "Release": its anchor #release-notes stays with the page\'s earlier heading or accordion',
      ]));
    });
    await withProject({ ...site, "agents.mdx": '---\ntitle: Agents\n---\n\nFor everyone.\n\n<Visibility for="agents">\nOnly agents.\n</Visibility>\n' }, async (root) => {
      await migrateProject({ framework: "mintlify", root });
      expect(await read(root, "agents.mdx")).toBe('---\ntitle: Agents\n---\n\nFor everyone.\n\n<ForAgents>\nOnly agents.\n</ForAgents>\n');
    });
  });

  it("draws custom and center pages as page, keeping wide and frame pages as documentation, and says so", async () => {
    await withProject({
      ...site,
      "index.mdx": '---\ntitle: Introduction\nmode: custom\n---\n\n# Welcome\n',
      "unlisted.mdx": "---\ntitle: Unlisted\nmode: wide\n---\n\nPublished, out of the menu.\n",
    }, async (root) => {
      const report = await migrateProject({ framework: "mintlify", root });
      expect(await read(root, "index.mdx")).toBe("---\ntitle: Introduction\nlayout: page\n---\n\n# Welcome\n");
      expect(await read(root, "unlisted.mdx")).toBe("---\ntitle: Unlisted\n---\n\nPublished, out of the menu.\n");
      expect(report.diagnostics.filter((item) => item.code === "mintlify-frontmatter").map(({ file, message }) => ({ file, message }))).toEqual([
        { file: "unlisted.mdx", message: "mode: wide hides the contents list; native lists a page's sections beside it" },
      ]);
    });
    await withProject({ ...site, "unlisted.mdx": "---\ntitle: Unlisted\nmode: hero\n---\n\nText.\n" }, async (root) => {
      const failure = await migrateProject({ framework: "mintlify", root }).catch((error: unknown) => error);
      expect((failure as MigrationError).diagnostics.filter((item) => item.severity === "error").map((item) => item.message)).toEqual(["mode: hero is not a Mintlify page mode"]);
    });
  });

  it("draws text in the family docs.json names, Inter otherwise as Mintlify does", async () => {
    const docs = JSON.parse(site["docs.json"] as string);
    const fonts = { ...site, "docs.json": JSON.stringify({ ...docs, fonts: { family: "Poppins", body: { family: "Lato", source: "https://cdn.example.com/lato.woff2" } } }) };
    await withProject(fonts, async (root) => {
      const report = await migrateProject({ framework: "mintlify", root });
      expect(await read(root, "sourcey.config.ts")).toContain('fonts: { sans: "Lato" }');
      expect(report.diagnostics.map((item) => item.message)).toContain('Fonts: "Lato" is served from https://cdn.example.com/lato.woff2, which native loads from Google Fonts; to keep serving yours, set theme.fonts.google: false and add an @font-face rule to a theme.css stylesheet');
    });
    await withProject(site, async (root) => {
      await migrateProject({ framework: "mintlify", root });
      expect(await read(root, "sourcey.config.ts")).not.toContain("fonts:");
    });
  });

  it("keeps a fence's title, the words Mintlify reads after its language, and names what has no native equivalent", async () => {
    const page = [
      "---",
      "title: Docker",
      "---",
      "",
      "<CodeGroup>",
      "```bash Infisical Cloud US",
      "infisical login",
      "```",
      "```yaml values.yaml {2} wrap",
      "a: 1",
      "b: 2",
      "```",
      "</CodeGroup>",
      "",
    ].join("\n");
    await withProject({ ...site, "deploy/docker.mdx": page }, async (root) => {
      const report = await migrateProject({ framework: "mintlify", root });
      const converted = await read(root, "deploy/docker.mdx");
      expect(converted).toContain('```bash title="Infisical Cloud US"\n');
      expect(converted).toContain('```yaml title="values.yaml" {2}\n');
      expect(report.diagnostics.map((item) => item.message)).toContain('Code fence metadata "wrap" has no native equivalent and is removed');
    });
  });

  it("keeps Lucide card icons when the project draws Lucide", async () => {
    const docs = JSON.parse(site["docs.json"] as string);
    const lucide = { ...site, "docs.json": JSON.stringify({ ...docs, icons: { library: "lucide" } }), "index.mdx": '---\ntitle: Introduction\n---\n\n<CardGroup cols={2}>\n  <Card title="Refresh" icon="refresh-cw" href="/quickstart">Rotate.</Card>\n  <Card title="Cloud" icon="aws" href="/quickstart">Deploy.</Card>\n</CardGroup>\n' };
    await withProject(lucide, async (root) => {
      const report = await migrateProject({ framework: "mintlify", root });
      expect(await read(root, "sourcey.config.ts")).toContain('theme: {\n    appearance: { default: "dark" },');
      expect(await read(root, "sourcey.config.ts")).toContain('icons: "lucide"');
      expect(await read(root, "index.mdx")).toContain('<Card title="Refresh" icon="refresh-cw" href="/quickstart">Rotate.</Card>');
      expect(await read(root, "index.mdx")).toContain('<Card title="Cloud" href="/quickstart">Deploy.</Card>');
      expect(report.diagnostics.map((item) => item.message)).toContain('<Card> icon "aws" is not carried over');
      expect(report.dependencies.map((item) => item.name)).toContain("lucide-static");
    });
  });

  it("keeps image card icons as the page's paths to them, brands as brand marks, and converts icons in a sentence", async () => {
    const page = [
      "---",
      "title: SDKs",
      "---",
      "",
      "<CardGroup>",
      '  <Card title="Go" icon="/images/sdks/go.svg" href="/quickstart">The Go SDK.</Card>',
      '  <Card title="AWS" icon="aws" iconType="brands">Deploy to AWS.</Card>',
      "</CardGroup>",
      "",
      'Open the <Icon icon="ellipsis-horizontal" size={14} /> menu, or sign in with <Icon icon="github" iconType="brands" />.',
      "",
    ].join("\n");
    await withProject({ ...site, "guides/sdks.mdx": page, "images/sdks/go.svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8"/></svg>\n' }, async (root) => {
      const report = await migrateProject({ framework: "mintlify", root });
      const text = await read(root, "guides/sdks.mdx");
      expect(text).toContain('<Card title="Go" icon="../images/sdks/go.svg" href="/quickstart">The Go SDK.</Card>');
      expect(text).toContain('<Card title="AWS" icon="brand:aws">Deploy to AWS.</Card>');
      expect(text).toContain('Open the <Icon icon="ellipsis-horizontal" /> menu, or sign in with <Icon icon="brand:github" />.');
      expect(report.diagnostics.map((item) => item.message)).toContain('<Icon> "ellipsis-horizontal" has no label, so the page\'s Markdown and assistive technology read the sentence without it; add label="..." to name what it shows. size is not carried over');
      expect(report.dependencies).toContainEqual({ name: "@fortawesome/fontawesome-free", status: "required", detail: "Pages draw Font Awesome brand icons (brand:<name>)." });
    });
    await withProject({ ...site, "guides/sdks.mdx": '---\ntitle: SDKs\n---\n\n<Card title="Go" icon="/images/missing.svg">Go.</Card>\n\nOpen <Icon icon="ellipsis" />.\n' }, async (root) => {
      const error = await migrateProject({ framework: "mintlify", root }).then(() => undefined, (failure: Error) => failure);
      expect(error?.message).toContain("<Card> icon /images/missing.svg is not a file in the project");
      expect(error?.message).toContain('<Icon> icon "ellipsis" is not in the project\'s heroicons set');
    });
  });

  it("converts API pages to a native reference: titles and notes in an overlay, URLs in routes, the API section as its navigation", async () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "Example", version: "1" },
      paths: {
        "/keys": {
          get: { summary: "", description: "Keys in the project.", responses: { 200: { description: "OK" } } },
          post: { responses: { 201: { description: "Created" } } },
        },
        "/keys/{id}": { delete: { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 204: { description: "Deleted" } } } },
        "/health": { get: { responses: { 200: { description: "OK" } } } },
      },
    };
    const api = {
      ...site,
      "docs.json": JSON.stringify({
        name: "Example",
        api: { openapi: "openapi.json" },
        navigation: {
          tabs: [
            { tab: "Guides", groups: [{ group: "Start", pages: ["index"] }] },
            {
              tab: "API Reference",
              groups: [
                { group: "Overview", pages: ["api/introduction"] },
                { group: "Keys", pages: ["api/keys/list", "api/keys/create", "api/keys/all"] },
                { group: "Legacy", pages: ["api/legacy/old"] },
              ],
            },
          ],
        },
      }),
      "openapi.json": JSON.stringify(spec),
      "index.mdx": "---\ntitle: Introduction\n---\n\nWelcome.\n",
      "api/introduction.mdx": "---\ntitle: API introduction\n---\n\nAuthenticate first.\n",
      "api/keys/list.mdx": '---\ntitle: "List keys"\nopenapi: "GET /keys"\n---\n\n<Note>\n  Read the [key guide](/index) first.\n</Note>\n',
      "api/keys/all.mdx": '---\ntitle: "All keys"\nopenapi: "GET /keys"\n---\n\n<Note>\n  Read the [key guide](/index) first.\n</Note>\n',
      "api/keys/create.mdx": '---\ntitle: "Create a key"\nopenapi: "post /keys"\n---\n',
      "api/legacy/old.mdx": '---\ntitle: "Old export"\nopenapi: "GET /export"\n---\n\nUse the new export.\n',
    };
    await withProject(api, async (root) => {
      const report = await migrateProject({ framework: "mintlify", root });
      const config = await read(root, "sourcey.config.ts");
      expect(config).toContain('import { defineConfig, markdown, openapi } from "sourcey";\nimport apiRoutes from "./api.routes.json";\nimport apiNavigation from "./api.navigation.json";');
      expect(config).toContain('{\n        id: "api",\n        tab: "API Reference",\n        slug: "api",\n        source: openapi({\n          spec: "./openapi.json",\n          overlays: ["./api.overlay.yaml"],\n        }),\n        reference: { split: "operations" },\n        routes: apiRoutes,\n        navigation: apiNavigation,\n      },');
      expect(config).toContain('"/api/keys/all": "/api/keys/list"');
      expect(JSON.parse(await read(root, "api.routes.json"))).toEqual({ "GET /keys": "keys/list", "POST /keys": "keys/create" });
      expect(JSON.parse(await read(root, "api.navigation.json"))).toEqual([
        { group: "Overview", id: "api-reference/overview", pages: [{ page: "api/introduction", tab: "docs" }] },
        { group: "Keys", id: "api-reference/keys", pages: [{ operation: "GET /keys" }, { operation: "POST /keys" }, { operation: "GET /keys", label: "All keys" }] },
        { group: "Legacy", id: "api-reference/legacy", pages: [{ page: "api/legacy/old", tab: "docs" }] },
      ]);
      // The notes come first and keep the spec's own description; the operations Mintlify published no page for are removed.
      expect(await read(root, "api.overlay.yaml")).toBe(
        [
          "overlay: 1.0.0",
          "info:",
          "  title: Example API page titles and notes, from Mintlify",
          "  version: 1.0.0",
          "actions:",
          "  - target: $.paths['/keys'].get",
          "    update:",
          "      summary: List keys",
          "      description: |-",
          "        > [!NOTE]",
          "        > Read the [key guide](/index) first.",
          "",
          "        Keys in the project.",
          "  - target: $.paths['/keys'].post",
          "    update:",
          "      summary: Create a key",
          "  - target: $.paths['/keys/{id}']",
          "    remove: true",
          "  - target: $.paths['/health']",
          "    remove: true",
          "",
        ].join("\n"),
      );
      // A page whose operation the spec no longer has stays a page, with its title and notes.
      expect(await read(root, "api/legacy/old.mdx")).toBe('---\ntitle: "Old export"\n---\n\nUse the new export.\n');
      expect(report.diagnostics.map((item) => item.message)).toEqual(
        expect.arrayContaining([
          "1 API page name operations the OpenAPI document no longer has (api/legacy/old.mdx: GET /export); they stay pages with their title and notes",
          'GET /keys has two pages: /api/keys/list is its page and /api/keys/all redirects to it; "All keys" stays its navigation label there',
          "1 operation show Mintlify's notes before the OpenAPI document's description; api.overlay.yaml holds that description as converted, so update it there when the API's own text changes",
          "2 operations Mintlify published no page for are removed in api.overlay.yaml, so the reference publishes what Mintlify did",
          "2 API pages become operations of the native reference at /api, generated from openapi.json: titles and notes in api.overlay.yaml, URLs in api.routes.json, navigation in api.navigation.json",
        ]),
      );
    });
  });

  it("keeps the fragments Mintlify's API pages gave fields and credentials, at the native field showing each", async () => {
    const object = (properties: Record<string, unknown>, required?: string[]) => ({ type: "object", properties, ...(required ? { required } : {}) });
    const spec = {
      openapi: "3.0.3",
      info: { title: "Example", version: "1" },
      components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" }, key: { type: "apiKey", in: "header", name: "X-API-Key" } } },
      paths: {
        "/projects/{project}/keys": {
          post: {
            security: [{ bearer: [] }, { key: [] }],
            parameters: [
              { name: "project", in: "path", required: true, schema: { type: "string" } },
              { name: "dryRun", in: "query", schema: { type: "boolean" } },
              { name: "X-Request-Id", in: "header", schema: { type: "string" } },
            ],
            requestBody: {
              content: {
                "application/json": {
                  schema: object({
                    kmsKeyId: { type: "string" },
                    description: { type: "string", nullable: true },
                    permissions: { type: "array", items: { anyOf: [object({ subject: { type: "string" } }), object({ action: { type: "string" } })] } },
                    credentials: { anyOf: [{ anyOf: [object({ token: { type: "string" } }), object({ code: { type: "string" } })] }, object({ password: { type: "string" } })] },
                    layout: { allOf: [object({ default: { type: "string" } })] },
                    metadata: { nullable: true },
                    labels: { type: "object", additionalProperties: { type: "string" } },
                  }),
                },
              },
            },
            responses: {
              201: { description: "Created", content: { "application/json": { schema: object({ key: object({ id: { type: "string" }, _id: { type: "string" } }, ["_id"]) }) } } },
              400: { description: "Invalid", content: { "application/json": { schema: object({ message: { type: "string" } }) } } },
            },
          },
        },
      },
    };
    const api = {
      ...site,
      "docs.json": JSON.stringify({
        name: "Example",
        api: { openapi: "openapi.json" },
        navigation: { tabs: [{ tab: "Guides", groups: [{ group: "Start", pages: ["index"] }] }, { tab: "API Reference", groups: [{ group: "Keys", pages: ["api/keys/create"] }] }] },
      }),
      "openapi.json": JSON.stringify(spec),
      "index.mdx": "---\ntitle: Introduction\n---\n\nWelcome.\n",
      "api/keys/create.mdx": '---\ntitle: "Create a key"\nopenapi: "POST /projects/{project}/keys"\n---\n',
    };
    await withProject(api, async (root) => {
      const report = await migrateProject({ framework: "mintlify", root });
      const config = await read(root, "sourcey.config.ts");
      expect(config).toContain('import apiAnchors from "./api.anchors.json";');
      expect(config).toContain("        anchors: apiAnchors,\n");
      expect(config).toContain('        anchorUnmatched: "warn",\n');
      const operation = operationFieldRoot({ method: "post", path: "/projects/{project}/keys" });
      const body = (...segments: string[]) => referenceFieldPath(operation, "request-body", "application/json", ...segments);
      const response = (...segments: string[]) => referenceFieldPath(operation, "responses", "201", "content", "application/json", ...segments);
      expect(JSON.parse(await read(root, "api.anchors.json"))).toEqual({
        "POST /projects/{project}/keys": {
          "authorization-authorization": "authentication",
          "authorization-x-api-key": "authentication",
          "parameter-x-request-id": referenceFieldPath(operation, "parameters", "header", "X-Request-Id"),
          "parameter-project": referenceFieldPath(operation, "parameters", "path", "project"),
          "parameter-dry-run": referenceFieldPath(operation, "parameters", "query", "dryRun"),
          "body-kms-key-id": body("properties", "kmsKeyId"),
          // A nullable field's row is the alternative the page shows; null's own spelling exists only once a reader picks it.
          "body-description-one-of-0": body("properties", "description"),
          "body-permissions": body("properties", "permissions"),
          "body-permissions-items-one-of-0-subject": body("properties", "permissions", "items", "anyOf", "0", "properties", "subject"),
          // A union of objects is one row; nested unions flatten into its alternatives.
          "body-credentials": body("properties", "credentials"),
          "body-credentials-one-of-0-token": body("properties", "credentials", "anyOf", "0", "anyOf", "0", "properties", "token"),
          "body-layout": body("properties", "layout"),
          "body-layout-default": body("properties", "layout", "allOf", "0", "properties", "default"),
          "body-metadata": body("properties", "metadata"),
          "body-labels": body("properties", "labels"),
          "body-labels-additional-properties": body("properties", "labels", "additionalProperties"),
          "response-key": response("properties", "key"),
          // Mintlify lists required fields first, so `_id` holds the spelling it shares with `id`.
          "response-key-id": response("properties", "key", "properties", "_id"),
        },
      });
      expect(report.diagnostics.map((item) => item.message)).toEqual(
        expect.arrayContaining([
          "1 original fragment named two fields on their API page (/api/keys/create#response-key-id); each stays with the first, the one a browser opened",
          "1 API page become operations of the native reference at /api, generated from openapi.json: titles and notes in api.overlay.yaml, URLs in api.routes.json, navigation in api.navigation.json, field links in api.anchors.json",
        ]),
      );
    });
  });
});
