import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import type { ResolvedRustdocConfig } from "../../src/config.js";
import { loadRustdocTab } from "../../src/core/rustdoc-loader.js";
import { InputReader } from "../../src/core/loader.js";
import { DEFAULT_CALLOUTS } from "../../src/utils/markdown.js";
import { messagesFor } from "../../src/core/messages.js";
import { walkNavItems } from "../../src/core/navigation.js";

const FIXTURE_MANIFEST = resolve(import.meta.dirname, "../fixtures/rustdoc/basic/Cargo.toml");
const FIXTURE_SNAPSHOT = resolve(
  import.meta.dirname,
  "../fixtures/rustdoc/basic/snapshots/rustdoc.json",
);

function snapshotConfig(overrides: Partial<ResolvedRustdocConfig> = {}): ResolvedRustdocConfig {
  return {
    manifest: FIXTURE_MANIFEST,
    crates: ["basic"],
    snapshot: FIXTURE_SNAPSHOT,
    mode: "snapshot",
    features: { default: true, list: [], all: false },
    includePrivate: false,
    includeHidden: false,
    toolchain: "nightly",
    sourceBasePath: "",
    doctestsIndex: true,
    ...overrides,
  };
}

describe("loadRustdocTab snapshot mode", () => {
  it("renders selected callouts and locale labels from separate cache entries", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "sourcey-rust-callouts-"));
    try {
      const snapshot = JSON.parse(await readFile(FIXTURE_SNAPSHOT, "utf8"));
      const crate = snapshot.crates[0], module = crate.modules[0];
      const note = "> [!WARNING]\n> Keep this Rust reference detail.\n\n";
      module.docs_markdown = note + (module.docs_markdown ?? "");
      const items = Array.isArray(crate.items) ? crate.items : Object.values(crate.items);
      const item = items.find((value: { id: string }) => value.id === module.id);
      if (item) item.docs_markdown = note + (item.docs_markdown ?? "");
      const path = resolve(root, "rustdoc.json");
      await writeFile(path, JSON.stringify(snapshot));
      const input = new InputReader(), config = snapshotConfig({ snapshot: path });
      const original = await loadRustdocTab(config, "rust-api", "Rust API", {}, input, DEFAULT_CALLOUTS);
      const translated = await loadRustdocTab(config, "rust-api", "Rust API", {}, input, { icons: "lucide", messages: messagesFor("fr") });
      const first = [...original.pages.values()].find(page => page.html.includes("Keep this Rust reference detail."))!;
      const second = translated.pages.get(first.slug)!;
      expect(first.html).toContain("Warning");
      expect(second.html).toContain("Avertissement");
      expect(second.html).toContain('stroke-width="2"');
      expect(second.markdown).toContain("Keep this Rust reference detail.");
      expect(first.html).not.toContain("Avertissement");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("returns a navTab, pages, and no error diagnostics", async () => {
    const result = await loadRustdocTab(snapshotConfig(), "rust-api", "Rust API");
    expect(result.navTab.label).toBe("Rust API");
    expect(result.navTab.slug).toBe("rust-api");
    expect(result.navTab.kind).toBe("docs");
    expect(result.pages.size).toBeGreaterThan(0);
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });

  it("names the pages its navigation leads to, and leaves their addresses to the site", async () => {
    const result = await loadRustdocTab(snapshotConfig(), "rust-api", "Rust API");
    expect(result.navTab.documentId).toBe("index");
    const items = [...walkNavItems(result.navTab.groups)];
    expect(items.map(item => item.documentId)).toEqual(items.map(item => result.pages.has(item.documentId!) && item.documentId));
    expect(items.map(item => item.href)).toEqual(items.map(() => ""));
  });

  it("keeps every page's headings in order beneath its title, with a card's count as plain text", async () => {
    const result = await loadRustdocTab(snapshotConfig(), "rust-api", "Rust API");
    for (const page of result.pages.values()) {
      const levels = [1, ...[...page.html.matchAll(/<h([1-6])\b/g)].map(([, level]) => Number(level))];
      expect(levels.every((level, i) => i === 0 || level <= levels[i - 1] + 1), `${page.slug}: ${levels.join(",")}`).toBe(true);
      expect(page.html).not.toMatch(/style="[^"]*opacity/);
    }
  });

  it("emits a crate index page and the doctests aggregation page", async () => {
    const result = await loadRustdocTab(snapshotConfig(), "rust-api", "Rust API");
    expect(result.pages.has("pkg-basic")).toBe(true);
    expect(result.pages.has("doctests")).toBe(true);
  });

  it("populates search entries with rust categories and surfaces doctests", async () => {
    const result = await loadRustdocTab(snapshotConfig(), "rust-api", "Rust API");
    const doctestsPage = result.pages.get("doctests");
    expect(doctestsPage).toBeDefined();
    const categories = new Set<string>();
    for (const page of result.pages.values()) {
      for (const entry of page.searchEntries ?? []) categories.add(entry.category);
    }
    expect(categories.has("rust doctest")).toBe(true);
    expect(
      Array.from(categories).some((c) => c.startsWith("rust ") && c !== "rust doctest"),
    ).toBe(true);
  });

  it("falls back to an error index page when the snapshot is missing", async () => {
    const result = await loadRustdocTab(
      snapshotConfig({ snapshot: "/does/not/exist.json" }),
      "rust-api",
      "Rust API",
    );
    expect(result.pages.has("index")).toBe(true);
    expect(result.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("titles the doctests page once, through the layout, and counts the workspace's examples under it", async () => {
    const result = await loadRustdocTab(snapshotConfig(), "rust-api", "Rust API");
    const page = result.pages.get("doctests")!;
    expect(page.title).toBe("Doctests");
    expect(page.html).not.toContain("<h1");
    expect(page.html.toLowerCase()).toMatch(/runnable example/);
    // Each example is a section under the page's title.
    expect(page.html).toMatch(/<section class="rust-doctest" id="[^"]+"><h2>/);
    expect(page.headings.every(heading => heading.level === 2)).toBe(true);
  });
});
