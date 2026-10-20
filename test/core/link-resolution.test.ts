import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { markdown } from "../../src/index.js";
import { resolveConfigFromRaw, type SourceyConfig } from "../../src/config.js";
import { buildSourceySite } from "../../src/site.js";

async function compile(files: Record<string, string>, raw: SourceyConfig) {
  const root = await mkdtemp(join(tmpdir(), "sourcey-links-"));
  try {
    for (const [name, body] of Object.entries(files)) {
      const path = join(root, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    }
    const config = await resolveConfigFromRaw(raw, root);
    const site = await buildSourceySite({ config, generateOgImages: false });
    return new Map(site.pages.flatMap(page => page.currentPage.kind === "markdown" ? [[page.outputPath, page.currentPage.markdown.html] as const] : []));
  } finally { await rm(root, { recursive: true, force: true }); }
}

describe("compiled internal links", () => {
  it("resolves source-relative guide links across native tabs, from the site's base", async () => {
    const pages = await compile({
      "docs/modules/base.md": "# Base\n\n[API Reference](../api/base.md) [Runtime Contracts](../concepts/runtime-contracts.md)",
      "docs/concepts/runtime-contracts.md": "# Runtime Contracts",
      "docs/api/base.md": "# Base API",
    }, { navigation: { tabs: [
      { tab: "Documentation", slug: "documentation", source: markdown({ root: "docs", groups: [{ group: "Guides", pages: ["modules/base", "concepts/runtime-contracts"] }] }) },
      { tab: "API", slug: "api-reference", source: markdown({ root: "docs/api", groups: [{ group: "Reference", pages: ["base"] }] }) },
    ] } });
    expect(pages.get("documentation/modules/base.html")).toContain('href="/api-reference/base.html"');
    expect(pages.get("documentation/modules/base.html")).toContain('href="/documentation/concepts/runtime-contracts.html"');
  });

  it("converts a published HTML link to the current URL policy without changing unknown targets or code", async () => {
    const pages = await compile({
      "introduction.md": '# Introduction\n\n[Quickstart](/docs/quickstart.html) [Missing](missing.html)\n\n`[Quickstart](/docs/quickstart.html)`',
      "quickstart.md": "# Quickstart",
    }, { baseUrl: "/docs", prettyUrls: "strip", navigation: { tabs: [{ tab: "Docs", slug: "", groups: [{ group: "Guides", pages: ["introduction", "quickstart"] }] }] } });
    expect(pages.get("introduction.html")).toContain('href="/docs/quickstart"');
    expect(pages.get("introduction.html")).toContain('href="missing.html"');
    expect(pages.get("introduction.html")).toContain("<code>[Quickstart](/docs/quickstart.html)</code>");
  });

  it("resolves output-relative links and fragments between reference pages", async () => {
    const pages = await compile({
      "api/base.md": '# Base\n\nThe base API reference.\n\nSee [icy](icy.html#onshutdownsignal).',
      "api/icy.md": "# icy\n\n## onShutdownSignal",
    }, { prettyUrls: "strip", navigation: { tabs: [{ tab: "API", slug: "api-reference", source: markdown({ root: "api", groups: [{ group: "Reference", pages: ["base", "icy"] }] }) }] } });
    expect(pages.get("api-reference/base.html")).toContain('href="/api-reference/icy#onshutdownsignal"');
  });
});
