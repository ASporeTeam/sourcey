import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { resolve, dirname, join, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { resolveThemeAssets } from "../themes/assets.js";
import { themeDefinitions } from "../themes/registry.js";
import type { ThemeName } from "../config.js";
import { cachedArtifacts } from "../core/artifact-cache.js";
import { langIconCSS } from "../utils/lang-icons.js";
import type { RenderAssetPaths } from "./context.js";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/** Rolldown otherwise heads each module's code with its path on the machine that bundled it, which the site would publish. */
const bundleOptions = { experimental: { attachDebugInfo: "none" } } as const;
/** Where development serves the code-language icons, the stylesheet a build publishes beside its others. */
export const languageIconsDevUrl = "/@sourcey/sourcey-lang-icons.css";
export function languageIconsPlugin(): Plugin {
  return {
    name: "sourcey-language-icons",
    configureServer(server) {
      server.middlewares.use(languageIconsDevUrl, (_request, response) => {
        response.setHeader("Content-Type", "text/css; charset=utf-8");
        response.end(langIconCSS());
      });
    },
  };
}
export interface EngineAssets {
  files: Map<string, Buffer>;
  paths: RenderAssetPaths;
}
const builds = new Map<string, Promise<EngineAssets>>();

/**
 * Sourcey's own scripts and styles depend on its version, the theme and
 * whether the API console is on, never on the site, so the package carries
 * them built for each theme, and a site's build only reads them. Only a
 * theme's stylesheet and script differ by theme: the files every theme
 * builds the same are kept once, in `shared`.
 */
const prebuilt = resolve(dirname(fileURLToPath(import.meta.url)), "../engine-assets");
const SHARED = "shared";
/** Themes built from the same definition share one build: the first theme to use it names it. */
const themeBuild = (theme: ThemeName) => (Object.keys(themeDefinitions) as ThemeName[]).find(name => themeDefinitions[name] === themeDefinitions[theme])!;
const CONSOLE_SCRIPT = "sourcey-try-it.js";

async function readTree(root: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  async function walk(directory: string, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.isDirectory()) await walk(join(directory, entry.name), path + "/");
      else files.set(path, await readFile(join(directory, entry.name)));
    }
  }
  await walk(root);
  return files;
}

/** Build every theme's assets into the package; `npm run build` runs it once. */
export async function prebuildEngineAssets(): Promise<void> {
  await rm(prebuilt, { recursive: true, force: true });
  const themes = [...new Set((Object.keys(themeDefinitions) as ThemeName[]).map(themeBuild))];
  for (const theme of themes) await bundleAssets(join(prebuilt, theme), theme, true);
  const [first, ...others] = await Promise.all(themes.map(theme => readTree(join(prebuilt, theme))));
  for (const [name, body] of first) {
    if (!others.every(files => files.get(name)?.equals(body))) continue;
    await mkdir(dirname(join(prebuilt, SHARED, name)), { recursive: true });
    await rename(join(prebuilt, themes[0], name), join(prebuilt, SHARED, name));
    for (const theme of themes.slice(1)) await rm(join(prebuilt, theme, name));
  }
}

/** The packaged assets, or none where Sourcey runs from its source, which has none. */
async function packagedAssets(theme: ThemeName, consoleEnabled: boolean): Promise<Map<string, Buffer> | undefined> {
  let files: Map<string, Buffer>;
  try {
    files = new Map([...(await readTree(join(prebuilt, SHARED))), ...(await readTree(join(prebuilt, themeBuild(theme))))]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (!consoleEnabled) files.delete(CONSOLE_SCRIPT);
  return files;
}

export async function buildAssets(
  theme: ThemeName,
  consoleEnabled: boolean,
): Promise<EngineAssets> {
  const mode = process.env.NODE_ENV ?? "production";
  const key = JSON.stringify([projectRoot, theme, consoleEnabled, mode]);
  let build = builds.get(key);
  if (!build) {
    const packaged = mode === "production" ? await packagedAssets(theme, consoleEnabled) : undefined;
    build = (packaged ? Promise.resolve(packaged) : cachedArtifacts(
      "engine-assets",
      JSON.stringify([theme, consoleEnabled, mode]),
      ["vite", "@preact/preset-vite", "@tailwindcss/vite", "preact"],
      async () => {
        const dir = await mkdtemp(join(tmpdir(), "sourcey-assets-"));
        try {
          await bundleAssets(dir, theme, consoleEnabled);
          return await readTree(dir);
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      },
    )).then(files => {
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
          languageIcons: prefix + "sourcey-lang-icons.css",
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
  // Vite and its plugins load only to bundle, which a cached build never does.
  const [{ build: viteBuild }, { default: tailwindcss }, { default: preact }] = await Promise.all([
    import("vite"), import("@tailwindcss/vite"), import("@preact/preset-vite"),
  ]);

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
            return code + "\n" + sourceyCssPaths.map(path => `import ${JSON.stringify(path)};`).join("\n");
        },
      },
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
      rolldownOptions: {
        ...bundleOptions,
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
      rolldownOptions: bundleOptions,
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
        rolldownOptions: bundleOptions,
      },
    });
  }

  await copyFile(themeInit, resolve(outputDir, "sourcey-theme.js"));
  // Only pages that draw code samples show language icons, so they stay out of the stylesheet every page waits on.
  await writeFile(resolve(outputDir, "sourcey-lang-icons.css"), langIconCSS());
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
  const { build: viteBuild } = await import("vite");
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
        rolldownOptions: {
          ...bundleOptions,
          output: { assetFileNames: "[name]-[hash][extname]", chunkFileNames: "[name]-[hash].js" },
        },
      },
    });
    const local = await readTree(directory);
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
