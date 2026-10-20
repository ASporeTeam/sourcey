import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfigFromRaw } from "../../src/config.js";
import { markdown } from "../../src/index.js";
import { buildSourceySite, sourceyArtifacts } from "../../src/site.js";

async function build(css: string) {
  const root = await mkdtemp(join(tmpdir(), "sourcey-theme-css-"));
  try {
    await mkdir(join(root, "brand/fonts"), { recursive: true });
    await writeFile(join(root, "brand/fonts/face.woff2"), "wOF2 face");
    await writeFile(join(root, "brand/theme.css"), css);
    await writeFile(join(root, "guide.md"), "# Guide\n\nHello.\n");
    const config = await resolveConfigFromRaw({ name: "Station", theme: { fonts: { sans: "Face", google: false }, css: ["./brand/theme.css"] }, navigation: { tabs: [{ tab: "Docs", slug: "", source: markdown({ slugs: "file", groups: [{ group: "Start", pages: ["guide"] }] }) }] } }, root);
    return await sourceyArtifacts(await buildSourceySite({ config, generateOgImages: false }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("theme stylesheets", () => {
  it("publish the files their url()s name, from the stylesheet's folder, and leave remote and data URLs as written", async () => {
    const files = await build([
      '@font-face { font-family: "Face"; src: url(./fonts/face.woff2?v=2) format("woff2"), url("https://cdn.example/face.woff") format("woff"); }',
      ".mark { background: url(data:image/gif;base64,R0lGOD==); }",
    ].join("\n"));
    const html = String(files.get("guide.html"));
    const published = html.match(/url\(\/(_media\/[0-9a-f]{20}\.woff2)\?v=2\)/)?.[1];
    expect(published).toBeDefined();
    expect(String(files.get(published!))).toBe("wOF2 face");
    expect(html).toContain('url("https://cdn.example/face.woff")');
    expect(html).toContain("url(data:image/gif;base64,R0lGOD==)");
  });

  it("fail the build on a url() whose file is not there, naming both", async () => {
    await expect(build("body { background: url(./missing.png); }")).rejects.toThrow(/theme\.css refers to \.\/missing\.png/);
  });
});
