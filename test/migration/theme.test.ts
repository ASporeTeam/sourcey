import { describe, expect, it } from "vitest";
import { stackFamily, stylesheetFonts } from "../../src/migration/theme.js";

const variables = { sans: "--ifm-font-family-base", mono: "--ifm-font-family-monospace" };

describe("fonts from a site's stylesheets", () => {
  it("names a stack by its first family, or the platform's", () => {
    expect(stackFamily('"Inter", -apple-system, sans-serif')).toBe("Inter");
    expect(stackFamily("system-ui, -apple-system, 'Segoe UI'")).toBe("system");
    expect(stackFamily('"SF Mono", SFMono-Regular, Consolas, monospace')).toBe("system");
    expect(stackFamily("var(--sl-font-system)")).toBe("system");
  });

  it("keeps the framework's system default when the site sets no font", () => {
    const notes: string[] = [];
    expect(stylesheetFonts([":root { --ifm-color-primary: #2e8555; }"], variables, (note) => notes.push(note))).toEqual({ fonts: { sans: "system" } });
    expect(stylesheetFonts([], variables, (note) => notes.push(note))).toEqual({ fonts: { sans: "system" } });
    expect(notes).toEqual([]);
  });

  it("reads the font variables, the last one set winning, and a family imported from Google Fonts needs no note", () => {
    const notes: string[] = [];
    const css = [
      '@import url("https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;700&display=swap");',
      ':root { --ifm-font-family-base: "Inter", sans-serif; }',
      '/* --ifm-font-family-base: "Commented", serif; */ :root { --ifm-font-family-base: "Work Sans", -apple-system; --ifm-font-family-monospace: "JetBrains Mono", monospace; }',
    ].join("\n");
    expect(stylesheetFonts([css], variables, (note) => notes.push(note))).toEqual({ fonts: { sans: "Work Sans", mono: "JetBrains Mono" } });
    expect(notes).toEqual([]);
  });

  it("reads body and code rules when the site sets fonts by selector, and reports families it served itself", () => {
    const notes: string[] = [];
    const css = "@font-face { font-family: 'Lato'; src: url('../fonts/lato.woff2') format('woff2'); }\nbody { font-family: 'Lato', sans-serif; }\nh1, h2 { font-family: 'Poppins', sans-serif; }\ncode { font-family: 'Roboto Mono', monospace; }\n";
    expect(stylesheetFonts([css], variables, (note) => notes.push(note))).toEqual({ fonts: { sans: "Lato", mono: "Roboto Mono" } });
    expect(notes).toEqual(['The site serves "Lato" from its own font files, which native loads from Google Fonts; to keep serving yours, set theme.fonts.google: false and add their @font-face rules to a theme.css stylesheet']);
  });
});
