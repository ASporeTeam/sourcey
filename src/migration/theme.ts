/** Brand colours and fonts from a source framework's stylesheets. */

export type Scheme = "light" | "dark";

/**
 * Hex colour custom properties a stylesheet sets per colour scheme. A
 * `[data-theme=…]` selector names its scheme; plain `:root` is the
 * framework's own default scheme.
 */
export function schemeColours(css: string, rootScheme: Scheme): Record<Scheme, Map<string, string>> {
  const schemes: Record<Scheme, Map<string, string>> = { light: new Map(), dark: new Map() };
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const named = selector.match(/data-theme=['"]?(light|dark)/)?.[1] as Scheme | undefined;
    const scheme = named ?? (/:root/.test(selector) ? rootScheme : undefined);
    if (!scheme) continue;
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) schemes[scheme].set(name, value);
  }
  return schemes;
}

/** Native `theme.colors`: the brand colour, its shade for dark backgrounds, and its darkest shade. */
export function themeColours(primary: string | undefined, light: string | undefined, dark: string | undefined): { colors: { primary: string; light?: string; dark?: string } } | undefined {
  if (!primary) return undefined;
  return { colors: { primary, ...(light ? { light } : {}), ...(dark ? { dark } : {}) } };
}

/** Families a stack starts with when it means the platform's own fonts. */
const PLATFORM = /^(system-ui|-apple-system|blinkmacsystemfont|ui-(sans-serif|serif|monospace|rounded)|sans-serif|serif|monospace|segoe ui|sf mono|sfmono-regular|menlo|monaco|consolas|var\()/i;

/** The family a CSS font stack draws first, or "system" when it starts with the platform's own fonts. */
export function stackFamily(stack: string): string {
  const first = stack.split(",")[0].trim().replace(/^["']|["']$/g, "");
  return !first || PLATFORM.test(first) ? "system" : first;
}

/** The value a stylesheet last gives a custom property, or a property in rules for the given selectors. */
function lastDeclaration(stylesheets: readonly string[], property: string, selectors?: RegExp): string | undefined {
  let found: string | undefined;
  for (const css of stylesheets)
    for (const [, selector, body] of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (selectors && !selector.split(",").some((part) => selectors.test(part.trim()))) continue;
      for (const [, value] of body.matchAll(new RegExp(`(?:^|[;\\s])${property.replace(/[-]/g, "\\-")}\\s*:\\s*([^;]+)`, "g"))) found = value.trim();
    }
  return found;
}

/**
 * Native `theme.fonts` for a framework whose fonts are custom properties with
 * the platform's system stack as their default (Starlight's `--sl-font`,
 * Infima's `--ifm-font-family-base`), read from the site's own stylesheets: a
 * variable, else the `body` and `code` rules. A named family loads from Google
 * Fonts natively; one the site served from its own files is reported, since
 * its stylesheet is not carried over.
 */
export function stylesheetFonts(stylesheets: readonly string[], variables: { sans: string; mono: string }, review: (message: string) => void): { fonts: { sans: string; mono?: string } } {
  const stack = (variable: string, selectors: RegExp) => lastDeclaration(stylesheets, variable) ?? lastDeclaration(stylesheets, "font-family", selectors);
  const sans = stackFamily(stack(variables.sans, /^(:root|html|body)$/) ?? "");
  const mono = stackFamily(stack(variables.mono, /^(code|pre|kbd)$/) ?? "");
  const css = stylesheets.join("\n");
  const google = (family: string) => new RegExp(`fonts\\.googleapis\\.com/css2?\\?[^"')\\s]*family=${family.replace(/ /g, "\\+")}\\b`, "i").test(css);
  const ownFiles = [sans, mono].filter((family) => family !== "system" && !google(family) && new RegExp(`@font-face\\s*\\{[^}]*font-family\\s*:\\s*["']?${family}["']?`, "i").test(css));
  if (ownFiles.length)
    review(`The site serves ${ownFiles.map((family) => `"${family}"`).join(" and ")} from its own font files, which native loads from Google Fonts; to keep serving yours, set theme.fonts.google: false and add their @font-face rules to a theme.css stylesheet`);
  return { fonts: { sans, ...(mono !== "system" ? { mono } : {}) } };
}
