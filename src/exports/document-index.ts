import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { createSearch } from "../core/search-query.js";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a documentation record");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected a documentation string");
  return value;
}
function optional(value: unknown): string | undefined { return value === undefined ? undefined : string(value); }
function parseDocumentEntry(value: unknown) {
  const entry = record(value);
  const kind = entry.kind;
  if (kind !== "page" && kind !== "operation" && kind !== "schema") throw new Error("Invalid document kind");
  const file = string(entry.file);
  if (!file.endsWith(".md") || isAbsolute(file) || file.split(/[\\/]/).some(part => part === ".." || !part)) throw new Error(`Unsafe document path: ${file}`);
  const symbols = entry.symbols === undefined ? undefined : (() => {
    if (!Array.isArray(entry.symbols)) throw new Error("Invalid document symbols");
    return entry.symbols.map(value => { const symbol = record(value); return { name: string(symbol.name), kind: string(symbol.kind), anchor: optional(symbol.anchor) }; });
  })();
  const alternates = entry.alternates === undefined ? undefined : (() => {
    if (!Array.isArray(entry.alternates)) throw new Error("Invalid document alternates");
    return entry.alternates.map(value => { const alternate = record(value); return { locale: string(alternate.locale), contentVersion: optional(alternate.contentVersion), url: string(alternate.url), markdown: string(alternate.markdown) }; });
  })();
  return { id: string(entry.id), kind, title: string(entry.title), description: string(entry.description), tab: string(entry.tab),
    url: string(entry.url), markdown: string(entry.markdown), file, searchText: optional(entry.searchText), symbols,
    documentId: optional(entry.documentId), locale: optional(entry.locale), contentLocale: optional(entry.contentLocale),
    contentVersion: optional(entry.contentVersion), versionScope: optional(entry.versionScope), alternates };
}
/** Executable contract owner; exported types are inferred from these validated records. */
export function parseDocumentationIndex(value: unknown) {
  const index = record(value);
  if (index.version !== 1 || !Array.isArray(index.documents)) throw new Error("Expected a Sourcey documents.json version 1 index. Rebuild with Markdown exports enabled.");
  const documents = index.documents.map(parseDocumentEntry);
  const seen = new Set<string>();
  for (const entry of documents) { if (seen.has(entry.id)) throw new Error("Malformed or duplicate document entry."); seen.add(entry.id); }
  return { version: 1 as const, name: string(index.name), documents };
}
export type DocumentationIndex = ReturnType<typeof parseDocumentationIndex>;
export type DocumentationEntry = DocumentationIndex["documents"][number];

export async function openDocumentation(directory: string) {
  const root = await realpath(directory);
  const indexPath = await realpath(resolve(root, "documents.json"));
  if (relative(root, indexPath).startsWith("..") || isAbsolute(relative(root, indexPath)))
    throw new Error("Index resolves outside the built documentation.");
  const index = parseDocumentationIndex(JSON.parse(await readFile(indexPath, "utf8")));
  const byId = new Map(index.documents.map((entry) => [entry.id, entry]));
  const search = createSearch(index.documents.map(entry => ({ ...entry, content: entry.description,
    qualifiedName: entry.symbols?.map(s => s.name).join(" ") })));
  return {
    index,
    async read(id: string): Promise<{ entry: DocumentationEntry; text: string }> {
      const entry = byId.get(id);
      if (!entry) throw new Error(`Unknown document: ${id}`);
      const path = await realpath(resolve(root, entry.file));
      const within = relative(root, path);
      if (within.startsWith("..") || isAbsolute(within))
        throw new Error("Document resolves outside the built documentation.");
      return { entry, text: await readFile(path, "utf8") };
    },
    search(query: string, limit = 10): DocumentationEntry[] {
      return search.query(query, Math.max(1, Math.min(20, limit)));
    },
    symbols(name: string, limit = 10) {
      const needle = name.toLowerCase().trim();
      return needle
        ? index.documents
            .flatMap((entry) =>
              (entry.symbols ?? [])
                .filter((symbol) => symbol.name.toLowerCase().includes(needle))
                .map((symbol) => ({
                  ...symbol,
                  document: entry.id,
                  url: symbol.anchor ? `${entry.url.split("#", 1)[0]}#${symbol.anchor}` : entry.url,
                })),
            )
            .slice(0, Math.max(1, Math.min(20, limit)))
        : [];
    },
  };
}
