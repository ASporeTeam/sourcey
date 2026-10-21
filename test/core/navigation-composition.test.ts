import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { markdown, openapi } from "../../src/adapters/index.js";
import { loadConfig, resolveConfigFromRaw } from "../../src/config.js";
import { buildSourceySite, sourceyArtifacts, updateSourceySite } from "../../src/site.js";
import { walkNavItems } from "../../src/core/navigation.js";

function api(title = "List your pets") {
  return { openapi: "3.1.0", info: { title: "Pet API", version: "fixture" }, paths: {
    "/pets": { get: { summary: title, responses: { "200": { description: "Success" } } }, post: { summary: "Add a pet", responses: { "201": { description: "Created" } } } },
  } };
}
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sourcey-navigation-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function file(root: string, path: string, text: string) {
  await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text);
}

describe("canonical navigation composition", () => {
  for (const mode of ["single", "split"] as const) it(`resolves authored operation order and cross-source PageCards under ${mode}`, () => fixture(async root => {
    await file(root, "api.json", JSON.stringify(api()));
    await file(root, "guide.md", '---\nid: install\nslug: getting-started\ntitle: Install\n---\n# Install\n\n<PageCards section="keys" />\n');
    const config = await resolveConfigFromRaw({ baseUrl: "/manual", prettyUrls: "slash", theme: { fonts: { google: false } }, navigation: { tabs: [
      { id: "guides", tab: "Guides", slug: "", source: markdown({ groups: [{ group: "Reference", id: "keys", pages: ["guide", { operation: "GET /pets", reference: "rest" }] }] }) },
      { id: "rest", tab: "API", slug: "api", source: openapi("api.json"), reference: mode === "split" ? { split: "operations" } : {}, routes: { introduction: "reference", "GET /pets": "pets/all" }, navigation: [
        { group: "Start", pages: [{ page: "guide", tab: "guides" }, { page: "introduction" }] },
        { group: "Pets", pages: [{ operation: "POST /pets" }, { group: "Read", pages: [{ operation: "GET /pets" }] }] },
      ] },
    ] } }, root);
    const site = await buildSourceySite({ config, generateOgImages: false });
    const destination = site.pages.find(page => page.tabSlug === "api")!.referenceTargets!.operations["GET /pets"].href;
    expect(destination).toBe(mode === "split" ? "/manual/api/pets/all/" : "/manual/api/reference/#operation-pets-get");
    const apiNav = site.navigation.tabs.find(tab => tab.slug === "api")!;
    expect(apiNav.href).toBe("/manual/api/reference/");
    expect([...walkNavItems(apiNav.groups)].map(item => item.label)).toEqual(["Install", "Pet API", "Add a pet", "List your pets"]);
    expect([...walkNavItems(apiNav.groups)].at(-1)).toMatchObject({ href: destination, method: "get" });
    const guide = site.pages.find(page => page.identity.document === "install")!;
    if (guide.currentPage.kind !== "markdown") throw new Error("Expected guide");
    const href = guide.currentPage.markdown.html.match(/class="card-item-link" href="([^"]+)"/)![1];
    const resolved = new URL(href, "https://docs.example.test" + guide.publicPath);
    expect(resolved.pathname + resolved.hash).toBe(destination);
    expect(guide.currentPage.markdown.html).toContain("List your pets");
    const files = await sourceyArtifacts(site);
    expect(files.get(guide.outputPath)!.toString()).toContain(`class="card-item-link" href="${href}"`);
    expect(site.pages.filter(page => page.currentPage.kind === "spec")).toHaveLength(mode === "split" ? 3 : 1);
    expect([...site.assembly.routes.byPath.values()].every(route => !route.publicPath.includes("undefined"))).toBe(true);
    await file(root, "api.json", JSON.stringify(api("Browse the pet collection")));
    const edited = await updateSourceySite(site, [join(root, "api.json")]);
    const changed = edited.pages.find(page => page.identity.document === "install")!;
    expect(changed.currentPage.kind === "markdown" && changed.currentPage.markdown.html).toContain("Browse the pet collection");
    expect(guide.currentPage.markdown.html).toContain("List your pets");
  }));

  it("uses the matching version and locale of an explicitly named reference", () => fixture(async root => {
    for (const [prefix, title] of [["", "Current English"], ["archive/", "Archived English"]]) {
      await file(root, prefix + "api.json", JSON.stringify(api(title)));
      await file(root, prefix + "fr.json", JSON.stringify(api(prefix ? "Français archivé" : "Français actuel")));
      await file(root, prefix + "guide.md", "# Guide\n");
    }
    const config = await resolveConfigFromRaw({ prettyUrls: "slash", theme: { fonts: { google: false } },
      versions: { default: "current", items: [{ id: "current", label: "Current" }, { id: "archive", label: "Archive", content: "archive", path: "archive" }] },
      i18n: { defaultLocale: "en", locales: { en: { label: "English" }, fr: { label: "Français" } } },
      navigation: { tabs: [
        { id: "guides", tab: "Guides", slug: "", groups: [{ group: "Start", pages: ["guide", { operation: "GET /pets", reference: "rest" }] }] },
        { id: "rest", tab: "API", source: openapi("api.json"), translations: { fr: openapi("fr.json") }, reference: { split: "operations" } },
      ] },
    }, root);
    const site = await buildSourceySite({ config, generateOgImages: false });
    const guides = site.pages.filter(page => page.identity.tab === "guides" && page.identity.document === "guide");
    expect(guides).toHaveLength(4);
    for (const page of guides) {
      const item = [...walkNavItems(page.navigation!.tabs.find(tab => tab.slug === page.tabSlug)!.groups)].find(item => item.method === "get")!;
      const prefix = [page.context.locale === "fr" ? "fr" : "", page.context.version.id === "archive" ? "archive" : "", "api"].filter(Boolean).join("/");
      expect(item.href).toBe(`/${prefix}/operations/operation-pets-get/`);
      expect(item.label).toBe(page.context.locale === "fr" ? page.context.version.id === "archive" ? "Français archivé" : "Français actuel" : page.context.version.id === "archive" ? "Archived English" : "Current English");
    }
  }));

  it("fails on missing operations and source owners instead of emitting a dead link", () => fixture(async root => {
    await file(root, "api.json", JSON.stringify(api()));
    for (const target of [{ operation: "GET /gone" }, { operation: "GET /pets", reference: "absent" }, { page: "not-a-document" }]) {
      const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, navigation: { tabs: [{ id: "rest", tab: "API", source: openapi("api.json"), navigation: [{ group: "API", pages: [target] }] }] } }, root);
      await expect(buildSourceySite({ config, generateOgImages: false })).rejects.toThrow(/Navigation in rest/);
    }
  }));

  it("gives a large authored reference real section destinations containing final operation links", () => fixture(async root => {
    const paths = Object.fromEntries(Array.from({ length: 44 }, (_, index) => [`/pets/${index}`, { get: { summary: `Pet ${index}`, responses: { "200": { description: "Success" } } } }]));
    await file(root, "api.json", JSON.stringify({ ...api(), paths }));
    const config = await resolveConfigFromRaw({ prettyUrls: "slash", theme: { fonts: { google: false } }, i18n: { defaultLocale: "fr", locales: { fr: { label: "Français", messages: { navigation: { "group-0": "Famille zéro" } } } } }, navigation: { tabs: [{ id: "rest", tab: "API", source: openapi("api.json"), reference: { split: "operations" }, navigation: Array.from({ length: 22 }, (_, index) => ({ group: `Group ${index}`, id: `group-${index}`, pages: [{ operation: `GET /pets/${index * 2}` }, { operation: `GET /pets/${index * 2 + 1}` }] })) }] } }, root);
    const site = await buildSourceySite({ config, generateOgImages: false });
    const sections = site.pages.filter(page => page.identity.document.startsWith("section:"));
    expect(sections).toHaveLength(22);
    expect(sections.find(page => page.identity.document === "section:group-0")!.currentPage).toMatchObject({ kind: "markdown", markdown: { title: "Famille zéro" } });
    for (const page of sections) {
      if (page.currentPage.kind !== "markdown") throw new Error("Expected section page");
      expect(page.currentPage.markdown.html).toContain("/operations/operation-pets-");
      expect(page.currentPage.markdown.html).not.toContain('href=""');
    }
    expect(JSON.stringify(site.searchRows)).toContain("Group 21");
    expect(site.navigation.tabs[0].sectionIndex?.href).toBe("/api/_sections/index/");
  }));

  it("reloads imported route and navigation data without changing the earlier compilation", () => fixture(async root => {
    await file(root, "api.json", JSON.stringify(api()));
    await file(root, "reference-navigation.json", JSON.stringify([{ group: "Pets", pages: [{ operation: "GET /pets" }] }]));
    await file(root, "reference-routes.json", JSON.stringify({ "GET /pets": "pets" }));
    await file(root, "sourcey.config.ts", `import {openapi} from ${JSON.stringify(new URL("../../src/adapters/index.ts", import.meta.url).pathname)};
import navigation from './reference-navigation.json';
import routes from './reference-routes.json';
export default {theme:{fonts:{google:false}}, navigation:{tabs:[{id:'rest',tab:'API',source:openapi('./api.json'),reference:{split:'operations'},routes,navigation}]}};
`);
    const config = await loadConfig(root);
    expect(config.configDependencies).toContain(await realpath(join(root, "reference-navigation.json")));
    expect(config.configDependencies).toContain(await realpath(join(root, "reference-routes.json")));
    const first = await buildSourceySite({ config, generateOgImages: false });
    await file(root, "reference-navigation.json", JSON.stringify([{ group: "Pets", pages: [{ operation: "GET /pets", label: "Your pet collection" }] }]));
    await file(root, "reference-routes.json", JSON.stringify({ "GET /pets": "pets/list" }));
    const next = await updateSourceySite(first, [join(root, "reference-navigation.json"), join(root, "reference-routes.json")]);
    expect(next.assembly.routes.match("/api/pets/list.html")).toBeDefined();
    expect(next.assembly.routes.match("/api/pets.html")).toBeUndefined();
    expect([...walkNavItems(next.navigation.tabs[0].groups)][0].label).toBe("Your pet collection");
    expect([...walkNavItems(first.navigation.tabs[0].groups)][0].label).toBe("List your pets");
  }));

  for (const mode of ["single", "split"] as const) it(`lands prose, card and changelog links to operations on their ${mode} destinations, and keeps each operation's address`, () => fixture(async root => {
    await file(root, "api.json", JSON.stringify(api()));
    await file(root, "guide.md", '# Guide\n\nSee [the list](<operation:GET /pets>).\n\n<Card title="Add one" href="operation:POST /pets">Create a pet.</Card>\n');
    await file(root, "CHANGELOG.md", "# Changelog\n\n## 1.0.0 - 2026-01-01\n\n### Added\n\n- [Listing pets](<operation:GET /pets>).\n");
    const config = await resolveConfigFromRaw({ prettyUrls: "slash", theme: { fonts: { google: false } }, navigation: { tabs: [
      { id: "guides", tab: "Guides", slug: "", groups: [{ group: "Start", pages: ["guide", "CHANGELOG"] }] },
      { id: "rest", tab: "API", slug: "api", source: openapi("api.json"), reference: { ...(mode === "split" ? { split: "operations" as const } : {}), operations: "pets/{method}" } },
    ] } }, root);
    const site = await buildSourceySite({ config, generateOgImages: false });
    const files = await sourceyArtifacts(site);
    const lands = (page: (typeof site.pages)[number], href: string) => { const url = new URL(href, "https://docs.example.test" + page.publicPath); return url.pathname + url.hash; };
    const list = mode === "split" ? "/api/pets/get/" : "/api/#operation-pets-get";
    const add = mode === "split" ? "/api/pets/post/" : "/api/#operation-pets-post";
    const guide = site.pages.find(page => page.identity.document === "guide")!;
    if (guide.currentPage.kind !== "markdown") throw new Error("Expected guide");
    expect([...guide.currentPage.markdown.html.matchAll(/href="([^"]+)"/g)].map(match => lands(guide, match[1]))).toEqual([list, add]);
    expect(files.get(guide.outputPath)!.toString()).not.toContain("operation:");
    expect(guide.currentPage.markdown.markdown).toContain(`[the list](${mode === "split" ? "/api/pets/get/" : "/api/#operation-pets-get"})`);
    const changelog = site.pages.find(page => page.currentPage.kind === "changelog")!;
    if (changelog.currentPage.kind !== "changelog") throw new Error("Expected changelog");
    const entry = changelog.currentPage.changelog.changelog.versions[0].sections[0].entries[0];
    expect(lands(changelog, entry.html.match(/href="([^"]+)"/)![1])).toBe(list);
    if (mode === "single") {
      // One page keeps each operation's own address as a redirect to its section.
      expect(site.assembly.routes.redirectFor("/api/pets/get/")).toMatchObject({ to: "/api/#operation-pets-get", status: 301 });
      expect(files.has("api/pets/get/index.html")).toBe(true);
    } else {
      // The overview keeps each operation's single-page anchor on its entry, once.
      const overview = files.get("api/index.html")!.toString();
      expect(overview.match(/id="operation-pets-get"/g)).toHaveLength(1);
      expect(site.assembly.routes.match("/api/")!.anchors.has("operation-pets-get")).toBe(true);
      expect(site.assembly.routes.redirectFor("/api/pets/get/")).toBeUndefined();
    }
  }));

  it("leads a tab to its first destination, a section's own page first, and a reference to its overview", () => fixture(async root => {
    await file(root, "api.json", JSON.stringify(api()));
    await file(root, "start/index.md", "# Getting started\n");
    await file(root, "start/install.md", "# Install\n");
    const config = await resolveConfigFromRaw({ prettyUrls: "slash", theme: { fonts: { google: false } }, navigation: { tabs: [
      { id: "docs", tab: "Docs", slug: "", groups: [{ group: "Getting started", href: "/start/", collapsed: true, pages: [{ page: "start", hidden: true }, "start/install"] }] },
      { id: "rest", tab: "API", slug: "api", source: openapi("api.json"), reference: { split: "operations" }, navigation: [{ group: "Pets", pages: [{ operation: "GET /pets" }] }] },
    ] } }, root);
    const site = await buildSourceySite({ config, generateOgImages: false });
    expect(site.navigation.tabs.map(tab => tab.href)).toEqual(["/start/", "/api/"]);
    // On its own page, the section is open and its heading current.
    const nav = (await sourceyArtifacts(site)).get("start/index.html")!.toString().match(/<nav id="nav"[\s\S]*?<\/nav>/)![0];
    expect(nav).toMatch(/<div class="sourcey-nav-group-linked"><a href="[^"]*start\/" class="nav-group-label nav-group-link active">Getting started<\/a><details open class="sourcey-nav-group"><summary aria-label="Getting started"><\/summary>/);
  }));

  it("fails on an operation link that no reference, or more than one, publishes until it names one", () => fixture(async root => {
    await file(root, "api.json", JSON.stringify(api()));
    await file(root, "copy.json", JSON.stringify(api()));
    const build = async (link: string) => {
      await file(root, "guide.md", `# Guide\n\n[Pets](<${link}>)\n`);
      const config = await resolveConfigFromRaw({ prettyUrls: "slash", theme: { fonts: { google: false } }, navigation: { tabs: [
        { id: "guides", tab: "Guides", slug: "", groups: [{ group: "Start", pages: ["guide"] }] },
        { id: "rest", tab: "API", slug: "api", source: openapi("api.json") },
        { id: "copy", tab: "Copy", slug: "copy", source: openapi("copy.json") },
      ] } }, root);
      return buildSourceySite({ config, generateOgImages: false });
    };
    await expect(build("operation:GET /pets")).rejects.toThrow("rest, copy each publish it; name one, as operation:rest:GET /pets");
    await expect(build("operation:GET /gone")).rejects.toThrow("no reference publishes it");
    await expect(build("operation:absent:GET /pets")).rejects.toThrow('reference "absent" does not publish it');
    await expect(build("operation:pets")).rejects.toThrow("name an operation as METHOD /path");
    const site = await build("operation:copy:GET /pets");
    const guide = site.pages.find(page => page.identity.document === "guide")!;
    expect(guide.currentPage.kind === "markdown" && guide.currentPage.markdown.html).toContain('href="/copy/#operation-pets-get"');
  }));

  it("sets the native startup mode once and respects an embedding host", () => fixture(async root => {
    await file(root, "api.json", JSON.stringify(api()));
    await file(root, "sourcey.config.ts", `import {openapi} from ${JSON.stringify(new URL("../../src/adapters/index.ts", import.meta.url).pathname)};
export default {name:process.env.NODE_ENV,navigation:{tabs:[{tab:'API',source:openapi('./api.json')}]}};
`);
    const original = process.env.NODE_ENV;
    try {
      delete process.env.NODE_ENV;
      expect((await loadConfig(root)).name).toBe("production");
      delete process.env.NODE_ENV;
      expect((await loadConfig(root, undefined, "development")).name).toBe("development");
      process.env.NODE_ENV = "host-mode";
      expect((await loadConfig(root)).name).toBe("host-mode");
    } finally {
      if (original === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original;
    }
  }));
});
