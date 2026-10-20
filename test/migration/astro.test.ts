import { describe, expect, it } from "vitest";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { migrateProject, MigrationError } from "../../src/migration/index.js";
import { read, withProject } from "./helpers.js";

const starlight = {
  "package.json": JSON.stringify({ name: "docs", type: "module", scripts: { build: "astro build" } }),
  "astro.config.mjs": [
    "import { defineConfig } from 'astro/config';",
    "import starlight from '@astrojs/starlight';",
    "",
    "export default defineConfig({",
    "\tintegrations: [",
    "\t\tstarlight({",
    "\t\t\ttitle: 'Example',",
    "\t\t\tdisable404Route: true,",
    "\t\t\tsocial: [{ icon: 'discourse', label: 'Community Forum', href: 'https://community.example.com' }, { icon: 'github', label: 'GitHub', href: 'https://github.com/example/docs' }, { icon: 'blueSky', label: 'BlueSky', href: 'https://bsky.app/profile/example.com' }],",
    "\t\t\teditLink: { baseUrl: 'https://github.com/example/docs/edit/main/' },",
    "\t\t\tsidebar: [",
    "\t\t\t\t{ label: 'Start', translations: { fr: 'Démarrer' }, items: [{ label: 'Welcome', link: '/' }, 'guides/api_usage'] },",
    "\t\t\t\t{ label: 'Reference', autogenerate: { directory: 'reference' } },",
    "\t\t\t],",
    "\t\t\tdefaultLocale: 'root',",
    "\t\t\tlocales: { root: { label: 'English', lang: 'en' }, fr: { label: 'Français' } },",
    "\t\t}),",
    "\t],",
    "});",
    "",
  ].join("\n"),
  "src/content.config.ts": [
    "import { defineCollection } from 'astro:content';",
    "import { docsLoader } from '@astrojs/starlight/loaders';",
    "import { docsSchema } from '@astrojs/starlight/schema';",
    "",
    "export const collections = { docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }) };",
    "",
  ].join("\n"),
  "src/content/docs/index.mdx": [
    "---",
    "title: Welcome",
    "template: doc",
    "---",
    "",
    "import { LinkCard } from '@astrojs/starlight/components';",
    "",
    ":::tip[Try it]",
    "Open the demo.",
    ":::",
    "",
    '<LinkCard title="API usage" href="/guides/api_usage/" description="Call the API." />',
    "",
  ].join("\n"),
  "src/content/docs/guides/api_usage.md": "---\ntitle: API usage\n---\n\n## Requests\n\nSend a request to `example.com:5000/translate`.\n",
  "src/content/docs/reference/b.md": "---\ntitle: Beta\nsidebar:\n  order: 1\n---\n\nSecond file, first in order.\n",
  "src/content/docs/reference/a.md": "---\ntitle: Alpha\n---\n\nFirst file.\n",
  "src/content/docs/reference/http_codes.md": "---\ntitle: HTTP codes\n---\n\nStatus codes.\n",
  "src/content/docs/guides/Setup.md": "---\ntitle: Setup\n---\n\nStarlight lowercases this file's route.\n",
  "src/content/docs/fr/index.mdx": "---\ntitle: Bienvenue\n---\n\nBonjour.\n",
};

const CONFIG = `import { defineConfig, markdown } from "sourcey";

export default defineConfig({
  name: "Example",
  repo: "https://github.com/example/docs",
  editBranch: "main",
  theme: {
    fonts: { sans: "system" },
  },
  prettyUrls: "slash",
  i18n: {
    defaultLocale: "en",
    locales: {
      en: { label: "English" },
      fr: {
        label: "Français",
        messages: {
          navigation: { start: "Démarrer" },
        },
      },
    },
  },
  navbar: {
    links: [
      {
        type: "discourse",
        href: "https://community.example.com",
        label: "Community Forum",
      },
      { type: "github", href: "https://github.com/example/docs" },
      { type: "bluesky", href: "https://bsky.app/profile/example.com" },
    ],
  },
  navigation: {
    tabs: [
      {
        tab: "Documentation",
        slug: "",
        source: markdown({
          root: "src/content/docs",
          slugs: "file",
          groups: [
            {
              group: "Start",
              id: "start",
              pages: [
                { page: "index", label: "Welcome" },
                "guides/api_usage",
                { page: "guides/Setup", hidden: true },
              ],
            },
            {
              group: "Reference",
              id: "reference",
              pages: ["reference/b", "reference/a", "reference/http_codes"],
            },
          ],
        }),
      },
    ],
  },
  markdown: { smartypants: true },
});
`;

describe("sourcey migrate astro (Starlight)", () => {
  it("prepares a verified native project without writing it on a dry run", async () => {
    await withProject(starlight, async (root) => {
      const report = await migrateProject({ framework: "astro", root, dryRun: true });
      expect(report.applied).toBe(false);
      expect(report.routes.map((route) => route.source).sort()).toEqual([
        "/",
        "/fr/",
        "/guides/api_usage/",
        "/guides/setup/",
        "/reference/a/",
        "/reference/b/",
        "/reference/http_codes/",
      ]);
      expect(report.changed).toEqual([
        "astro.config.mjs",
        "sourcey.config.ts",
        "src/content.config.ts",
        "src/content/docs/guides/Setup.md",
        "src/content/docs/index.mdx",
        "src/content/docs/reference/b.md",
      ]);
      expect(report.dependencies.map((dependency) => [dependency.name, dependency.status])).toEqual([
        ["sourcey", "required"],
        ["@astrojs/starlight", "unused-after-migration"],
      ]);
      expect(await read(root, "astro.config.mjs")).toContain("starlight(");
    });
  });

  it("typesets Markdown as the Astro site did: only a site that turns SmartyPants off keeps straight quotes", async () => {
    const plain = { ...starlight, "astro.config.mjs": starlight["astro.config.mjs"].replace("export default defineConfig({\n", "export default defineConfig({\n\tmarkdown: { smartypants: false },\n") };
    await withProject(plain, async (root) => {
      await migrateProject({ framework: "astro", root });
      expect(await read(root, "sourcey.config.ts")).not.toContain("smartypants");
    });
  });

  it("writes native configuration, navigation and only the document edits routes need", async () => {
    await withProject(starlight, async (root) => {
      await migrateProject({ framework: "astro", root });
      expect(await read(root, "astro.config.mjs")).toBe(
        [
          "import { defineConfig } from 'astro/config';",
          'import sourcey from "sourcey/astro";',
          "",
          "export default defineConfig({",
          "\tintegrations: [",
          '\t\tsourcey({ routeBase: "/", allowRootOutput: true }),',
          "\t],",
          "});",
          "",
        ].join("\n"),
      );
      expect(await read(root, "sourcey.config.ts")).toBe(CONFIG);
      // Native keeps file names as routes; only the file Starlight lowercased needs its slug.
      expect(await read(root, "src/content/docs/guides/api_usage.md")).toBe(starlight["src/content/docs/guides/api_usage.md"]);
      expect(await read(root, "src/content/docs/guides/Setup.md")).toBe("---\ntitle: Setup\nslug: guides/setup\n---\n\nStarlight lowercases this file's route.\n");
      expect(await read(root, "src/content/docs/index.mdx")).toBe(
        [
          "---",
          "title: Welcome",
          "---",
          "",
          ":::tip[Try it]",
          "Open the demo.",
          ":::",
          "",
          '<Card title="API usage" href="/guides/api_usage/">Call the API.</Card>',
          "",
        ].join("\n"),
      );
      expect(await read(root, "src/content/docs/fr/index.mdx")).toBe("---\ntitle: Bienvenue\n---\n\nBonjour.\n");
      await expect(access(join(root, "src/content.config.ts"))).rejects.toThrow();
      await expect(migrateProject({ framework: "astro", root, dryRun: true })).resolves.toMatchObject({ changed: [] });
    });
  });

  it("draws a splash page as page, its title above the body as Starlight drew it", async () => {
    const splash = { ...starlight, "src/content/docs/index.mdx": starlight["src/content/docs/index.mdx"].replace("template: doc", "template: splash") };
    await withProject(splash, async (root) => {
      await migrateProject({ framework: "astro", root });
      expect(await read(root, "src/content/docs/index.mdx")).toBe(
        ["---", "title: Welcome", "layout: page", "---", "", "# Welcome", "", ":::tip[Try it]", "Open the demo.", ":::", "", '<Card title="API usage" href="/guides/api_usage/">Call the API.</Card>', ""].join("\n"),
      );
    });
  });

  it("mounts documentation kept under a directory there, beside the host's own pages", async () => {
    await withProject(
      {
        "package.json": JSON.stringify({ name: "site", type: "module" }),
        "astro.config.mjs": "import { defineConfig } from 'astro/config';\nimport starlight from '@astrojs/starlight';\n\nexport default defineConfig({ integrations: [starlight({ title: 'Site', disable404Route: true })] });\n",
        "src/pages/index.astro": "<h1>Home</h1>\n",
        "src/content/docs/docs/index.md": "---\ntitle: About\n---\n\nAbout.\n",
        "src/content/docs/docs/help/logs.md": "---\ntitle: Logs\n---\n\nLogs.\n",
      },
      async (root) => {
        const report = await migrateProject({ framework: "astro", root, dryRun: true });
        expect(report.routes.map((route) => route.source).sort()).toEqual(["/docs/", "/docs/help/logs/"]);
        const astro = report.changes.find((change) => change.path === "astro.config.mjs")!.bytes!.toString();
        expect(astro).toContain('sourcey({ routeBase: "/docs" })');
      },
    );
  });

  it("draws the site title beside a Starlight logo unless the logo replaces it", async () => {
    const config = async (logo: string) => {
      let text = "";
      await withProject(
        {
          "package.json": JSON.stringify({ name: "site", type: "module" }),
          "astro.config.mjs": `import { defineConfig } from 'astro/config';\nimport starlight from '@astrojs/starlight';\n\nexport default defineConfig({ integrations: [starlight({ title: 'Site', logo: ${logo} })] });\n`,
          "src/assets/logo.svg": "<svg/>\n",
          "src/content/docs/index.md": "---\ntitle: Home\n---\n\nHello.\n",
        },
        async (root) => {
          const report = await migrateProject({ framework: "astro", root, dryRun: true });
          text = report.changes.find((change) => change.path === "sourcey.config.ts")!.bytes!.toString();
        },
      );
      return text.match(/logo: [^\n]*/)?.[0];
    };
    expect(await config("{ src: './src/assets/logo.svg' }")).toBe('logo: { light: "./src/assets/logo.svg", mark: true },');
    expect(await config("{ src: './src/assets/logo.svg', replacesTitle: true }")).toBe('logo: "./src/assets/logo.svg",');
  });

  it("keeps Astro 5's heading fragments, which drop a trailing hyphen", async () => {
    await withProject(
      {
        ...starlight,
        "package.json": JSON.stringify({ name: "docs", type: "module", dependencies: { astro: "^5.11.0" } }),
        "src/content/docs/fr/index.mdx": "---\ntitle: Bienvenue\n---\n\n## Puis-je l’utiliser en production ?\n\nOui.\n",
      },
      async (root) => {
        await migrateProject({ framework: "astro", root });
        expect(await read(root, "src/content/docs/fr/index.mdx")).toBe(
          "---\ntitle: Bienvenue\n---\n\n## Puis-je l’utiliser en production ? {#puis-je-lutiliser-en-production}\n\nOui.\n",
        );
      },
    );
  });

  it("keeps starlight-openapi operation URLs and fragments as native routes and section aliases", async () => {
    const spec = {
      swagger: "2.0",
      info: { title: "Translate", version: "1.0" },
      paths: {
        "/translate": {
          post: {
            summary: "Translate text",
            parameters: [{ name: "q", in: "formData", type: "string", required: true }],
            responses: { 200: { description: "Translation" }, 400: { description: "Invalid request" } },
          },
        },
        "/languages": { get: { operationId: "listLanguages", summary: "Languages", responses: { 200: { description: "Languages" } } } },
        "/items": {
          get: { summary: "List items", responses: { 200: { description: "Items" } } },
          delete: { summary: "Delete items", responses: { 204: { description: "Deleted" } } },
        },
      },
    };
    await withProject(
      {
        ...starlight,
        "astro.config.mjs": starlight["astro.config.mjs"]
          .replace("import starlight from '@astrojs/starlight';", "import starlight from '@astrojs/starlight';\nimport starlightOpenAPI from 'starlight-openapi';")
          .replace("disable404Route: true,", "disable404Route: true,\n\t\t\tplugins: [starlightOpenAPI([{ base: 'api', schema: './spec.json' }])],"),
        "spec.json": JSON.stringify(spec),
      },
      async (root) => {
        const report = await migrateProject({ framework: "astro", root, dryRun: true });
        const config = report.changes.find((change) => change.path === "sourcey.config.ts")!.bytes!.toString();
        expect(config).toContain(
          [
            "      {",
            '        tab: "API",',
            '        slug: "api",',
            '        source: openapi("./spec.json"),',
            '        reference: { split: "operations", operations: "operations/{operation}" },',
            "        routes: {",
            '          "GET /items": "operations/items/get",',
            '          "DELETE /items": "operations/items/delete",',
            "        },",
            "        anchors: {",
            '          introduction: { overview: "introduction" },',
            '          "POST /translate": {',
            '            "200": "response-200",',
            '            "400": "response-400",',
            '            parameters: "request-body",',
            '            "formdata-parameters": "request-body",',
            "          },",
          ].join("\n"),
        );
      },
    );
  });

  it("stops with the location of an option it cannot convert", async () => {
    await withProject(
      { ...starlight, "astro.config.mjs": starlight["astro.config.mjs"].replace("title: 'Example',", "title: 'Example',\n\t\t\tcomponents: { Footer: './Footer.astro' },") },
      async (root) => {
        const failure = await migrateProject({ framework: "astro", root }).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(MigrationError);
        expect((failure as MigrationError).diagnostics.map((item) => [item.file, item.line, item.message])).toEqual([
          ["astro.config.mjs", 8, 'Starlight option "components" has no native conversion'],
        ]);
        expect(await read(root, "astro.config.mjs")).toContain("components: { Footer");
      },
    );
  });
});
