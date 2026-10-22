import { SCORE_SCALE, namesFor, queryTerms, rankSearch, typoPrefixes, typosOf, type Postings, type Ranked, type TermIndex } from "../core/search-query.js";
import type { CompactResult, SearchChunk, SearchEntryFile, SearchResult } from "../core/search-artifacts.js";

interface Chunk { words: Map<string, Postings>; names: Map<string, number[]> }

/** The place of the last of `sorted` at or before `value`. */
function placeOf(sorted: readonly string[], value: string): number {
  let low = 0, high = sorted.length;
  while (low < high) { const middle = (low + high) >> 1; if (sorted[middle] <= value) low = middle + 1; else high = middle; }
  return Math.max(0, low - 1);
}

const ids = (gaps: readonly number[]) => { let id = 0; return gaps.map(gap => (id += gap)); };

/** A fragment's results as the dialog shows them: names from the entry's lists, an address beginning `#` on the page before it. */
export function expandFragment(entry: Pick<SearchEntryFile, "categories" | "tabs">, compact: readonly CompactResult[]): SearchResult[] {
  let page = "";
  return compact.map(([title, address, category, tab, method, path, qualifiedName, owner]) => {
    const url = String(address).startsWith("#") ? page + address : String(address);
    page = url.split("#")[0];
    return { title: String(title), url, category: entry.categories[Number(category)], tab: entry.tabs[Number(tab)],
      ...(method != null && { method: String(method) }), ...(path != null && { path: String(path) }),
      ...(qualifiedName != null && { qualifiedName: String(qualifiedName) }), ...(owner != null && { owner: String(owner) }) };
  });
}

/**
 * Browser transport for the published search: the entry first, then only
 * the chunks a query's words and its name fall in, the vocabulary blocks its
 * words' typos are read among, and the fragments of the results shown. A
 * query that matches nothing as written reads the whole vocabulary, for a
 * typo in a word's first letters.
 */
export async function loadSearchIndex(url: string, fetcher: typeof fetch = fetch) {
  const read = async <T>(address: string): Promise<{ data: T; url: string }> => {
    const response = await fetcher(address);
    if (!response.ok) throw new Error(`Search: ${response.status}`);
    return { data: await response.json() as T, url: response.url || address };
  };
  const { data: entry, url: entryUrl } = await read<SearchEntryFile>(url);
  const base = new URL(entry.files, entryUrl).href;
  function once<T>(cache: Map<string, Promise<T>>, name: string, decode: (data: unknown) => T): Promise<T> {
    let pending = cache.get(name);
    if (!pending) {
      pending = read<unknown>(new URL(name, base).href).then(({ data }) => decode(data));
      pending.catch(() => cache.delete(name));
      cache.set(name, pending);
    }
    return pending;
  }

  const chunks = new Map<string, Promise<Chunk>>(), loaded = new Map<number, Chunk>();
  const chunkOf = (key: string) => placeOf(entry.chunks, key);
  /** The places in a sorted directory whose blocks hold keys starting with `prefix`. */
  function* placesFor(directory: readonly string[], prefix: string): Generator<number> {
    let at = placeOf(directory, prefix);
    yield at;
    while (at + 1 < directory.length && directory[at + 1].startsWith(prefix)) yield ++at;
  }
  const chunksFor = (prefix: string) => placesFor(entry.chunks, prefix);
  const need = (places: Iterable<number>) => Promise.all([...new Set(places)].map(place => once(chunks, `c${place}.json`, (data) => {
    const [words, names] = data as SearchChunk;
    const chunk: Chunk = {
      words: new Map(words.map(([term, ...encoded]) => {
        const gaps = encoded.filter((_, at) => at % 2 === 0) as number[], scores = encoded.filter((_, at) => at % 2 === 1) as number[];
        return [term as string, ids(gaps).map((id, at) => [id, scores[at] / SCORE_SCALE] as const)];
      })),
      names: new Map(names.map(([name, ...gaps]) => [name as string, ids(gaps as number[])])),
    };
    loaded.set(place, chunk);
    return chunk;
  })));
  const view: TermIndex = {
    *prefixed(prefix) {
      for (const place of chunksFor(prefix))
        for (const [term, postings] of loaded.get(place)?.words ?? []) if (term.startsWith(prefix)) yield [term, postings];
    },
    postings: (term) => loaded.get(chunkOf(term))?.words.get(term),
    named: (name) => loaded.get(chunkOf(name))?.names.get(name),
  };
  const vocabularies = new Map<string, Promise<string[]>>();
  const words = (places: Iterable<number>) => Promise.all([...new Set(places)].map(place => once(vocabularies, `v${place}.json`, (data) => data as string[])))
    .then(lists => lists.flat());
  const fragments = new Map<string, Promise<SearchResult[]>>();

  return {
    /** The rows search opens on, before anything is typed. */
    openings: entry.openings,
    async rank(query: string, limit = 50): Promise<Ranked[]> {
      const { normalized, terms } = queryTerms(query);
      if (!terms.length) return [];
      const typosIn = async (places: Iterable<number>, anyLetter: boolean) => {
        const typos = typosOf(query, await words(places), anyLetter);
        await need([...typos.values()].flatMap(found => found.map(([term]) => chunkOf(term))));
        return typos;
      };
      const [typos] = await Promise.all([typosIn(typoPrefixes(query).flatMap(prefix => [...placesFor(entry.words, prefix)]), false),
        need([...terms.flatMap(({ term }) => [...chunksFor(term)]), ...namesFor(normalized).map(chunkOf)])]);
      let ranked = rankSearch(view, query, typos);
      if (!ranked.length && typos.size) ranked = rankSearch(view, query, await typosIn(entry.words.keys(), true));
      return ranked.slice(0, limit);
    },
    /** A ranked row as the dialog shows it, from the fragment it is in. */
    async result(id: number): Promise<SearchResult> {
      const place = Math.floor(id / entry.fragment);
      const rows = await once(fragments, `f${place}.json`, (data) => expandFragment(entry, data as CompactResult[]));
      return rows[id - place * entry.fragment];
    },
  };
}
