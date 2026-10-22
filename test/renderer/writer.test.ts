import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openOutput, writeArtifacts } from "../../src/renderer/writer.js";

const fault = vi.hoisted(() => ({ promotion: "", rollback: "", staging: false, cleanup: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    async rm(path: string, options: Parameters<typeof fs.rm>[1]) {
      if (fault.cleanup && path.includes(".sourcey-write-")) {
        fault.cleanup = false;
        throw new Error("Injected cleanup failure");
      }
      return fs.rm(path, options);
    },
    async rename(source: string, target: string) {
      if (target === fault.promotion && source.endsWith(".next")) {
        fault.promotion = "";
        throw new Error("Injected promotion failure");
      }
      if (target === fault.rollback && source.endsWith(".previous")) {
        fault.rollback = "";
        throw new Error("Injected rollback failure");
      }
      return fs.rename(source, target);
    },
    async writeFile(
      path: string,
      ...args: Parameters<typeof fs.writeFile> extends [unknown, ...infer Rest] ? Rest : never
    ) {
      if (fault.staging && path.endsWith(".next")) {
        fault.staging = false;
        throw new Error("Injected staging failure");
      }
      return fs.writeFile(path, ...args);
    },
  };
});

const roots: string[] = [];
afterEach(async () => {
  fault.promotion = "";
  fault.rollback = "";
  fault.staging = false;
  fault.cleanup = false;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sourcey-writer-"));
  roots.push(root);
  await writeArtifacts(
    root,
    new Map([
      ["index.html", "old index"],
      ["retired.html", "old page"],
    ]),
  );
  return root;
}
async function generation(root: string, liveOnly = false) {
  const result: Record<string, string> = {};
  for (const name of await readdir(root)) {
    if (liveOnly && name.startsWith(".sourcey-write-")) continue;
    result[name] = await readFile(join(root, name), "utf8");
  }
  return result;
}

describe("standalone output publication", () => {
  it("stages artifacts as they stream in and changes the live output only on commit", async () => {
    const root = await fixture();
    // While a generation streams in, its staging directory sits beside the live files.
    const live = () => generation(root, true);
    const before = await live();
    const abandoned = await openOutput(root);
    await abandoned.put("index.html", "abandoned index");
    await abandoned.put("draft.html", "draft page");
    await abandoned.abort();
    expect(await generation(root)).toEqual(before);
    expect((await readdir(root)).some((name) => name.startsWith(".sourcey-write-"))).toBe(false);
    const output = await openOutput(root);
    await output.put("index.html", "new index");
    await output.put("guide.html", "new guide");
    expect(await live()).toEqual(before);
    await output.commit();
    const after = await generation(root);
    expect(after["index.html"]).toBe("new index");
    expect(after["guide.html"]).toBe("new guide");
    expect(Object.keys(after).sort()).toEqual([".sourcey-output.json", "guide.html", "index.html"]);
  });

  it("checks every prune conflict before replacing any output", async () => {
    const root = await fixture();
    await writeFile(join(root, "retired.html"), "edited outside compiler");
    const before = await generation(root);
    await expect(writeArtifacts(root, new Map([["index.html", "new index"]]))).rejects.toThrow(
      "Refusing to prune",
    );
    expect(await generation(root)).toEqual(before);
  });

  it.each(["index.html", ".sourcey-output.json"])(
    "restores replaced and pruned bytes when promotion of %s fails",
    async (target) => {
      const root = await fixture(),
        before = await generation(root);
      fault.promotion = join(root, target);
      await expect(
        writeArtifacts(
          root,
          new Map([
            ["index.html", "new index"],
            ["nested/new.html", "new page"],
          ]),
        ),
      ).rejects.toThrow("Injected promotion failure");
      expect(await generation(root)).toEqual(before);
    },
  );

  it("leaves the last generation intact when staging fails", async () => {
    const root = await fixture(),
      before = await generation(root);
    fault.staging = true;
    await expect(writeArtifacts(root, new Map([["index.html", "new index"]]))).rejects.toThrow(
      "Injected staging failure",
    );
    expect(await generation(root)).toEqual(before);
  });

  it("keeps recovery bytes if the filesystem also refuses rollback", async () => {
    const root = await fixture();
    fault.promotion = join(root, ".sourcey-output.json");
    fault.rollback = join(root, "index.html");
    await expect(writeArtifacts(root, new Map([["index.html", "new index"]]))).rejects.toThrow(
      "recovery files remain",
    );
    const recovery = (await readdir(root)).find((name) => name.startsWith(".sourcey-write-"))!;
    const backups = await readdir(join(root, recovery));
    const contents = await Promise.all(
      backups
        .filter((name) => name.endsWith(".previous"))
        .map((name) => readFile(join(root, recovery, name), "utf8")),
    );
    expect(contents).toContain("old index");
  });

  it("does not rewrite unchanged artifacts and safely prunes old owned files", async () => {
    const root = await fixture(),
      path = join(root, "index.html");
    const before = await stat(path, { bigint: true });
    await writeArtifacts(
      root,
      new Map([
        ["index.html", "old index"],
        ["new.html", "new page"],
      ]),
    );
    expect((await stat(path, { bigint: true })).mtimeNs).toBe(before.mtimeNs);
    expect(await readdir(root)).toEqual(
      expect.arrayContaining(["index.html", "new.html", ".sourcey-output.json"]),
    );
    expect(await readdir(root)).not.toContain("retired.html");
    const inventory = join(root, ".sourcey-output.json");
    const inventoryBefore = await stat(inventory, { bigint: true });
    await writeArtifacts(root, new Map([["new.html", "new page"], ["index.html", "old index"]]));
    expect((await stat(path, { bigint: true })).mtimeNs).toBe(before.mtimeNs);
    expect((await stat(inventory, { bigint: true })).mtimeNs).toBe(inventoryBefore.mtimeNs);
  });

  it("keeps a committed generation successful if backup cleanup fails", async () => {
    const root = await fixture();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      fault.cleanup = true;
      await expect(
        writeArtifacts(root, new Map([["index.html", "new index"]])),
      ).resolves.toBeUndefined();
      expect(await readFile(join(root, "index.html"), "utf8")).toBe("new index");
      expect(
        Object.keys(JSON.parse(await readFile(join(root, ".sourcey-output.json"), "utf8"))),
      ).toEqual(["index.html"]);
      expect(warning).toHaveBeenCalledOnce();
    } finally {
      warning.mockRestore();
    }
  });

  it("rejects a directory at a file target before promotion", async () => {
    const root = await fixture(),
      before = await readFile(join(root, "index.html"), "utf8");
    await mkdir(join(root, "blocked"));
    await expect(
      writeArtifacts(
        root,
        new Map([
          ["index.html", "new index"],
          ["blocked", "file"],
        ]),
      ),
    ).rejects.toThrow();
    expect(await readFile(join(root, "index.html"), "utf8")).toBe(before);
  });
});
