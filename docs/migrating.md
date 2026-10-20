---
title: Migrating to Sourcey
description: Move an existing documentation site to Sourcey once, keeping every page, route and anchor.
---

# Migrating to Sourcey

`sourcey migrate` converts an existing documentation project to native Sourcey once. It writes `sourcey.config.ts`, edits only the content that needs a native form, and leaves every other byte as it was. After the move you maintain an ordinary Sourcey project: nothing reads the old framework's configuration again.

| Coming from | Command | Guide |
| --- | --- | --- |
| Astro, with Starlight or with your own pages and collections | `sourcey migrate astro` | [Astro](migrating/astro.md) |
| MkDocs | `sourcey migrate mkdocs` | [MkDocs](migrating/mkdocs.md) |
| Docusaurus | `sourcey migrate docusaurus` | [Docusaurus](migrating/docusaurus.md) |
| Mintlify | `sourcey migrate mintlify` | [Mintlify](migrating/mintlify.md) |

## How a migration works

1. Sourcey reads the source configuration and content as source code. It never runs your build or installs anything. (Docusaurus configuration is a program; it is loaded with your installed dependencies, as Docusaurus loads it.)
2. It proposes the native configuration and the document edits: navigation, locales, routes, components, includes, code fence metadata and frontmatter.
3. It builds the proposed project in a temporary copy and checks it against the source. Every route the source published must still be published, every heading anchor must still resolve, all prose and code must still be there, and every local image must resolve.
4. Only when every check passes does it write the change.

Run it with `--dry-run` first. The report and the full diff print; nothing is written:

```bash
npx sourcey migrate astro --dry-run
npx sourcey migrate astro
```

## Reading the report

The report lists each changed file with the reason it changed, how many files stayed untouched, how many routes were verified, review notes, and the packages the project now needs or no longer uses.

- **Errors** stop the migration before anything is written. Each names the file and line, says what has no native form, and suggests the one-time decision that resolves it.
- **Review notes** describe changes that were applied but deserve a look, such as styling that does not carry over or a component that became a plain link.

Sourcey never installs or removes packages and never commits. Add `sourcey` to the project, review the diff as you would any change, and uninstall the old framework when nothing else uses it.

## Safety

A migration only applies to files that still hold the bytes it read. If something changes in between, it stops and asks you to run it again. Files are staged on the same disk and moved into place; if writing fails part way, the files already replaced are restored. If the process is interrupted, the next run restores the project before it starts.

Running a migration again on a migrated project proposes no changes.

## Project decisions: the mapping file

Some things live in a project's own code, and a converter cannot infer them. You state them once in a mapping module and pass it with `--mapping`:

```bash
npx sourcey migrate astro --mapping migration.ts
```

```ts
export default {
  // Your components, by module and export, as native components or Markdown.
  components: {
    "./src/components/Callout.tsx": {
      Callout: ({ props }) => ({ component: props.type === "warning" ? "Warning" : "Info", props: { title: props.title ?? "Note" } }),
    },
  },
  // MDX element overrides whose behaviour native Markdown already provides.
  markdown: ["./src/utils/markdown.tsx#components"],
  // Native components you wrote for your own widgets, registered by name.
  definitions: { ConfigOptions: "sourcey/components/config-options.ts" },
};
```

A component mapping receives the element's static attributes, the attributes that are imported bindings (such as an icon object), its children as written, and read-only project helpers (`exists`, `readText`, `imageSize`, `relative`). It returns a native component, Markdown, a fenced block, or an error with a reason. The mapping is read only during the migration and never becomes part of the native configuration.
