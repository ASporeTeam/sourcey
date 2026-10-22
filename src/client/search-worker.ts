import { loadSearchIndex } from "./search-index.js";
import type { SearchResult } from "../core/search-artifacts.js";

export type SearchRequest = { id: number; kind: "load"; urls: string[] } | { id: number; kind: "query"; query: string } | { id: number; kind: "more"; of: number };
/** Results in the order shown; `more` says the query has further results to read. */
export type SearchResponse = { id: number; rows: SearchResult[]; more?: boolean; error?: never } | { id: number; error: string; rows?: never };
let indexes: Awaited<ReturnType<typeof loadSearchIndex>>[] = [];
/** The most results a query shows, and how many are read at a time: a result's fragment is read only when it is shown. */
const LIMIT = 50, BATCH = 10;

/** The current query, by its request: its results ranked across every index, how far they have been read, and the addresses shown. */
let current: { id: number; ranked: { index: number; id: number }[]; next: number; seen: Set<string> } | undefined;
/** The last query asked for; one that finishes ranking after a later one was asked shows nothing. */
let latest = 0;

/** The next results of query `of`; a request for a query since replaced reads nothing. */
async function batch(of: number): Promise<{ rows: SearchResult[]; more: boolean }> {
  const query = current, rows: SearchResult[] = [];
  if (!query || query.id !== of) return { rows, more: false };
  const open = () => query.next < query.ranked.length && query.seen.size < LIMIT;
  while (rows.length < BATCH && open()) {
    const slice = query.ranked.slice(query.next, query.next + BATCH - rows.length);
    query.next += slice.length;
    for (const row of await Promise.all(slice.map(({ index, id }) => indexes[index].result(id)))) {
      // A page two indexes both hold shows once, where it ranks first.
      if (query.seen.has(row.url) || query.seen.size >= LIMIT) continue;
      query.seen.add(row.url);
      rows.push(row);
    }
  }
  return { rows, more: open() };
}

self.addEventListener("message", async (event: MessageEvent<SearchRequest>) => {
  const request = event.data;
  try {
    if (request.kind === "load") {
      indexes = await Promise.all(request.urls.map(url => loadSearchIndex(url)));
      // Search opens on the rows the build chose, in its order.
      const seen = new Set<string>();
      const rows = indexes.flatMap(index => index.openings).sort((a, b) => a.start - b.start)
        .filter(row => !seen.has(row.url) && seen.add(row.url));
      self.postMessage({ id: request.id, rows } satisfies SearchResponse);
      return;
    }
    if (request.kind === "query") {
      latest = request.id;
      const ranked = (await Promise.all(indexes.map(async (index, order) =>
        (await index.rank(request.query, LIMIT)).map(result => ({ ...result, index: order }))))).flat()
        .sort((a, b) => b.score - a.score || a.index - b.index || a.id - b.id);
      if (request.id !== latest) { self.postMessage({ id: request.id, rows: [], more: false } satisfies SearchResponse); return; }
      current = { id: request.id, ranked, next: 0, seen: new Set() };
    }
    self.postMessage({ id: request.id, ...(await batch(request.kind === "more" ? request.of : request.id)) } satisfies SearchResponse);
  } catch (error) {
    self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) } satisfies SearchResponse);
  }
});
