import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import satori from "satori";
import { resolveConfigFromRaw } from "../src/config.js";
import { generateOgImage } from "../src/og/generate-og-image.js";

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
});
