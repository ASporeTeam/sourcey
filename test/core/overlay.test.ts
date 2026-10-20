import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createServer } from "node:http";
import { applyOverlay } from "../../src/core/overlay.js";
import { openapi } from "../../src/adapters/index.js";
import { resolveConfigFromRaw } from "../../src/config.js";
import { buildSourceySite, sourceyArtifacts, updateSourceySite, collectSourceyWatchPaths } from "../../src/site.js";

const overlay = (actions: unknown[]) => ({ overlay: "1.0.0", info: { title: "Editorial reference", version: "fixture" }, actions });
const spec = () => ({ openapi: "3.1.0", info: { title: "Fixture API", version: "fixture" }, servers: [{ url: "https://api.example.test" }], paths: {
  "/pets": { get: { operationId: "listPets", description: "Upstream description.", responses: { "200": { description: "Success", content: { "application/json": { schema: { $ref: "./schema.json" } } } } } } },
  "/private": { post: { summary: "Private operation", responses: { "200": { description: "Success" } } } },
} });
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sourcey-overlay-"));
  try {
    await mkdir(join(root, "editorial"));
    await writeFile(join(root, "openapi.json"), JSON.stringify(spec()));
    await writeFile(join(root, "schema.json"), JSON.stringify({ type: "object", properties: { id: { type: "string", description: "Stable pet identifier." } } }));
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

describe("OpenAPI Overlay 1.0", () => {
  it("applies ordered updates, nested merges and removal without shared update objects", () => {
    const document = { a: { nested: { keep: true }, tags: ["old"] }, b: {} };
    applyOverlay(document, overlay([
      { target: "$['a','b']", update: { nested: { added: true }, tags: ["new"] } },
      { target: "$.a.nested", update: { added: false } },
      { target: "$.b.nested", remove: true, update: 0 },
      { target: "$.b", update: { nested: { recreated: true } } },
    ]), "editorial.yaml");
    expect(document).toEqual({ a: { nested: { keep: true, added: false }, tags: ["new"] }, b: { nested: { recreated: true }, tags: ["new"] } });
  });

  it("appends an entry to array targets and removes original array indices once", () => {
    const document = { first: [{ name: "drop" }, { name: "keep" }, { name: "drop" }, { name: "drop" }], second: [] as unknown[] };
    applyOverlay(document, overlay([
      { target: "$.first[?@.name == 'drop']", remove: true },
      { target: "$['first','second']", update: { name: "append" } },
      { target: "$['first','first']", update: ["one array entry"] },
    ]), "array.json");
    expect(document.first).toEqual([{ name: "keep" }, { name: "append" }, ["one array entry"]]);
    expect(document.second).toEqual([{ name: "append" }]);
    expect(document.first[1]).not.toBe(document.second[0]);
  });

  it("uses RFC 9535 functions, descendant queries, slices and escaped member names", () => {
    const document = { "odd'key": [{ name: "pet", flags: [1, 2] }, { name: "other", flags: [] }, { name: "pet-long", flags: [3] }] };
    applyOverlay(document, overlay([
      { target: "$..[?match(@.name, 'pet.*') && count(@.flags[*]) >= 1 && length(@.name) > 2]", update: { selected: true } },
      { target: "$['odd\\'key'][0:3:2]", update: { sliced: true } },
      { target: "$['odd\\'key'][-1]", update: { last: true } },
    ]), "rfc.json");
    expect(document["odd'key"]).toEqual([
      { name: "pet", flags: [1, 2], selected: true, sliced: true },
      { name: "other", flags: [] },
      { name: "pet-long", flags: [3], selected: true, sliced: true, last: true },
    ]);
  });

  it("separates standard no-op behavior from configurable drift diagnostics", () => {
    const value = overlay([{ target: "$.missing", update: { summary: "Optional" } }]);
    expect(applyOverlay({}, value, "optional.yaml", "ignore")).toEqual([]);
    expect(applyOverlay({}, value, "optional.yaml", "warn")).toMatchObject([{ code: "overlay-unmatched", file: "optional.yaml", action: 1, target: "$.missing" }]);
    expect(() => applyOverlay({}, value, "optional.yaml")).toThrow(/optional.yaml: action 1.*overlay-unmatched/);
  });

  it("does not traverse or mutate JavaScript prototypes", () => {
    const document = JSON.parse('{"__proto__":{"safe":true}}');
    const update = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}');
    applyOverlay(document, overlay([{ target: "$", update }]), "keys.json");
    expect(Object.getPrototypeOf(document)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(document.__proto__).toEqual({ safe: true, polluted: true });
    expect(applyOverlay(document, overlay([{ target: "$.toString", update: {} }]), "keys.json", "ignore")).toEqual([]);
  });

  it("rejects unsupported feature sets, syntax, primitive targets, invalid updates and malformed documents", () => {
    expect(() => applyOverlay({}, { ...overlay([]), overlay: "1.1.0" }, "input")).toThrow(/unsupported overlay version/);
    expect(() => applyOverlay({}, overlay([]), "input")).toThrow(/nonempty/);
    expect(() => applyOverlay({}, { ...overlay([{ target: "$", update: {} }]), typo: true }, "input")).toThrow(/unknown property typo/);
    expect(() => applyOverlay({}, overlay([{ target: "$", copy: "$" }]), "input")).toThrow(/unknown property copy/);
    expect(() => applyOverlay({}, overlay([{ target: "$[(@.x)]", update: {} }]), "input")).toThrow(/action 1/);
    expect(() => applyOverlay({ title: "original" }, overlay([{ target: "$.title", update: "replacement" }]), "input")).toThrow(/containing object/);
    expect(() => applyOverlay({}, overlay([{ target: "$", update: 42 }]), "input")).toThrow(/object update/);
    expect(() => applyOverlay({}, overlay([{ target: "$", remove: true }]), "input")).toThrow(/document root/);
    expect(() => applyOverlay({}, overlay([{ target: "$", update: { date: new Date() } }]), "input")).toThrow(/JSON data/);
    // 1.0 patch numbers designate the same feature set; extensions are legal.
    const document = {};
    applyOverlay(document, { ...overlay([{ target: "$", update: { ok: true }, "x-note": "retained" }]), overlay: "1.0.9", "x-team": "docs" }, "input");
    expect(document).toEqual({ ok: true });
  });

  it("keeps HTML, search, readable docs, published contract and console on the effective spec", () => fixture(async root => {
    const overlayPath = join(root, "editorial/reference.yaml");
    await writeFile(overlayPath, 'overlay: 1.0.0\ninfo:\n  title: Pet docs\n  version: fixture\nactions:\n  - target: "$.paths[\'/pets\'].get"\n    update:\n      summary: List your pets\n      description: |\n        > [!NOTE]\n        > Keep this editorial detail.\n  - target: "$.paths[\'/private\']"\n    remove: true\n');
    const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, prettyUrls: "slash", exports: { openapi: true },
      navigation: { tabs: [{ tab: "API", slug: "api", source: openapi({ spec: "openapi.json", overlays: ["editorial/reference.yaml"] }), reference: { split: "operations" } }] } }, root);
    const first = await buildSourceySite({ config, generateOgImages: false });
    const effective = first.references.get("api")!;
    expect(effective.operations).toHaveLength(1);
    expect(effective.operations[0].summary).toBe("List your pets");
    expect(JSON.stringify(first.searchRows)).toContain("List your pets");
    expect(JSON.stringify(first.searchRows)).not.toContain("Private operation");
    const files = await sourceyArtifacts(first);
    const operation = first.pages.find(page => page.currentPage.kind === "spec" && page.currentPage.view?.kind === "operation")!;
    const html = files.get(operation.outputPath)!.toString();
    expect(html).toContain("List your pets");
    expect(html).toContain("Keep this editorial detail.");
    expect(html).toContain("Stable pet identifier."); // $ref base is the SPEC, not editorial/.
    expect(html).toContain("callout");
    expect(files.get("api/openapi.json")!.toString()).toContain("List your pets");
    expect(files.get("api/openapi.json")!.toString()).not.toContain("Private operation");
    expect([...files].some(([path, body]) => path.endsWith(".md") && body.toString().includes("Keep this editorial detail."))).toBe(true);
    expect([...files].some(([path, body]) => path.startsWith("_sourcey/try-it/") && body.toString().includes("List your pets"))).toBe(true);
    expect(collectSourceyWatchPaths(config)).toContain(overlayPath);

    const warm = await buildSourceySite({ config, previous: first, generateOgImages: false });
    expect(warm.references.get("api")).toBe(effective);
    await writeFile(overlayPath, JSON.stringify(overlay([{ target: "$.paths['/pets'].get", update: { summary: "Browse every pet" } }])));
    const edited = await updateSourceySite(first, [overlayPath]);
    expect(edited.references.get("api")).not.toBe(effective);
    expect(JSON.stringify(edited.searchRows)).toContain("Browse every pet");
    expect(effective.operations[0].summary).toBe("List your pets");
    expect(JSON.parse(await readFile(join(root, "openapi.json"), "utf8"))).toEqual(spec());
    await writeFile(overlayPath, JSON.stringify(overlay([{ target: "$.missing", update: {} }])));
    await expect(updateSourceySite(edited, [overlayPath])).rejects.toThrow(/overlay-unmatched/);
    expect(JSON.stringify(edited.searchRows)).toContain("Browse every pet");
  }));

  it("loads URL overlays once and keeps distinct transformations of a shared spec isolated", () => fixture(async root => {
    let reads = 0;
    const server = createServer((_request, response) => { reads++; response.setHeader("content-type", "application/json"); response.end(JSON.stringify(overlay([{ target: "$.paths['/pets'].get", update: { summary: "Remote title" } }]))); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP server");
      const url = `http://127.0.0.1:${address.port}/overlay.json`;
      const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, navigation: { tabs: [
        { tab: "Edited", source: openapi({ spec: "openapi.json", overlays: [url] }) },
        { tab: "Original", source: openapi("openapi.json") },
      ] } }, root);
      const site = await buildSourceySite({ config, generateOgImages: false });
      expect(reads).toBe(1);
      expect(site.references.get("edited")!.operations[0].summary).toBe("Remote title");
      expect(site.references.get("original")!.operations[0].summary).not.toBe("Remote title");
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }));

  it("reuses unaffected operation bytes and makes incremental output identical to a cold build", () => fixture(async root => {
    const path = join(root, "reference.json");
    const actions = [{ target: "$.paths['/pets'].get", update: { description: "First authored description." } }];
    await writeFile(path, JSON.stringify(overlay(actions)));
    const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, navigation: { tabs: [{ tab: "API", source: openapi({ spec: "openapi.json", overlays: ["reference.json"] }), reference: { split: "operations" } }] } }, root);
    let previous = await buildSourceySite({ config, generateOgImages: false });
    const initial = await sourceyArtifacts(previous);
    const unaffected = previous.pages.find(page => page.currentPage.kind === "spec" && page.currentPage.view?.kind === "operation" && page.currentPage.view.id === "POST /private")!.outputPath;
    actions[0].update.description = "Second authored description.";
    await writeFile(path, JSON.stringify(overlay(actions)));
    const edited = await updateSourceySite(previous, [path]);
    const editedFiles = await sourceyArtifacts(edited);
    expect(editedFiles.get(unaffected)).toBe(initial.get(unaffected));
    const originalSpec = previous.references.get("api")!, changedSpec = edited.references.get("api")!;
    expect(changedSpec.operations.find(operation => operation.path === "/private")).toBe(originalSpec.operations.find(operation => operation.path === "/private"));
    expect(changedSpec.operations.find(operation => operation.path === "/pets")).not.toBe(originalSpec.operations.find(operation => operation.path === "/pets"));
    for (const tag of changedSpec.tags) for (const operation of tag.operations) expect(changedSpec.operations).toContain(operation);
    expect([...editedFiles.values()].some(body => body.toString().includes("Second authored description."))).toBe(true);
    previous = edited;
    {
      const schemaPath = join(root, "schema.json");
      await writeFile(schemaPath, JSON.stringify({ type: "object", properties: { id: { type: "number", description: "Numeric pet identifier." } } }));
      const next = await updateSourceySite(previous, [schemaPath]);
      expect(JSON.stringify(next.searchRows)).toContain("Numeric pet identifier.");
      expect(next.references.get("api")!.operations.find(operation => operation.path === "/private")).toBe(changedSpec.operations.find(operation => operation.path === "/private"));
      const cold = await buildSourceySite({ config, generateOgImages: false });
      const nextFiles = await sourceyArtifacts(next), coldFiles = await sourceyArtifacts(cold);
      for (const [name, body] of nextFiles) expect(Buffer.from(body).equals(Buffer.from(coldFiles.get(name)!)), name).toBe(true);
      previous = next;
    }
    for (const change of [
      { target: "$.info", update: { title: "Renamed API" } },
      { target: "$", update: { servers: [{ url: "https://replacement.example.test" }] } },
      { target: "$", update: { components: { securitySchemes: { key: { type: "apiKey", in: "header", name: "X-API-Key" } } } } },
      { target: "$.paths['/private']", remove: true },
    ]) {
      await writeFile(path, JSON.stringify(overlay([...actions, change])));
      const next = await updateSourceySite(previous, [path]);
      const cold = await buildSourceySite({ config, generateOgImages: false });
      const nextFiles = await sourceyArtifacts(next), coldFiles = await sourceyArtifacts(cold);
      expect([...nextFiles.keys()].sort()).toEqual([...coldFiles.keys()].sort());
      for (const [name, body] of nextFiles) expect(Buffer.from(body).equals(Buffer.from(coldFiles.get(name)!)), name).toBe(true);
      previous = next;
    }
  }));

  it("refuses an authored public file at an engine stylesheet's address without replacing it", () => fixture(async root => {
    await mkdir(join(root, "public"));
    const config = await resolveConfigFromRaw({ publicDir: "public", theme: { fonts: { google: false } }, navigation: { tabs: [{ tab: "API", source: openapi("openapi.json") }] } }, root);
    const stylesheet = [...(await sourceyArtifacts(await buildSourceySite({ config, generateOgImages: false }))).keys()].find(path => path.endsWith("/sourcey.css"))!;
    const path = join(root, "public", stylesheet);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "/* owned by the project */");
    await expect(sourceyArtifacts(await buildSourceySite({ config, generateOgImages: false }))).rejects.toThrow(`Output collision: ${stylesheet}`);
    expect(await readFile(path, "utf8")).toBe("/* owned by the project */");
  }));
});
