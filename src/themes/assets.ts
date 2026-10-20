import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { themeDefinitions, type ThemeName } from "./registry.js";

/** The same asset selection is used by development and packaged static builds. */
export function resolveThemeAssets(name: ThemeName) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const source = fileURLToPath(import.meta.url).endsWith(".ts");
  const tree = source ? "src" : "dist";
  const theme = themeDefinitions[name];
  return {
    clientEntry: resolve(root, tree, `client/${theme.client}.${source ? "ts" : "js"}`),
    searchEntry: resolve(root, tree, `client/search-engine.${source ? "ts" : "js"}`),
    tryItEntry: resolve(root, tree, `client/try-it.${source ? "ts" : "js"}`),
    /** The saved-theme script every theme loads before first paint. */
    themeInit: resolve(root, tree, "client/theme-init.js"),
    foundationCss: resolve(root, tree, "themes/default/main.css"),
    sourceyCssPaths: theme.css.map((css) => resolve(root, tree, "themes", css)),
  };
}
