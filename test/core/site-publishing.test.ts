import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfigFromRaw } from "../../src/config.js";
import { buildSourceySite, sourceyArtifacts } from "../../src/site.js";

async function site(raw: Record<string, unknown>, pages: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "sourcey-publishing-"));
  try {
    for (const [name, text] of Object.entries(pages)) await writeFile(join(root, name), text);
    const built = await buildSourceySite({ config: await resolveConfigFromRaw(raw, root), generateOgImages: false });
    return { built, files: await sourceyArtifacts(built) };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const pages = {
  "index.md": "# Welcome\n\nStart with [the setup](setup.md#install) or [a section that is gone](setup.md#missing).\n",
  "setup.md": "# Setup\n\nInstall and configure the store.\n\n## Install\n\nRun it.\n",
  "terse.md": "# Terse\n\nShort.\n",
};
const navigation = { tabs: [{ tab: "Guides", slug: "guides", groups: [{ group: "Start", href: "/guides/", pages: ["index", { group: "Run it", pages: ["setup", "terse"] }] }] }] };

describe("publishing a site", () => {
  it("describes each page's place in the navigation as breadcrumb structured data", async () => {
    const { files } = await site({ siteUrl: "https://docs.example.com", prettyUrls: "slash", navigation }, pages);
    const html = String(files.get("guides/setup/index.html"));
    const data = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]*)<\/script>/)![1]);
    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Guides", item: "https://docs.example.com/guides/" },
        { "@type": "ListItem", position: 2, name: "Setup", item: "https://docs.example.com/guides/setup/" },
      ],
    });
  });

  it("leaves breadcrumbs out without a public origin, and reports what publishing needs", async () => {
    const { built, files } = await site({ prettyUrls: "slash", navigation }, pages);
    expect(String(files.get("guides/setup/index.html"))).not.toContain("application/ld+json");
    expect(built.siteDiagnostics.map(({ code, page }) => [code, page ?? ""])).toEqual([
      ["missing-site-origin", ""],
      ["broken-fragment", "/guides/"],
      ["short-description", "/guides/terse/"],
    ]);
  });
});
