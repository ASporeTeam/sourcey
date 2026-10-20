import { createHash } from "node:crypto";
import { copyFile, readFile, readdir, mkdtemp, rm, realpath } from "node:fs/promises";
import { resolve, dirname, join, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { build as viteBuild, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";
import preact from "@preact/preset-vite";
import { resolveThemeAssets } from "../themes/assets.js";
import type { ThemeName } from "../config.js";
import { cachedArtifacts } from "../core/artifact-cache.js";
import { langIconCSS } from "../utils/lang-icons.js";
import type { RenderAssetPaths } from "./context.js";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const languageIconsModule = "virtual:sourcey-language-icons.css";
export const languageIconsDevUrl = `/@id/__x00__${languageIconsModule}?direct`;
/** One generated stylesheet for both Vite development and static bundling. */
export function languageIconsPlugin(): Plugin {
  return {
    name: "sourcey-language-icons",
    resolveId(id) { if (id === languageIconsModule) return "\0" + id; },
    load(id) { if (id === "\0" + languageIconsModule) return langIconCSS(); },
  };
}
export interface EngineAssets {
  files: Map<string, Buffer>;
  paths: RenderAssetPaths;
}
const builds = new Map<string, Promise<EngineAssets>>();
export async function buildAssets(
  theme: ThemeName,
  consoleEnabled: boolean,
): Promise<EngineAssets> {
  const mode = process.env.NODE_ENV ?? "production";
  const key = JSON.stringify([projectRoot, theme, consoleEnabled, mode]);
  let build = builds.get(key);
  if (!build) {
    build = cachedArtifacts(
      "engine-assets",
      JSON.stringify([theme, consoleEnabled, mode]),
      ["vite", "@preact/preset-vite", "@tailwindcss/vite", "preact", "minisearch"],
      async () => {
        const dir = await mkdtemp(join(tmpdir(), "sourcey-assets-"));
        try {
          await bundleAssets(dir, theme, consoleEnabled);
          const files = new Map<string, Buffer>();
          async function walk(root: string, prefix = "") {
            for (const entry of await readdir(root, { withFileTypes: true })) {
              const path = prefix + entry.name;
              if (entry.isDirectory()) await walk(join(root, entry.name), path + "/");
              else files.set(path, await readFile(join(root, entry.name)));
            }
          }
          await walk(dir);
          return files;
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      },
    ).then(files => {
      // Hash the complete module closure. Keeping the emitted relative layout
      // intact also preserves worker URLs and lazy module imports.
      const hash = createHash("sha256");
      for (const [name, body] of [...files].sort(([a], [b]) => a.localeCompare(b)))
        hash.update(name).update("\0").update(body).update("\0");
      const prefix = `_assets/${hash.digest("hex").slice(0, 20)}/`;
      return {
        files: new Map([...files].map(([name, body]) => [prefix + name, body])),
        paths: {
          styles: [prefix + "sourcey.css"],
          client: prefix + "sourcey.js",
          theme: prefix + "sourcey-theme.js",
          search: prefix + "sourcey-search.js",
          tryIt: consoleEnabled ? prefix + "sourcey-try-it.js" : undefined,
        },
      };
    });
    builds.set(key, build);
    build.catch(() => builds.delete(key));
  }
  return build;
}
async function bundleAssets(
  outputDir: string,
  theme: ThemeName,
  consoleEnabled: boolean,
): Promise<void> {
  const { clientEntry, sourceyCssPaths, themeInit, tryItEntry, searchEntry } =
    resolveThemeAssets(theme);

  await viteBuild({
    root: projectRoot,
    configFile: false,
    publicDir: false,
    logLevel: "silent",
    plugins: [
      preact(),
      {
        name: "sourcey-engine-styles",
        // Foundation is the entry's first import. Add component/theme styles
        // after it so the complete cascade passes through Vite's minifier.
        transform(code, id) {
          if (id === clientEntry)
            return code + "\n" + sourceyCssPaths.map(path => `import ${JSON.stringify(path)};`).join("\n") + `\nimport ${JSON.stringify(languageIconsModule)};`;
        },
      },
      languageIconsPlugin(),
      tailwindcss(),
    ],
    build: {
      outDir: outputDir,
      emptyOutDir: false,
      cssMinify: true,
      minify: true,
      lib: {
        entry: clientEntry,
        formats: ["iife"],
        name: "Sourcey",
        fileName: () => "sourcey.js",
      },
      rollupOptions: {
        output: {
          entryFileNames: "sourcey.js",
          assetFileNames: "sourcey.[ext]",
        },
      },
    },
  });

  await viteBuild({
    root: projectRoot,
    configFile: false,
    publicDir: false,
    base: "./",
    worker: { format: "es" },
    logLevel: "silent",
    build: {
      outDir: outputDir,
      emptyOutDir: false,
      minify: true,
      lib: { entry: searchEntry, formats: ["es"], fileName: () => "sourcey-search.js" },
    },
  });
  if (consoleEnabled) {
    await viteBuild({
      root: projectRoot,
      configFile: false,
      publicDir: false,
      logLevel: "silent",
      plugins: [preact()],
      build: {
        outDir: outputDir,
        emptyOutDir: false,
        minify: true,
        lib: { entry: tryItEntry, formats: ["es"], fileName: () => "sourcey-try-it.js" },
      },
    });
  }

  await copyFile(themeInit, resolve(outputDir, "sourcey-theme.js"));
}

interface ComponentBundle {
  entry: string;
  css: string[];
  files: Map<string, Buffer>;
  dependencies: string[];
}
const componentBuilds = new Map<string, { bundle: ComponentBundle; digests: string[] }>();
export async function buildComponentAssets(
  client: { entry: string; css?: string[] },
  input: import("../core/loader.js").InputReader,
  owner: string,
  root: string,
): Promise<ComponentBundle> {
  const entry = await realpath(resolve(root, client.entry)),
    css = await Promise.all((client.css ?? []).map((file) => realpath(resolve(root, file))));
  const key = JSON.stringify([entry, css]);
  const cached = componentBuilds.get(key);
  const files = cached?.bundle.dependencies ?? [entry, ...css];
  const digests = await Promise.all(
    files.map(async (file) => (await input.read(file, owner)).digest),
  );
  if (cached && JSON.stringify(digests) === JSON.stringify(cached.digests)) return cached.bundle;
  const directory = await mkdtemp(join(tmpdir(), "sourcey-component-"));
  const dependencies = new Set<string>([entry, ...css]);
  try {
    await viteBuild({
      root,
      configFile: false,
      publicDir: false,
      logLevel: "silent",
      plugins: [
        {
          name: "sourcey-component-inputs",
          enforce: "pre",
          async load(id) {
            const file = id.split("?")[0];
            if (!isAbsolute(file) || file.includes("/node_modules/")) return;
            dependencies.add(file);
            const source = await input.read(file, owner);
            if (/\.(?:[cm]?[jt]sx?|css|json)$/.test(file) && !id.includes("?"))
              return source.body.toString("utf8");
          },
          transform(code, id) {
            if (id.split("?")[0] === entry)
              return css.map((file) => `import ${JSON.stringify(file)};`).join("\n") + "\n" + code;
          },
          buildEnd() {
            for (const id of this.getModuleIds()) {
              const file = id.split("?")[0];
              if (isAbsolute(file) && !file.includes("/node_modules/")) dependencies.add(file);
            }
          },
          async generateBundle(_options, bundle) {
            for (const asset of Object.values(bundle)) {
              if (asset.type !== "asset") continue;
              for (const file of asset.originalFileNames) {
                if (!isAbsolute(file) || file.includes("/node_modules/")) continue;
                dependencies.add(file);
                const source = await input.read(file, owner);
                if (
                  !file.endsWith(".css") &&
                  asset.originalFileNames.length === 1 &&
                  !Buffer.from(asset.source).equals(source.body)
                )
                  throw new Error(`Component asset changed while bundling: ${file}`);
              }
            }
          },
        },
      ],
      build: {
        outDir: directory,
        emptyOutDir: false,
        minify: true,
        // Named here, so a component's styles build in a project without a package name.
        lib: { entry, formats: ["es"], fileName: () => "component.js", cssFileName: "component" },
        rollupOptions: {
          output: { assetFileNames: "[name]-[hash][extname]", chunkFileNames: "[name]-[hash].js" },
        },
      },
    });
    const local = new Map<string, Buffer>();
    async function walk(dir: string, prefix = "") {
      for (const item of await readdir(dir, { withFileTypes: true })) {
        if (item.isDirectory()) await walk(join(dir, item.name), prefix + item.name + "/");
        else local.set(prefix + item.name, await readFile(join(dir, item.name)));
      }
    }
    await walk(directory);
    const hash = createHash("sha256");
    for (const [name, body] of [...local].sort(([a], [b]) => a.localeCompare(b)))
      hash.update(name).update(body);
    const prefix = `_components/${hash.digest("hex").slice(0, 20)}/`;
    for (const file of dependencies) {
      const frozen = await input.read(file, owner);
      if (
        createHash("sha256")
          .update(await readFile(file))
          .digest("hex") !== frozen.digest
      )
        throw new Error(`Component input changed while bundling: ${file}`);
    }
    const bundle = {
      entry: prefix + "component.js",
      css: [...local.keys()].filter((file) => file.endsWith(".css")).map((file) => prefix + file),
      files: new Map([...local].map(([name, body]) => [prefix + name, body])),
      dependencies: [...dependencies],
    };
    componentBuilds.set(key, {
      bundle,
      digests: await Promise.all(
        bundle.dependencies.map(async (file) => (await input.read(file, owner)).digest),
      ),
    });
    if (componentBuilds.size > 32) componentBuilds.delete(componentBuilds.keys().next().value!);
    return bundle;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
