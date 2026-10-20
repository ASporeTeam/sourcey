import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer, type Plugin } from "vite";
import sourceyAstro, { prepareAstroSourcey } from "../src/astro/index.js";
import { buildSourceySite, updateSourceySite } from "../src/site.js";

const roots: string[] = [];
afterEach(() =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sourcey-astro-reload-"));
  roots.push(root);
  await writeFile(join(root, "index.md"), "# Welcome\n\nUseful documentation.\n");
  await writeFile(join(root, "brand.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><path fill="red"/></svg>');
  await writeFile(join(root, "title.ts"), 'export const title = "Before";');
  await writeFile(
    join(root, "sourcey.config.ts"),
    'import { title } from "./title"; export default { name: title, logo: "brand.svg", favicon: "brand.svg", theme: { fonts: { google: false } }, discovery: { ard: true }, navigation: { tabs: [{ tab: "Docs", slug: "", groups: [{ group: "Start", pages: ["index"] }] }] } };',
  );
  return root;
}

describe("Astro host config across shared updates", () => {
  it("retains host policy when a transitive config import reloads", async () => {
    const root = await fixture();
    const prepared = await prepareAstroSourcey(
      { routeBase: "/docs" },
      {
        root: pathToFileURL(root + "/"),
        base: "/project/",
        site: "https://host.test",
        build: { format: "directory" },
      },
    );
    const first = await buildSourceySite({ config: prepared.config, generateOgImages: false });
    const title = join(root, "title.ts");
    await writeFile(title, 'export const title = "After";');
    const next = await updateSourceySite(first, [title]);
    expect(next.config).toMatchObject({
      name: "After",
      baseUrl: "/project/docs/",
      siteUrl: "https://host.test",
      prettyUrls: "slash",
      discovery: { ard: true },
    });
    expect(first.config.name).toBe("Before");
    const descriptor = JSON.parse(next.extraFiles.get("ard.json")!.toString());
    expect(descriptor.entries[0].url).toMatch(/^https:\/\/host.test\/project\/docs\//);
  });

  it("serves the edited generation through the real dev middleware at the existing mount", async () => {
    const root = await fixture();
    let plugins: Plugin[] = [];
    const integration = sourceyAstro({ routeBase: "/docs", prettyUrls: "slash" });
    await integration.hooks["astro:config:setup"]!({
      command: "dev",
      config: { root: pathToFileURL(root + "/"), base: "/project/", site: "https://host.test" },
      createCodegenDir: () => pathToFileURL(root + "/.sourcey/"),
      addWatchFile() {},
      updateConfig(config) {
        plugins = (config.vite?.plugins as Plugin[]) ?? [];
      },
    } as never);
    const server = await createServer({
      configFile: false,
      root,
      plugins,
      server: { host: "127.0.0.1", port: 0 },
      logLevel: "silent",
    });
    try {
      await server.listen();
      const url = new URL("/project/docs/", server.resolvedUrls!.local[0]);
      expect(await (await fetch(url)).text()).toContain("Before");
      await writeFile(join(root, "title.ts"), 'export const title = "After";');
      await expect
        .poll(
          async () => {
            const response = await fetch(url);
            return response.status === 200 && (await response.text()).includes("After");
          },
          { timeout: 6000, interval: 50 },
        )
        .toBe(true);
      const html = await (await fetch(url)).text();
      expect(html).toContain('href="https://host.test/project/docs/"');
      const logo = html.match(/href="(\/project\/docs\/_media\/[a-f0-9]+\.svg)"/)![1];
      expect(await (await fetch(new URL(logo, url))).text()).toContain('fill="red"');
      await writeFile(join(root, "brand.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><path fill="blue"/></svg>');
      let nextLogo = logo;
      await expect.poll(async () => {
        const current = await (await fetch(url)).text();
        nextLogo = current.match(/href="(\/project\/docs\/_media\/[a-f0-9]+\.svg)"/)?.[1] ?? logo;
        return nextLogo !== logo;
      }, { timeout: 6000, interval: 50 }).toBe(true);
      expect(await (await fetch(new URL(nextLogo, url))).text()).toContain('fill="blue"');
      const index = await (await fetch(new URL("/project/docs/documents.json", url))).json();
      expect(index.documents[0].url).toMatch(/^https:\/\/host.test\/project\/docs\//);
    } finally {
      await server.close();
    }
  });
});
