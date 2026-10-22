import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { godoc } from "../../src/adapters/index.js";
import { resolveConfigFromRaw } from "../../src/config.js";
import { buildSourceySite } from "../../src/site.js";
import { GODOC_SCHEMA_VERSION } from "../../src/core/godoc-types.js";

// A loader publishes every page its navigation names; this one loses a page on the way.
vi.mock("../../src/core/godoc-loader.js", async importOriginal => {
  const loader = await importOriginal<typeof import("../../src/core/godoc-loader.js")>();
  return { ...loader, loadGodocTab: async (...args: Parameters<typeof loader.loadGodocTab>) => {
    const result = await loader.loadGodocTab(...args);
    return { ...result, pages: new Map([...result.pages].filter(([id]) => id !== "package-root")) };
  } };
});

describe("generated navigation", () => {
  it("fails the build when it names a page the site does not publish, instead of linking nowhere", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-navigation-names-"));
    try {
      await writeFile(join(root, "go.json"), JSON.stringify({ schema_version: GODOC_SCHEMA_VERSION, source: "sourcey-godoc", module_path: "example.test/fixture", generated_at: "2026-10-22T00:00:00Z",
        packages: [{ importPath: "example.test/fixture", name: "fixture", synopsis: "Fixture.", doc: "Fixture.", dir: ".", files: [], consts: [], vars: [], funcs: [], types: [], examples: [] }] }));
      const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, navigation: { tabs: [
        { tab: "Go", slug: "go", source: godoc({ module: root, mode: "snapshot", snapshot: "go.json" }) },
      ] } }, root);
      await expect(buildSourceySite({ config, generateOgImages: false })).rejects.toThrow('Navigation in go: unknown document "package-root"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
