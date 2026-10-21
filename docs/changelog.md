---
title: Changelog
description: Recent Sourcey releases.
---

# Changelog

## 3.8.2

Under Astro, a page search engines are not to index, such as the documentation's missing-page page, is no longer listed in the host's sitemap. The build no longer reports a Rust, Go or C++ reference page's section links as missing fragments. `sourcey dev` shows the code-language icons on code samples, as a build does.

Reference pages meet WCAG AA contrast in every theme, light and dark, keep their headings in order, and name every landmark in the site's language. A site that sets only its primary colour gets link and accent shades that read in both schemes. Rust reference pages show their signature, stability and doctest colours. A version or language with its own home page builds with `.html` URLs, and its pages point agents at its own `llms.txt`. A version's notice, and the notice that a page is not yet translated, now show over the page in the minimal theme and on phones. C++ reference links reach the page that documents each symbol, and request samples show JSON bodies over several lines in every language.

## 3.8.1

Pages without code samples no longer wait on the code-language icons before they paint: the icons are a stylesheet of their own, linked by the reference pages that draw them.

## 3.8.0

Documentation can publish versions and languages with route-aware selectors, every API operation has a Try it console, and site pages such as a home page publish beside the docs in a layout of their own. One-time migrations convert Astro, Docusaurus, Mintlify and MkDocs projects to native configuration with route and fragment checks. Large references can give each operation its own page, search downloads only the index shards a query needs, and engine files are named by their content so hosts can cache them indefinitely. See the [complete release notes](https://github.com/sourcey/sourcey/blob/main/CHANGELOG.md#380---2026-10-20).

## 3.7.1

Markdown views now accompany every page, API operation and schema. Configure public OpenAPI bundles and scoped ARD/API discovery, or query a built directory with the separate `sourcey-docs-mcp` package. Rich guides and native library examples retain their readable content in the exports. See [documentation for agents](machine-readable.md).

## 3.7.0

The `api-first` theme now uses the full width for API and guide pages. C++ references share one declaration card, Go comments use `go/doc/comment`, Rust links preserve native code and resolve across crates, and Markdown imports retain fenced examples and visible heading text. See the [complete release notes](https://github.com/sourcey/sourcey/releases/tag/v3.7.0).

## 3.6.12

Sourcey 3.6.12 adds `landingPage: false` to `sourcey/astro`, so an Astro page can own the mount root, such as a product page at `/docs`, while Sourcey writes every documentation page beneath it.

## 3.6.6

Sourcey 3.6.6 adds the `reader` theme for specifications and long-form documentation, makes `theme.name` the canonical renderer selector, standardizes “Docs by Sourcey” attribution across every theme, and hardens Astro and Cloudflare hosting behavior. The deprecated `theme.preset` key remains accepted through the 3.x line.

## 3.6.5

Sourcey 3.6.5 added the `sourcey/astro` integration so Astro sites can mount generated documentation directly in development and production builds.

## 3.6.4

Sourcey 3.6.4 makes OpenAPI tag introductions reachable from the sidebar, with tag headings in the navigation now linking to their `#tag-name` section, and lets operation descriptions fill the content column instead of confining to the default prose measure when an example or code panel sits alongside them.

## 3.6.3

Sourcey 3.6.3 renders author-provided OpenAPI examples. Named `examples` and a single `example` on responses and request bodies now take priority over the schema-generated shape, every media type is shown rather than only the first, and a switcher moves between multiple examples.

## 3.6.2

Sourcey 3.6.2 fixed Rust re-export (`use` item) rendering so re-exports show their real name and a `pub use` signature instead of an empty placeholder across the sidebar, page outline, and search, and bumped moxygen to 2.1.10 for cleaner `-` separators in C++ reference search snippets.

## 3.6.1

Sourcey 3.6.1 added the native rustdoc adapter with nightly live extraction, snapshot mode for stable CI hosts, rustdoc-style deep links, doctest extraction, and workspace-level Rust API pages.

## 3.6.0

Sourcey 3.6.0 made source adapters the primary tab configuration shape (`source: markdown(...)`, `mkdocs(...)`, `openapi(...)`, `mcp(...)`, `doxygen(...)`, and `godoc(...)`), added MkDocs import for existing `mkdocs.yml` sites, and upgraded generated C++ references with member search, route-mapped source links, examples, modern signatures, inherited members, and relationship sections.

## 3.5.0

Sourcey 3.5.0 shipped OpenAPI 3.2 support, `$self`-aware reference resolution for multi-document descriptions, and the new `prettyUrls` output modes for cleaner hosted paths. It also refreshed the generated OG image template for better readability in link previews.

## 3.4.x

The 3.4 release line added build-time OG image generation, Heroicons support, MCP documentation as a first-class input, sitemap and social metadata, and a long sequence of rendering and developer-experience fixes.

The root `CHANGELOG.md` remains the detailed record. This page is the short view for docs readers who want the shape of recent releases before diving into the full changelog.
