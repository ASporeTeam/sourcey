import { describe, expect, it } from "vitest";
import { access, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyChanges, hasInterrupted, ProjectFiles, recoverInterrupted, RECOVERY_DIRECTORY } from "../../src/migration/project-files.js";
import { read, withProject } from "./helpers.js";

describe("ProjectFiles", () => {
  it("records proposals without writing, and reports only real changes", async () => {
    await withProject({ "a.md": "one\n", "b.md": "two\n" }, async (root) => {
      const project = new ProjectFiles(root);
      expect(await project.readText("a.md")).toBe("one\n");
      await project.readText("b.md");
      project.write("a.md", "changed\n", "edit");
      project.write("b.md", "two\n", "same bytes");
      project.write("c.md", "new\n", "create");

      expect(await project.readText("a.md")).toBe("changed\n");
      expect(await project.readOriginalText("a.md")).toBe("one\n");
      expect(await read(root, "a.md")).toBe("one\n");
      const changes = await project.changes();
      expect(changes.map((change) => [change.path, change.expectedSha256 === null])).toEqual([
        ["a.md", false],
        ["c.md", true],
      ]);
      expect(project.unchanged()).toEqual(["b.md"]);
    });
  });

  it("refuses paths outside the project and through symbolic links", async () => {
    await withProject({ "inside/page.md": "x\n" }, async (root) => {
      await symlink(join(root, "inside"), join(root, "linked"));
      const project = new ProjectFiles(root);
      expect(() => project.write("../escape.md", "x", "escape")).toThrow(/outside the project/);
      await expect(project.readText("linked/page.md")).rejects.toThrow(/symbolic link/);
    });
  });
});

describe("applyChanges", () => {
  it("applies every change when the files still hold the bytes they were read with", async () => {
    await withProject({ "a.md": "one\n", "gone.md": "bye\n" }, async (root) => {
      const project = new ProjectFiles(root);
      await project.readText("a.md");
      project.write("a.md", "changed\n", "edit");
      project.write("nested/new.md", "new\n", "create");
      project.remove("gone.md", "remove");
      await applyChanges(root, await project.changes());

      expect(await read(root, "a.md")).toBe("changed\n");
      expect(await read(root, "nested/new.md")).toBe("new\n");
      await expect(access(join(root, "gone.md"))).rejects.toThrow();
      expect(await hasInterrupted(root)).toBe(false);
    });
  });

  it("refuses to apply over an edit made after preparation, writing nothing", async () => {
    await withProject({ "a.md": "one\n", "b.md": "two\n" }, async (root) => {
      const project = new ProjectFiles(root);
      await project.readText("a.md");
      await project.readText("b.md");
      project.write("a.md", "changed\n", "edit");
      project.write("b.md", "changed\n", "edit");
      const changes = await project.changes();
      await writeFile(join(root, "b.md"), "edited meanwhile\n");

      await expect(applyChanges(root, changes)).rejects.toThrow(/b\.md changed after the migration was prepared/);
      expect(await read(root, "a.md")).toBe("one\n");
      expect(await read(root, "b.md")).toBe("edited meanwhile\n");
    });
  });

  it("restores an interrupted application on the next run", async () => {
    await withProject({ "a.md": "original\n" }, async (root) => {
      // The journal as an application leaves it when the process stops after replacing a.md.
      await mkdir(join(root, RECOVERY_DIRECTORY, "backup"), { recursive: true });
      await writeFile(join(root, RECOVERY_DIRECTORY, "backup", "0"), "original\n");
      await writeFile(
        join(root, RECOVERY_DIRECTORY, "journal.json"),
        JSON.stringify({ entries: [{ path: "a.md", backup: "backup/0" }, { path: "created.md", backup: null }] }),
      );
      await writeFile(join(root, "a.md"), "half applied\n");
      await writeFile(join(root, "created.md"), "half applied\n");

      expect(await hasInterrupted(root)).toBe(true);
      expect(await recoverInterrupted(root)).toEqual(["a.md", "created.md"]);
      expect(await read(root, "a.md")).toBe("original\n");
      await expect(access(join(root, "created.md"))).rejects.toThrow();
      expect(await hasInterrupted(root)).toBe(false);
    });
  });
});
