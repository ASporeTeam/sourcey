---
title: Languages and translations
description: Publish existing translations with matching navigation, language metadata and explicit fallback rules.
---

Keep translations in your repository and declare their directories once. Sourcey builds the pages, navigation and language links from those files.

```ts
import { defineConfig, markdown } from "sourcey";

export default defineConfig({
  i18n: {
    defaultLocale: "en",
    locales: {
      en: { label: "English", path: "", content: "" },
      fr: { label: "Français", path: "fr", content: "fr" },
      ar: { label: "العربية", lang: "ar", dir: "rtl", path: "ar", content: "ar" },
    },
    fallback: "default",
  },
  navigation: {
    tabs: [{
      id: "guides",
      tab: "Guides",
      slug: "",
      source: markdown({
        root: "docs",
        groups: [{ group: "Start", pages: ["introduction", "install"] }],
      }),
    }],
  },
});
```

This reads English from `docs/`, French from `docs/fr/` and Arabic from `docs/ar/`. The French installation page is served at `/fr/install.html`, or `/fr/install/` with directory URLs.

`label` is the reader-facing choice. `lang` supplies the HTML language code; it defaults to the locale key. `dir` declares reading direction and defaults to `ltr`. Content directory and URL path need not have the same name.

## Missing translations

With `fallback: "default"`, a missing page uses the original content and tells the reader. Its canonical URL points to the original; Sourcey does not advertise that fallback as a completed translation or add it to the translated search-engine index.

Use `fallback: false` when every declared page must have a translation. A missing file then fails the build with its source path.

## Page titles and navigation

Translate the title and body in each file. Keep the same frontmatter `id` when the translated filename or slug differs, so the language selector can find the corresponding document.

Optional UI and navigation overrides belong to that locale:

```ts
fr: {
  label: "Français",
  messages: {
    searchPlaceholder: "Rechercher dans les guides…",
    navigation: { introduction: "Introduction", install: "Installation" },
  },
},
```

Navigation overrides use the authored page reference or stable document ID. They do not rename files or change routes. English, French, Spanish and Italian have built-in UI messages; an authored override takes precedence. Other languages use English UI text for any message you have not supplied.

A tab can provide a `translations` source map when translated material is a different input, such as a separately maintained OpenAPI specification. The selected source replaces that tab's source for the locale; it does not merge the two specifications.

## Source content stays authored

Sourcey does not generate translations or track a separate review queue. Existing Git history and review remain the editing workflow. Each build regenerates language links, canonical metadata, scoped search and [readable exports](machine-readable.md) from the declared sources.
