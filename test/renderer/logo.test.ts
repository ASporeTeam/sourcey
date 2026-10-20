import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfigFromRaw } from "../../src/config.js";
import { markdown } from "../../src/index.js";
import { buildSourceySite, sourceyArtifacts } from "../../src/site.js";

async function header(logo: { light: string; mark?: boolean }, where: "header" | "drawer" = "header") {
  const root = await mkdtemp(join(tmpdir(), "sourcey-logo-"));
  try {
    await writeFile(join(root, "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>\n');
    await writeFile(join(root, "guide.md"), "# Guide\n\nHello.\n");
    const config = await resolveConfigFromRaw({ name: "Station", logo, theme: { fonts: { google: false } }, navigation: { tabs: [{ tab: "Docs", slug: "", source: markdown({ slugs: "file", groups: [{ group: "Start", pages: ["guide"] }] }) }] } }, root);
    const html = String((await sourceyArtifacts(await buildSourceySite({ config, generateOgImages: false }))).get("guide.html"));
    const scope = where === "drawer" ? html.slice(html.indexOf('<dialog id="mobile-nav"')) : html;
    return scope.match(/<a href="[^"]*" class="sourcey-logo[\s\S]*?<\/a>/)![0];
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("the header logo", () => {
  it("is a wordmark by default, named for assistive technology", async () => {
    const logo = await header({ light: "./logo.svg" });
    expect(logo).toContain('alt="Station"');
    expect(logo).not.toContain(">Station</span>");
  });

  it("draws the site name beside a mark, which is then decorative", async () => {
    const logo = await header({ light: "./logo.svg", mark: true });
    expect(logo).toMatch(/class="sourcey-logo select-none inline-flex items-center gap-2\.5"/);
    // An empty alt, which Preact writes as a bare attribute.
    expect(logo).toMatch(/<img [^>]*\balt(="")?[\s/>]/);
    expect(logo).toMatch(/<span class="text-sm font-semibold[^"]*">Station<\/span>/);
    // The drawer names the site beside its mark too.
    expect(await header({ light: "./logo.svg", mark: true }, "drawer")).toMatch(/<span class="text-sm font-semibold[^"]*">Station<\/span>/);
  });
});
