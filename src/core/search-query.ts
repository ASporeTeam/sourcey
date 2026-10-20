import MiniSearch, { type AsPlainObject } from "minisearch";
import SearchableMap from "minisearch/SearchableMap";

export interface SearchRow { kind?: string; title: string; content?: string; searchText?: string; path?: string; qualifiedName?: string; url?: string }
export function normalizeSearch(value: string): string { return value.normalize("NFKC").toLowerCase(); }
/** Deterministic across Node, browsers and ICU versions; no locale-dependent segmenter. */
export function tokenizeSearch(value: string): string[] {
  const words = normalizeSearch(value).match(/[\p{L}\p{N}_]+/gu) ?? [];
  return words.flatMap(word => {
    if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(word)) return [word];
    const points = [...word];
    return [...points, ...points.slice(0, -1).map((p, i) => p + points[i + 1])];
  });
}
const options = {
  fields: ["title", "path", "qualifiedName", "searchText", "content"],
  tokenize: tokenizeSearch,
  searchOptions: { boost: { title: 5, path: 9, qualifiedName: 12, searchText: 1 }, prefix: true, fuzzy: 0.15, maxFuzzy: 6, combineWith: "AND" as const },
};
export type SearchIndex = AsPlainObject;
export type SearchPostings = SearchIndex["index"];
export interface SearchShard { file: string; terms: string[] }
/** One corpus and its global ranking statistics; only posting lists are partitioned. */
export interface SearchManifest<T extends SearchRow> { rows: T[]; index: SearchIndex; shards: SearchShard[] }

/** The same name, singular or plural: "webhook" and "webhooks", "address" and "addresses". */
function sameTerm(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return long === short || long === `${short}s` || long === `${short}es`;
}

export function createSearch<T extends SearchRow>(rows: T[], serialized?: SearchIndex) {
  const index = serialized ? MiniSearch.loadJS(serialized, options) : new MiniSearch(options);
  if (!serialized) index.addAll(rows.map((row, id) => ({ ...row, id })));
  return searchEngine(rows, index);
}

function searchEngine<T extends SearchRow>(rows: T[], index: MiniSearch) {
  function scored(query: string, limit = 50): { row: T; score: number; order: number }[] {
    const normalized = normalizeSearch(query.trim());
    if (!normalized) return [];
    return index.search(normalized).map(result => {
      const row = rows[Number(result.id)];
      const exact = [row.path, row.qualifiedName, row.title].some(field => field && sameTerm(normalizeSearch(field), normalized));
      return { row, score: result.score * (row.kind === "operation" || row.kind === "schema" ? 1.5 : 1) + (exact ? 100000 : 0), order: Number(result.id) };
    }).sort((a,b) => b.score - a.score || a.order - b.order).slice(0, limit);
  }
  return { toJSON: () => index.toJSON(), scored, query: (query: string, limit = 50): T[] => scored(query, limit).map(result => result.row) };
}

/** Reuse MiniSearch's own radix tree and matching rules to route every matching term. */
export function searchShardSelector(shards: SearchShard[]): (query: string) => number[] {
  const vocabulary = new SearchableMap<number>();
  shards.forEach((shard, id) => shard.terms.forEach(term => vocabulary.set(term, id)));
  return query => {
    const selected = new Set<number>();
    for (const term of tokenizeSearch(normalizeSearch(query.trim()))) {
      for (const id of vocabulary.atPrefix(term).values()) selected.add(id);
      const distance = Math.min(options.searchOptions.maxFuzzy, Math.round(term.length * options.searchOptions.fuzzy));
      if (distance) for (const [id] of vocabulary.fuzzyGet(term, distance).values()) selected.add(id);
    }
    return [...selected].sort((a, b) => a - b);
  };
}
