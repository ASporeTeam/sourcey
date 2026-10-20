import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markdown, openapi } from "../src/adapters/index.js";
import { resolveConfigFromRaw, type SourceyConfig, type ThemeName } from "../src/config.js";
import { buildSourceySite } from "../src/site.js";
import { renderPage } from "../src/renderer/static-renderer.js";
import { createRenderOptions } from "../src/renderer/html-builder.js";
import { consoleArtifactPath } from "../src/renderer/try-it.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
/** Engine files as a page names them; the build names them by their content. */
const ASSETS = { styles: ["_assets/test/sourcey.css"], client: "_assets/test/sourcey.js", theme: "_assets/test/sourcey-theme.js", search: "_assets/test/sourcey-search.js", tryIt: "_assets/test/sourcey-try-it.js" };

async function assemble(
  theme: ThemeName,
  tryIt?: SourceyConfig["tryIt"],
  tabTryIt?: SourceyConfig["tryIt"],
) {
  const root = await mkdtemp(join(tmpdir(), "sourcey-console-test-"));
  directories.push(root);
  await writeFile(join(root, "intro.md"), "# Welcome\n\nA guide.");
  await writeFile(join(root, "brand.css"), ".sourcey-input { border-radius: 0; }");
  await writeFile(
    join(root, "api.json"),
    JSON.stringify({
      openapi: "3.1.0",
      info: { title: "API", version: "1" },
      servers: [{ url: "https://api.example.test" }],
      components: {
        securitySchemes: {
          Used: { type: "http", scheme: "bearer" },
          Unused: { type: "http", scheme: "basic" },
        },
      },
      paths: {
        "/items": {
          get: {
            tags: ["One", "Two"],
            security: [{ Used: [] }],
            responses: { 200: { description: "OK" } },
          },
        },
        "/other": { get: { responses: { 200: { description: "OK" } } } },
      },
    }),
  );
  const config = await resolveConfigFromRaw(
    {
      name: "Test",
      baseUrl: "/docs/",
      prettyUrls: "slash",
      tryIt,
      theme: { name: theme, fonts: { google: false }, css: ["brand.css"] },
      navigation: {
        tabs: [
          {
            tab: "Guide",
            slug: "",
            source: markdown({ groups: [{ group: "Start", pages: ["intro"] }] }),
          },
          { tab: "API", slug: "api", source: openapi("./api.json"), tryIt: tabTryIt },
        ],
      },
    },
    root,
  );
  const site = await buildSourceySite({ config, generateOgImages: false });
  const html = (tab: string) => {
    const page = site.pages.find((p) => p.tabSlug === tab)!;
    const options = createRenderOptions(page, site.site, { assets: ASSETS });
    return renderPage(
      page.currentPage.kind === "spec" ? page.currentPage.spec : undefined,
      options,
      site.navigation,
      page.currentPage,
      site.site,
    );
  };
  return { site, html };
}

describe("interactive reference integration", () => {
  it("keeps operation identities and nested scopes distinct on decoded static hosts", async () => {
    const { site } = await assemble("default");
    const op = site.pages.find((p) => p.currentPage.kind === "spec")!.currentPage;
    if (op.kind !== "spec") throw new Error("Expected an API page");
    const a = { ...op.spec.operations[0], path: "/items/{id}" };
    const b = { ...a, path: "/items/id" };
    const path = consoleArtifactPath("en/api", a);
    expect(decodeURIComponent(path)).toBe(path);
    expect(path).not.toBe(consoleArtifactPath("en~2Fapi", a));
    expect(path).not.toBe(consoleArtifactPath("en/api", b));
  });
  it.each(["default", "minimal", "api-first", "reader"] as const)(
    "uses the reference surface and scoped artifacts in %s",
    async (theme) => {
      const { site, html } = await assemble(theme);
      const api = html("api"),
        guide = html("");
      // A multi-tag operation has one body/console; secondary tags link to it.
      expect(api.match(/data-try-it-trigger/g)).toHaveLength(2);
      expect(api.match(/data-try-it-mount/g)).toHaveLength(2);
      const controls = [...api.matchAll(/aria-controls="(tryit-[^"]+)"/g)].map((m) => m[1]);
      expect(new Set(controls).size).toBe(2);
      expect(api).toContain("/_sourcey/try-it/api/operation-items-get-");
      expect(api).not.toContain('rel="modulepreload"');
      expect(guide).not.toContain("data-try-it-trigger");
      expect(api.indexOf(".sourcey-input { border-radius: 0; }")).toBeGreaterThan(
        api.indexOf('href="/_assets/test/sourcey.css"'),
      );
      const artifacts = [...site.extraFiles].filter(([path]) =>
        path.startsWith("_sourcey/try-it/"),
      );
      expect(artifacts).toHaveLength(2);
      const data = JSON.parse(String(artifacts.find(([path]) => path.includes("items"))![1]));
      expect(data.credentials).toBe("same-origin");
      expect(Object.keys(data.securitySchemes)).toEqual(["Used"]);
      expect(data.operation.path).toBe("/items");
      expect(data).not.toHaveProperty("operations");
    },
  );
  it("disables the console and data at site scope while allowing a tab override", async () => {
    const off = await assemble("default", false);
    expect(off.html("api")).not.toContain("data-try-it-");
    expect([...off.site.extraFiles.keys()].some((p) => p.startsWith("_sourcey/try-it/"))).toBe(
      false,
    );
    const on = await assemble("default", false, { credentials: "include" });
    expect(on.html("api")).toContain("data-try-it-trigger");
    const data = [...on.site.extraFiles].find(([path]) => path.startsWith("_sourcey/try-it/"))!;
    expect(JSON.parse(String(data[1])).credentials).toBe("include");
  });
  it("validates credentials configuration rather than silently changing policy", async () => {
    await expect(assemble("default", { credentials: "invalid" } as never)).rejects.toThrow("tryIt");
  });
});
