import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDevServer } from "../src/dev-server.js";

describe("standalone development transport", () => {
  it("serves every stylesheet and script a reference page links, its code-language icons included", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-dev-assets-"));
    let server: Awaited<ReturnType<typeof startDevServer>> | undefined;
    try {
      await writeFile(join(root, "spec.json"), JSON.stringify({ openapi: "3.1.0", info: { title: "Pets API", version: "1" }, paths: { "/pets": { get: { summary: "List pets", responses: { "200": { description: "OK" } } } } } }));
      await writeFile(join(root, "sourcey.config.ts"), `export default {theme:{fonts:{google:false}},navigation:{tabs:[{tab:'API',slug:'',openapi:'spec.json'}]}};`);
      server = await startDevServer({ port: 0, host: "127.0.0.1", config: root });
      const origin = server.resolvedUrls!.local[0];
      const html = await (await fetch(new URL("/", origin))).text();
      const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(match => match[1]);
      const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(match => match[1]);
      expect(styles.some(href => /lang(uage)?-icons/.test(href))).toBe(true);
      for (const href of styles) {
        // As a browser asks for a stylesheet.
        const response = await fetch(new URL(href.replace(/&amp;/g, "&"), origin), { headers: { accept: "text/css,*/*;q=0.1" } });
        expect([href, response.status, response.headers.get("content-type")?.split(";")[0]]).toEqual([href, 200, "text/css"]);
      }
      for (const src of scripts) expect([src, (await fetch(new URL(src.replace(/&amp;/g, "&"), origin))).status]).toEqual([src, 200]);
    } finally {
      await server?.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("serves query-bearing and Unicode documents and issues the compiled redirect status", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-dev-proof-"));
    let server: Awaited<ReturnType<typeof startDevServer>> | undefined;
    try {
      await writeFile(
        join(root, "guide.md"),
        "---\nslug: café\n---\n# Guide\n\nOriginal content.\n",
      );
      await writeFile(join(root, "brand.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><path fill="red"/></svg>');
      await writeFile(
        join(root, "sourcey.config.ts"),
        `export default {
baseUrl:'/manual',theme:{fonts:{google:false}},logo:'brand.svg',favicon:'brand.svg',
redirects:{'/manual/old':{to:'/manual/caf%C3%A9.html#guide',status:307}},
navigation:{tabs:[{tab:'Docs',slug:'',groups:[{group:'Start',pages:['guide']}]}]}};`,
      );
      server = await startDevServer({ port: 0, host: "127.0.0.1", config: root });
      const origin = server.resolvedUrls!.local[0];
      const page = await fetch(new URL("/manual/caf%C3%A9.html?preview=1", origin));
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain("Original content.");
      const logo = html.match(/href="(\/manual\/_media\/[a-f0-9]+\.svg)"/)![1];
      expect(await (await fetch(new URL(logo, origin))).text()).toContain('fill="red"');
      await writeFile(join(root, "brand.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><path fill="blue"/></svg>');
      let nextLogo = logo;
      await expect.poll(async () => {
        const current = await (await fetch(new URL("/manual/caf%C3%A9.html", origin))).text();
        nextLogo = current.match(/href="(\/manual\/_media\/[a-f0-9]+\.svg)"/)?.[1] ?? logo;
        return nextLogo !== logo;
      }, { timeout: 6000, interval: 50 }).toBe(true);
      expect(await (await fetch(new URL(nextLogo, origin))).text()).toContain('fill="blue"');
      const redirect = await fetch(new URL("/manual/old?preview=1", origin), {
        redirect: "manual",
      });
      expect(redirect.status).toBe(307);
      expect(redirect.headers.get("location")).toBe("/manual/caf%C3%A9.html?preview=1#guide");
      const missing = await fetch(new URL("/manual/unknown?preview=1", origin));
      expect(missing.status).toBe(404);
    } finally {
      await server?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
