import { describe, expect, it } from "vitest";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const run = promisify(execFile);
describe("disposable artifact cache", () => {
  it("reuses verified bytes across processes, rebuilds corruption and invalidates installed dependency changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-artifact-proof-"));
    try {
      await mkdir(join(root, "dist/core"), { recursive: true });
      await mkdir(join(root, "node_modules/cache-fixture"), { recursive: true });
      await mkdir(join(root, "temporary"));
      await writeFile(join(root, "package.json"), '{"type":"module"}');
      await writeFile(
        join(root, "node_modules/cache-fixture/package.json"),
        '{"name":"cache-fixture","version":"0.0.0-fixture","type":"module"}',
      );
      const dependency = join(root, "node_modules/cache-fixture/value.txt");
      await writeFile(dependency, "first bytes");
      await copyFile(
        resolve("dist/core/artifact-cache.js"),
        join(root, "dist/core/artifact-cache.js"),
      );
      const entry = join(root, "proof.mjs");
      await writeFile(
        entry,
        `import {cachedArtifacts} from './dist/core/artifact-cache.js';
import {readFile,appendFile} from 'node:fs/promises';
const files=await cachedArtifacts('test','fixed source',['cache-fixture'],async()=>{
await appendFile(new URL('./builds.txt',import.meta.url),'build\\n');
return new Map([['result.txt',await readFile(new URL('./node_modules/cache-fixture/value.txt',import.meta.url))]]);
});
console.log(files.get('result.txt').toString());`,
      );
      const execute = () =>
        run(process.execPath, [entry], {
          cwd: root,
          env: { ...process.env, TMPDIR: join(root, "temporary") },
        });
      expect((await execute()).stdout.trim()).toBe("first bytes");
      expect((await execute()).stdout.trim()).toBe("first bytes");
      expect(await readFile(join(root, "builds.txt"), "utf8")).toBe("build\n");
      const cacheRoot = join(root, "temporary/sourcey-artifacts");
      const cache = (await readdir(cacheRoot)).find((name) => /^[a-f0-9]{64}$/.test(name))!;
      await writeFile(join(cacheRoot, cache, "0"), "corrupt bytes");
      expect((await execute()).stdout.trim()).toBe("first bytes");
      expect(await readFile(join(root, "builds.txt"), "utf8")).toBe("build\nbuild\n");
      await writeFile(dependency, "changed installed bytes");
      expect((await execute()).stdout.trim()).toBe("changed installed bytes");
      expect(await readFile(join(root, "builds.txt"), "utf8")).toBe("build\nbuild\nbuild\n");
      await rm(cacheRoot, { recursive: true });
      await writeFile(cacheRoot, "cache is unavailable");
      expect((await execute()).stdout.trim()).toBe("changed installed bytes");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
