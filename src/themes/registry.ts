/** Built-in themes and their packaged assets. Themes may deliberately share a foundation. */
const sharedCss = ["default/sourcey.css", "default/forms.css"];
const foundation = { client: "index", css: sharedCss };

export const themeDefinitions = {
  default: foundation,
  minimal: foundation,
  "api-first": { client: "index", css: [...sharedCss, "api-first/sourcey.css"] },
  reader: { client: "reader", css: [...sharedCss, "reader/sourcey.css"] },
} as const;

export type ThemeName = keyof typeof themeDefinitions;
