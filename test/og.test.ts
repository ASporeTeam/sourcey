import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import satori from "satori";
import { resolveConfigFromRaw } from "../src/config.js";
import { embedRemoteLogo, generateOgImage } from "../src/og/generate-og-image.js";

vi.mock("satori", async (original) => {
  const module = await original<typeof import("satori")>();
  return { ...module, default: vi.fn(module.default) };
});

describe("social image rendering", () => {
  it("reuses the rendered card and changes it only when a visual input changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-og-fixture-"));
    try {
      const config = await resolveConfigFromRaw({ navigation: { tabs: [] } }, root);
      const input = {
        title: "Field reference",
        description: "The declared inputs and their constraints.",
        siteName: `Fixture ${root.split("-").at(-1)}`,
        theme: config.theme,
      };
      vi.mocked(satori).mockClear();
      const first = await generateOgImage(input);
      expect(satori).toHaveBeenCalledTimes(1);
      const unrelated = {
        ...input,
        theme: { ...input.theme, fonts: { ...input.theme.fonts, sans: "system-ui" } },
      };
      expect(await generateOgImage(unrelated)).toEqual(first);
      expect(satori).toHaveBeenCalledTimes(1);
      const title = await generateOgImage({ ...input, title: "Updated field reference" });
      const color = await generateOgImage({
        ...input,
        theme: { ...input.theme, colors: { ...input.theme.colors, primary: "220 20 20" } },
      });
      const logo = await generateOgImage({
        ...input,
        logo:
          "data:image/svg+xml;base64," +
          Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="red"/></svg>',
          ).toString("base64"),
      });
      for (const image of [title, color, logo]) expect(image.equals(first)).toBe(false);
      expect(await generateOgImage(input)).toEqual(first);
      expect(satori).toHaveBeenCalledTimes(4);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("draws a logo at its own proportions, with the name beside a mark and never beside a wordmark", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-og-logo-"));
    try {
      const config = await resolveConfigFromRaw({ navigation: { tabs: [] } }, root);
      const svg = (width: number, height: number) =>
        `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="red"/></svg>`).toString("base64")}`;
      const input = { title: "Logos", siteName: `Logo ${root.split("-").at(-1)}`, theme: config.theme };
      type Node = { type?: string; props?: { src?: string; width?: number; height?: number; children?: unknown } };
      const nodes = (node: unknown): Node[] => {
        if (!node || typeof node !== "object") return [];
        const children = (node as Node).props?.children;
        return [node as Node, ...(Array.isArray(children) ? children : [children]).flatMap(nodes)];
      };
      vi.mocked(satori).mockClear();
      await generateOgImage({ ...input, logo: svg(500, 100) });
      await generateOgImage({ ...input, logo: svg(64, 64), logoMark: true });
      await generateOgImage({ ...input, logo: svg(2000, 50) });
      const cards = vi.mocked(satori).mock.calls.map(([card]) => nodes(card));
      const logo = (card: Node[]) => card.find((node) => node.type === "img")?.props;
      const named = (card: Node[]) => card.some((node) => node.props?.children === input.siteName);
      expect(logo(cards[0])).toMatchObject({ width: 240, height: 48 });
      expect(named(cards[0])).toBe(false);
      expect(logo(cards[1])).toMatchObject({ width: 48, height: 48 });
      expect(named(cards[1])).toBe(true);
      expect(logo(cards[2])).toMatchObject({ width: 480, height: 12 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("draws a logo named by URL, as served with a charset, and leaves the mark when it cannot load", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="red"/></svg>';
    const server = createServer((request, response) => {
      if (request.url !== "/logo.svg") return void response.writeHead(404).end();
      response.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8" }).end(svg);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const logo = await embedRemoteLogo(`${origin}/logo.svg`);
      expect(logo).toBe(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
      expect(warn).not.toHaveBeenCalled();
      expect(await embedRemoteLogo(`${origin}/missing.svg`)).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("HTTP 404");
    } finally {
      warn.mockRestore();
      await new Promise((done) => server.close(done));
    }
  });
});
