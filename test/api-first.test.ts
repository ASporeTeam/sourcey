import { afterEach, describe, expect, it } from "vitest";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markdown, mcp, openapi } from "../src/adapters/index.js";
import { resolveConfigFromRaw } from "../src/config.js";
import { buildSourceySite, writeSourceySite } from "../src/site.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function buildDemo(theme: "api-first" | "default") {
  const dir = await mkdtemp(join(tmpdir(), `sourcey-${theme}-`));
  directories.push(dir);
  await writeFile(
    join(dir, "quickstart.md"),
    "---\ntitle: Quickstart\ndescription: Build the demo.\n---\n\nRun `npm run build`.\n\n## First step\n\nText.\n\n### Detail\n\nMore.\n",
  );
  await copyFile(new URL("fixtures/cheese.yml", import.meta.url), join(dir, "cheese.yml"));
  await copyFile(new URL("fixtures/nitrosend.mcp.json", import.meta.url), join(dir, "tools.mcp.json"));
  const config = await resolveConfigFromRaw(
    {
      name: "Cheese Store",
      theme: { name: theme },
      navigation: {
        tabs: [
          {
            tab: "Documentation",
            slug: "",
            source: markdown({ groups: [{ group: "Getting Started", pages: ["quickstart"] }] }),
          },
          { tab: "API Reference", slug: "api", source: openapi("./cheese.yml") },
          { tab: "MCP Tools", slug: "mcp", source: mcp("./tools.mcp.json") },
        ],
      },
    },
    dir,
  );
  const site = await buildSourceySite({ config, outputDir: join(dir, "output"), generateOgImages: false });
  await writeSourceySite(site);
  const read = (path: string) => readFile(join(dir, "output", path), "utf8");
  return {
    guide: await read("quickstart.html"),
    api: await read("api.html"),
    mcp: await read("mcp.html"),
    css: await read("sourcey.css"),
  };
}

describe("api-first theme", () => {
  it("runs the frame edge to edge and gives guides a trail and a plain table of contents", async () => {
    const { guide, css } = await buildDemo("api-first");
    expect(guide).toContain('id="page" data-sourcey-theme="api-first"');
    expect(guide).not.toContain("max-w-[92rem]");
    expect(guide).toContain("navbar-band");
    expect(guide).toContain('class="api-first-page"');
    expect(guide).toContain("api-first-reading");
    expect(guide).toMatch(/<nav class="page-trail" aria-label="Breadcrumb">.*Getting Started/s);
    expect(guide).toMatch(/<aside id="toc" class="toc-wide[^"]*"[^>]*>\s*<h5 class="toc-wide-label">On this page<\/h5>/);
    expect(guide).not.toContain("noreferrer");
    expect(css).toContain(".operation-split");
    expect(css).toContain("--sidebar-wide-width");
  });

  it("splits each API and MCP operation into content and examples, without the endpoint box", async () => {
    const { api, mcp } = await buildDemo("api-first");
    expect(api).toMatch(/<section id="operation-[^"]+" class="operation-split"/);
    expect(api).toMatch(/<div class="operation-line" data-method="get"><span class="operation-line-method">GET<\/span><span class="operation-line-path">\/[^<]+<\/span>/);
    expect(api).toContain('class="operation-split-examples"');
    expect(api).toContain("code-group code-samples not-prose");
    expect(api).not.toContain("https://cheese.example.com/v2</span>");
    expect(mcp).toContain('class="operation-split"');
    expect(mcp).toMatch(/<div class="operation-line" data-method="tool"><span class="operation-line-method">TOOL<\/span><\/div>/);
  });

  it("leaves the default theme's layout as it was", async () => {
    const { guide, api } = await buildDemo("default");
    expect(guide).toContain("max-w-[92rem]");
    expect(guide).not.toContain("page-trail");
    expect(guide).not.toContain("toc-wide");
    expect(api).not.toContain("operation-split");
  });
});

describe("inline code", () => {
  it("renders as a chip in every theme, without literal backticks", async () => {
    const css = await readFile(new URL("../src/themes/default/sourcey.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/content:\s*"`"/);
    expect(css).toMatch(/:where\(code\)[^{]*::before,[^{]*::after \{\s*content: none;/);
  });
});
