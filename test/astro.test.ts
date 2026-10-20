import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { build as bundle, createServer, type Plugin } from "vite";
import sourceyAstro, { prepareAstroSourcey } from "../src/astro/index.js";
import { defineConfig, markdown, openapi } from "../src/index.js";
import { engineAsset, engineHref, publishedSearchRows } from "./built-site.js";

const run = promisify(execFile);
const astroEntry = createRequire(import.meta.url).resolve("astro");
const astroPackage = dirname(createRequire(import.meta.url).resolve("astro/package.json"));
const integration = pathToFileURL(resolve(import.meta.dirname, "../dist/astro/index.js")).href;
const llmsSiteDir = resolve(import.meta.dirname, "llms-site");
const dirUrl = (path: string) => pathToFileURL(path + "/");
const reader = { name: "Reader", theme: { name: "reader", fonts: { google: false } }, navigation: { tabs: [{ tab: "Docs", slug: "", groups: [{ group: "Start", pages: ["introduction", "authorization"] }] }] } };

async function fixture(test: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sourcey-astro-test-"));
  try {
    await mkdir(join(root, "node_modules"));
    await symlink(astroPackage, join(root, "node_modules/astro"));
    await mkdir(join(root, "src/pages/docs"), { recursive: true });
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}');
    await writeFile(join(root, "introduction.md"), "# Introduction\n\nThe documentation stays useful.\n");
    await writeFile(join(root, "authorization.md"), "# Authorization\n\nThe exact permission contract.\n");
    await writeFile(join(root, "src/pages/index.astro"), "<html><body>Host home</body></html>");
    await test(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function build(root: string, mounts: object[], host: object = {}) {
  const script = `import {build} from ${JSON.stringify(pathToFileURL(astroEntry).href)};\nimport sourcey from ${JSON.stringify(integration)};\nawait build({root:new URL('./',import.meta.url),configFile:false,site:'https://host.test',outDir:'./site-output',logLevel:'error',...${JSON.stringify(host)},integrations:${JSON.stringify(mounts)}.map(options=>sourcey({config:${JSON.stringify(reader)},configDir:${JSON.stringify(root)},...options}))});\n`;
  const path = join(root, "build-proof.mjs");
  await writeFile(path, script);
  await run(process.execPath, [path], { cwd: root, maxBuffer: 2 * 1024 * 1024 });
  return (file: string) => readFile(join(root, "site-output", file), "utf8");
}

describe("sourcey/astro", () => {
  it("bundles pages for prerenderers without the build filesystem and writes every other file into the client output", () => fixture(async root => {
    const prepared = join(root, ".sourcey");
    const binary = Buffer.from([0, 255, 128, 13, 10, 0]);
    await mkdir(join(root, "public"));
    await writeFile(join(root, "public/download.bin"), binary);
    await writeFile(join(root, "introduction.md"), "# Introduction\n\nCafé, 日本語 and 🧀 survive packaging.\n");
    const entries: string[] = [], patterns: string[] = [];
    const adapter = sourceyAstro({ config: { ...reader, publicDir: "public" } as never, configDir: root, routeBase: "/docs" });
    await adapter.hooks["astro:config:setup"]!({
      command: "build",
      config: { root: dirUrl(root), publicDir: dirUrl(join(root, "host-public")), build: { format: "directory" }, redirects: {} },
      createCodegenDir: () => dirUrl(prepared), addWatchFile() {}, updateConfig() {},
      injectRoute({ entrypoint, pattern }: { entrypoint: string | URL; pattern: string }) { entries.push(String(entrypoint)); patterns.push(pattern); },
    } as never);
    // Only pages are routes: the page entry, and the endpoint for none of them here.
    expect(new Set(entries.map(entry => entry.slice(entry.lastIndexOf("/") + 1)))).toEqual(new Set(["page.astro"]));
    expect(patterns).toContain("/docs/introduction");
    expect(patterns).not.toContain("/docs/404");
    const client = join(root, "client");
    await adapter.hooks["astro:build:generated"]!({ dir: dirUrl(client) } as never);
    expect(await readFile(join(client, "docs/download.bin"))).toEqual(binary);
    expect(await readFile(await engineAsset(join(client, "docs"), "sourcey.css"), "utf8")).toContain("#sourcey");
    // The page entry is Astro markup; its bridge, beside it, is what a prerenderer imports.
    await writeFile(join(root, "page-entry.mjs"), `import {response} from ${JSON.stringify(pathToFileURL(join(dirname(entries[0]), "bridge.js")).href)};\nexport const GET=({url})=>response(url);\n`);
    await bundle({
      root, configFile: false, publicDir: false, logLevel: "silent",
      build: { ssr: join(root, "page-entry.mjs"), outDir: join(root, "bundle"),
        rollupOptions: { output: { entryFileNames: "endpoint.mjs", chunkFileNames: "chunks/[name]-[hash].mjs" } } },
    });
    await rm(prepared, { recursive: true });
    const { GET } = await import(pathToFileURL(join(root, "bundle/endpoint.mjs")).href);
    const page = await GET({ url: new URL("https://host.test/docs/introduction/") });
    expect(await page.text()).toContain("Café, 日本語 and 🧀 survive packaging.");
    // The missing-page page is not indexed, so it is a file in the output rather than a route the host's sitemap lists.
    expect(await readFile(join(client, "docs/404/index.html"), "utf8")).toContain('name="robots" content="noindex');
    await expect(GET({ url: new URL("https://host.test/docs/404") })).rejects.toThrow("Unknown Sourcey artifact");
  }));

  it("registers redirects through the real host router under its base without injecting duplicate pages", () => fixture(async root => {
    const config = { ...reader, redirects: { "/project/docs/old": "/project/docs/introduction/", "/project/docs/home": "/project/" } };
    const output = await build(root, [{ routeBase: "/docs", config }], { base: "/project/", build: { format: "directory" } });
    expect(await output("docs/old/index.html")).toContain("/project/docs/introduction/");
    expect(await output("docs/home/index.html")).toContain("/project/");
    await expect(output("project/docs/old/index.html")).rejects.toThrow();
    await expect(output("docs/_redirects")).rejects.toThrow();
  }));

  it("registers two real mounts, preserves host pages and emits native HTML, endpoints and status pages", () => fixture(async root => {
    await writeFile(join(root, "src/pages/docs/index.astro"), "<html><body>Host docs landing</body></html>");
    const output = await build(root, [
      { routeBase: "/docs", landingPage: false, prettyUrls: "slash" },
      { routeBase: "/reference", prettyUrls: false },
    ], { base: "/project/", build: { format: "directory" } });
    expect(await output("index.html")).toContain("Host home");
    expect(await output("docs/index.html")).toContain("Host docs landing");
    expect(await output("docs/introduction/index.html")).toContain("The documentation stays useful.");
    expect(await output("reference/introduction.html")).toContain('data-sourcey-theme="reader"');
    const alias = await output("reference/index.html");
    expect(alias).toContain('href="https://host.test/project/reference/introduction.html"');
    expect(engineHref(alias, "sourcey.css")).toMatch(/^\/project\/reference\/_assets\//);
    expect(engineHref(alias, "sourcey.js")).toMatch(/^\/project\/reference\/_assets\//);
    const head = alias.slice(0, alias.indexOf("</head>"));
    expect(engineHref(head, "sourcey-theme.js")).toMatch(/^\/project\/reference\/_assets\//);
    expect(head).toContain('data-default="system"');
    for (const [, attrs] of alias.matchAll(/<script([^>]*)>(?!<\/script>)/g)) expect(attrs).toMatch(/\bsrc=|type="application\/ld\+json"/);
    expect(await output("docs/introduction/index.md")).toContain("The documentation stays useful.");
    expect((await publishedSearchRows(join(root, "site-output/docs")))[0].url).toMatch(/^\/project\/docs\//);
    expect(await output("docs/404/index.html")).toContain('name="robots" content="noindex');
    expect(await output("docs/sitemap.xml")).not.toContain("/404");
  }));

  it("preserves strip-mode authored indexes with landingPage off and resolves assets at their public base", () => fixture(async root => {
    const config = { ...reader, navigation: { tabs: [{ tab: "Docs", slug: "", groups: [{ group: "Start", pages: ["index", "authorization"] }] }] } };
    await writeFile(join(root, "index.md"), "# Overview\n\nAn authored index is a real document.\n");
    const output = await build(root, [{ routeBase: "/docs", config, prettyUrls: "strip", landingPage: false }], { base: "/project/", build: { format: "file" } });
    const html = await output("docs.html");
    expect(html).toContain("An authored index is a real document.");
    expect(engineHref(html, "sourcey.css")).toMatch(/^\/project\/docs\/_assets\//);
    expect(html).toContain('href="/project/docs/authorization"');
    expect(html).not.toContain('href="/project/docs/authorization/"');
    expect(await output("docs/authorization.html")).toContain("The exact permission contract.");
  }));

  it("refuses to shadow an authored host route", () => fixture(async root => {
    await writeFile(join(root, "src/pages/docs/index.astro"), "<html><body>Host owns this</body></html>");
    await expect(build(root, [{ routeBase: "/docs" }])).rejects.toThrow("Sourcey route conflicts with host");
  }));

  it("retains shared source configuration under the host origin and base", async () => {
    const prepared = await prepareAstroSourcey({ configDir: llmsSiteDir, routeBase: "/docs", config: defineConfig({ name: "Shared Docs", navigation: { tabs: [
      { tab: "Docs", slug: "", source: markdown({ groups: [{ group: "Guides", pages: ["introduction"] }] }) },
      { tab: "API", slug: "api", source: openapi("../fixtures/petstore-openapi3.yaml") },
    ] } }) }, { root: dirUrl(resolve(import.meta.dirname, "..")), site: "https://sourcey.com", base: "/product" });
    expect(prepared.routeBase).toBe("/docs/");
    expect(prepared.outputRoute).toBe("docs");
    expect(prepared.config.siteUrl).toBe("https://sourcey.com");
    expect(prepared.config.baseUrl).toBe("/product/docs/");
    expect(prepared.config.contexts[0].tabs[0].source.kind).toBe("markdown");
    expect(prepared.watchPaths.some(path => path.endsWith("introduction.md"))).toBe(true);
  });

  it.each([true, false])("serves real development documents and leaves host ownership intact (landingPage=%s)", landingPage => fixture(async root => {
    let plugins: Plugin[] = [];
    const adapter = sourceyAstro({ config: reader as never, configDir: root, routeBase: "/docs", prettyUrls: "strip", landingPage });
    await adapter.hooks["astro:config:setup"]!({ command: "dev", config: { root: dirUrl(root) }, createCodegenDir: () => dirUrl(join(root, ".sourcey")), addWatchFile() {}, updateConfig(config) { plugins = config.vite?.plugins as Plugin[] ?? []; } } as never);
    const server = await createServer({ configFile: false, root, appType: "custom", plugins, server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
    try {
      await server.listen();
      const origin = server.resolvedUrls!.local[0];
      expect((await fetch(new URL("/docs", origin))).status).toBe(landingPage ? 200 : 404);
      const response = await fetch(new URL("/docs/introduction", origin));
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toContain('data-sourcey-theme="reader"');
      const index = await (await fetch(new URL("/docs/documents.json", origin))).json();
      const intro = index.documents.find((entry: { title: string }) => entry.title === "Introduction");
      const markdown = await fetch(new URL(intro.markdown, origin));
      expect(markdown.headers.get("link")).toContain('rel="canonical"');
      expect(await markdown.text()).toContain("The documentation stays useful.");
      expect((await fetch(new URL("/docs/404", origin))).status).toBe(404);
    } finally { await server.close(); }
  }));
});
