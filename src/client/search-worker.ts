import { loadSearchIndex } from "./search-index.js";
import type { SearchEntry } from "../core/search-indexer.js";

export type SearchRequest = { id: number; kind: "load"; urls: string[] } | { id: number; kind: "query"; query: string };
export type SearchResponse = { id: number; rows: SearchEntry[]; error?: never } | { id: number; error: string; rows?: never };
let indexes: Awaited<ReturnType<typeof loadSearchIndex>>[] = [];

function unique(rows: SearchEntry[]): SearchEntry[] {
  const seen = new Set<string>();
  return rows.filter(row => { if (seen.has(row.url)) return false; seen.add(row.url); return true; });
}

self.addEventListener("message", async (event: MessageEvent<SearchRequest>) => {
  const request = event.data;
  try {
    let rows: SearchEntry[];
    if (request.kind === "load") {
      indexes = await Promise.all(request.urls.map(url => loadSearchIndex(url)));
      // Search opens on the rows the build chose, in its order.
      rows = unique(indexes.flatMap(index => index.rows).filter(row => row.start !== undefined).sort((a, b) => a.start! - b.start!));
    } else {
      const matches = (await Promise.all(indexes.map(async (index, order) =>
        (await index.scored(request.query, 50)).map(result => ({ ...result, index: order }))))).flat();
      rows = unique(matches.sort((a, b) => b.score - a.score || a.index - b.index || a.order - b.order)
        .map(result => result.row)).slice(0, 50);
    }
    self.postMessage({ id: request.id, rows } satisfies SearchResponse);
  } catch (error) {
    self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) } satisfies SearchResponse);
  }
});
