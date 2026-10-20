---
title: Documentation versions
description: Keep current and historical documentation together, with separate content roots, stable URLs and matching reference material.
---

Each documentation release points at content you keep in your repository. A build reads those directories; it does not check out old Git commits or install old dependencies.

```ts
import { defineConfig, markdown } from "sourcey";

export default defineConfig({
  versions: {
    default: "current",
    items: [
      { id: "current", label: "Current", path: "", content: "." },
      {
        id: "previous",
        label: "Previous",
        path: "previous",
        content: "./history/previous",
        revision: "release-branch",
        status: "archived",
        notice: "This release is archived. Use Current for new projects.",
        index: false,
      },
    ],
  },
  navigation: {
    tabs: [{
      id: "guides",
      tab: "Guides",
      slug: "",
      source: markdown({
        root: "guides",
        groups: [{ group: "Start", pages: ["introduction", "authentication"] }],
      }),
    }],
  },
});
```

This reads current pages from `guides/` and older pages from `history/previous/guides/`. The previous introduction is published at `/previous/introduction.html`. `prettyUrls: "slash"` makes that `/previous/introduction/`.

The version ID, label, content directory and public path are separate. Changing the label does not move a URL. `revision` sets the source/edit-link revision; it is not a request to fetch that branch.

## Keep document identity stable

The selector matches the logical document ID. A page can keep that ID while changing its title or slug:

```md
---
id: install
title: Install the SDK
slug: setup
---
```

Give the corresponding page the same `id` in each release and translation. The selector links to its actual route. When that document does not exist in a selected release, the selector identifies the release landing page instead.

## Historical navigation

A version item can declare its own `navigation` when the older release has different pages or groups. Keep the same tab IDs across releases. Page order and group labels can change without changing document identity.

An older maintained release keeps its own canonical URLs and is included in the sitemap. `index: false` adds `noindex` and removes archive pages from the sitemap. Archives retain their own machine-readable indexes; the default corpus contains the selected defaults. A notice is authored text; builds do not invent publication dates or an expiry policy.

## Independently released references

Put `versions` on a tab when an API or SDK has a separate release cycle. Its version prefix sits beneath that tab, while other tabs keep their selected default release:

```ts
{
  id: "api",
  tab: "API",
  slug: "api",
  source: openapi("./api/current.yaml"),
  versions: {
    default: "current",
    items: [
      { id: "current", label: "Current", path: "" },
      {
        id: "previous",
        label: "Previous",
        path: "previous",
        source: openapi("./api/previous.yaml"),
      },
    ],
  },
}
```

Import `openapi` from `sourcey` alongside `defineConfig`. The previous reference is published under `/api/previous/`. Use `versions: false` on a tab that should stay outside the site's release history.

## Languages, search and exports

Locales and versions are independent. Their ordinary route order is locale, version, tab, document. Existing URLs can be retained with explicit locale/version paths and per-document routes.

Search loads the active language and release scope. [Machine-readable outputs](machine-readable.md) identify each document's language, content release and corresponding alternatives. The default corpus contains current defaults; an archive has its own index rather than mixing old instructions into current results.
