import { createSearch, searchShardSelector, type SearchManifest, type SearchPostings } from "../core/search-query.js";
import type { SearchEntry } from "../core/search-indexer.js";

/** Browser transport for the native search artifacts; no network is needed after a shard is loaded. */
export async function loadSearchIndex(url: string, fetcher: typeof fetch = fetch) {
  const read = async <T>(url: string): Promise<{ data: T; url: string }> => {
    const response = await fetcher(url);
    if (!response.ok) throw new Error(`Search: ${response.status}`);
    return { data: await response.json() as T, url: response.url || url };
  };
  const context = await read<{ index: string }>(url);
  const { data: manifest, url: indexUrl } = await read<SearchManifest<SearchEntry>>(new URL(context.data.index, context.url).href);
  const select = searchShardSelector(manifest.shards);
  const loaded = new Map<number, Promise<SearchPostings>>();
  const complete = manifest.shards.length ? undefined : createSearch(manifest.rows, manifest.index);
  return {
    rows: manifest.rows,
    async scored(query: string, limit = 50) {
      if (complete) return complete.scored(query, limit);
      const chunks = await Promise.all(select(query).map(id => {
        let chunk = loaded.get(id);
        if (!chunk) {
          chunk = read<SearchPostings>(new URL(manifest.shards[id].file, indexUrl).href)
            .then(result => result.data).catch(error => { loaded.delete(id); throw error; });
          loaded.set(id, chunk);
        }
        return chunk;
      }));
      if (!chunks.length) return [];
      // Retain full-corpus document frequencies and lengths, independent of which chunks are cached.
      return createSearch(manifest.rows, { ...manifest.index, index: chunks.flat() }).scored(query, limit);
    },
  };
}
