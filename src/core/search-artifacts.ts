import { createHash } from "node:crypto";
import type { SearchEntry } from "./search-indexer.js";
import { SCORE_SCALE, SEARCH_FIELDS, kindBoost, normalizeSearch, tokenizeSearch, type Postings, type SearchRow, type TermIndex } from "./search-query.js";

/** Okapi BM25's term saturation, length normalization and floor, as MiniSearch sets them. */
const K = 1.2, B = 0.7, D = 0.5;

/** A built index: every word in order with its postings, and the rows each whole name names. */
export interface SearchIndex extends TermIndex {
  readonly terms: readonly string[];
  readonly termPostings: readonly Postings[];
  readonly names: ReadonlyMap<string, readonly number[]>;
}

/**
 * The shortest start of `next` that sorts after `previous`: the entry's
 * directory needs only as much of a block's first key as tells it from the
 * block before.
 */
function separator(previous: string | undefined, next: string): string {
  if (previous === undefined) return "";
  for (let length = 1; length < next.length; length++) if (next.slice(0, length) > previous) return next.slice(0, length);
  return next;
}

function lowerBound(sorted: readonly string[], value: string): number {
  let low = 0, high = sorted.length;
  while (low < high) { const middle = (low + high) >> 1; if (sorted[middle] < value) low = middle + 1; else high = middle; }
  return low;
}

/**
 * Index rows once, scoring each word in each row as MiniSearch would score
 * an exact match of it: BM25 in each field, with the field's boost, summed,
 * from each field's word frequency, its share of rows and its average
 * length, which MiniSearch keeps as a running mean in row order. A row's kind
 * boost is applied here, as it multiplies every score the row gets.
 */
export function indexSearch(rows: readonly SearchRow[]): SearchIndex {
  const averages = SEARCH_FIELDS.map(() => 0);
  const lengths = rows.map(() => new Array<number>(SEARCH_FIELDS.length).fill(0));
  const frequencies = new Map<string, Map<number, number>[]>();
  rows.forEach((row, id) => {
    SEARCH_FIELDS.forEach(([field], f) => {
      const value = row[field];
      if (value == null) return;
      const tokens = tokenizeSearch(String(value));
      lengths[id][f] = new Set(tokens).size;
      averages[f] = (averages[f] * id + lengths[id][f]) / (id + 1);
      for (const term of tokens) {
        let fields = frequencies.get(term);
        if (!fields) frequencies.set(term, (fields = SEARCH_FIELDS.map(() => new Map())));
        fields[f].set(id, (fields[f].get(id) ?? 0) + 1);
      }
    });
  });
  const terms = [...frequencies.keys()].sort();
  const termPostings = terms.map((term): Postings => {
    const scores = new Map<number, number>();
    frequencies.get(term)!.forEach((rowsWith, f) => {
      const boost = SEARCH_FIELDS[f][1];
      const idf = Math.log(1 + (rows.length - rowsWith.size + 0.5) / (rowsWith.size + 0.5));
      for (const [id, tf] of rowsWith)
        scores.set(id, (scores.get(id) ?? 0) + boost * idf * (D + tf * (K + 1) / (tf + K * (1 - B + B * lengths[id][f] / averages[f]))));
    });
    return [...scores].sort((a, b) => a[0] - b[0]).map(([id, score]) => [id, Math.round(score * kindBoost(rows[id]) * SCORE_SCALE) / SCORE_SCALE] as const);
  });
  const names = new Map<string, number[]>();
  rows.forEach((row, id) => {
    for (const field of [row.path, row.qualifiedName, row.title]) {
      if (!field) continue;
      const name = normalizeSearch(field), ids = names.get(name) ?? [];
      if (ids.at(-1) !== id) ids.push(id);
      names.set(name, ids);
    }
  });
  return {
    terms, termPostings, names,
    *prefixed(prefix) {
      for (let at = lowerBound(terms, prefix); at < terms.length && terms[at].startsWith(prefix); at++) yield [terms[at], termPostings[at]];
    },
    postings(term) { const at = lowerBound(terms, term); return terms[at] === term ? termPostings[at] : undefined; },
    named: (name) => names.get(name),
  };
}

/** What a search result shows: the dialog's title, address, part of the site and, for an operation or symbol, its names. */
export type SearchResult = Pick<SearchEntry, "title" | "url" | "category" | "tab" | "method" | "path" | "qualifiedName" | "owner">;
/**
 * A result in a fragment, as an array: title, address, category and tab by
 * their place in the entry's lists, then method, path, qualified name and
 * owner, as far as any is set. An address beginning `#` is on the page of the
 * row before it.
 */
export type CompactResult = (string | number | null)[];

/**
 * The published search entry: where the files are, the first word or name
 * of each chunk in order, the first word of each block of the vocabulary
 * typos are read among, rows per fragment, the lists results name their
 * category and tab from, and the rows search opens on.
 */
export interface SearchEntryFile {
  version: 2;
  files: string;
  chunks: string[];
  words: string[];
  fragment: number;
  categories: string[];
  tabs: string[];
  openings: (SearchResult & { start: number })[];
}
/** One chunk: its words, each with row ids as gaps and scores in thousandths, then its names, each with row ids as gaps. */
export type SearchChunk = [words: (string | number)[][], names: (string | number)[][]];

/** Raw bytes per chunk; a query reads the chunks its words and its name fall in. */
const CHUNK_BYTES = 4 * 1024;
/** Raw bytes per vocabulary block; a query word's typos are read in the blocks its first two letters fall in. */
const WORDS_BYTES = 4 * 1024;
/** Rows per fragment; a result reads the fragment its row is in. */
const FRAGMENT_ROWS = 8;

/**
 * The files search publishes for one language and version: an entry, the
 * chunks of words and names a query reads, the vocabulary in blocks its
 * typos are read among, and fragments of results to show.
 * Every file but the entry is named by its directory's content, so all can be
 * cached for good; the entry keeps one address for every build.
 */
export function buildSearchArtifacts(rows: readonly SearchEntry[]): { entry: SearchEntryFile; files: Map<string, string> } {
  const index = indexSearch(rows);
  const gaps = (ids: readonly number[]) => ids.map((id, at) => (at ? id - ids[at - 1] : id));
  const entries: { key: string; word: boolean; body: (string | number)[] }[] = [
    ...index.terms.map((term, at) => {
      const postings = index.termPostings[at], ids = gaps(postings.map(([id]) => id));
      return { key: term, word: true, body: [term, ...postings.flatMap(([, score], i) => [ids[i], Math.round(score * SCORE_SCALE)])] };
    }),
    ...[...index.names].map(([name, ids]) => ({ key: name, word: false, body: [name, ...gaps(ids)] })),
  ].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.word === b.word ? 0 : a.word ? -1 : 1));

  // A word and the name spelled as it stay in one chunk, so each key is in the chunk its place names.
  const bodies: string[] = [], chunks: string[] = [];
  let chunk: SearchChunk = [[], []], bytes = 0, last: string | undefined;
  const flushChunk = () => { if (chunk[0].length || chunk[1].length) bodies.push(JSON.stringify(chunk)); chunk = [[], []]; bytes = 0; };
  for (const { key, word, body } of entries) {
    const size = JSON.stringify(body).length + 1;
    if (bytes && bytes + size > CHUNK_BYTES && key !== last) flushChunk();
    if (!bytes) chunks.push(separator(last, key));
    chunk[word ? 0 : 1].push(body);
    bytes += size; last = key;
  }
  flushChunk();

  const categories = [...new Set(rows.map(row => row.category))], tabs = [...new Set(rows.map(row => row.tab))];
  const fragments: string[] = [];
  for (let start = 0; start < rows.length; start += FRAGMENT_ROWS) {
    let page = "";
    fragments.push(JSON.stringify(rows.slice(start, start + FRAGMENT_ROWS).map((row): CompactResult => {
      const [path, anchor] = row.url.split(/#(.*)/s);
      const url = path === page && anchor !== undefined ? `#${anchor}` : row.url;
      page = path;
      const compact: CompactResult = [row.title, url, categories.indexOf(row.category), tabs.indexOf(row.tab), row.method ?? null, row.path ?? null, row.qualifiedName ?? null, row.owner ?? null];
      while (compact.at(-1) === null) compact.pop();
      return compact;
    })));
  }
  const blocks: string[][] = [];
  for (let at = 0, bytes = WORDS_BYTES; at < index.terms.length; at++) {
    if (bytes >= WORDS_BYTES) { blocks.push([]); bytes = 0; }
    blocks.at(-1)!.push(index.terms[at]); bytes += index.terms[at].length + 3;
  }
  const words = blocks.map((block, at) => separator(blocks[at - 1]?.at(-1), block[0])), vocabularies = blocks.map(block => JSON.stringify(block));

  const fileNames = [...bodies.map((_, at) => `c${at}.json`), ...vocabularies.map((_, at) => `v${at}.json`), ...fragments.map((_, at) => `f${at}.json`)];
  const contents = [...bodies, ...vocabularies, ...fragments];
  const hash = createHash("sha256");
  fileNames.forEach((name, at) => hash.update(name).update("\0").update(contents[at]).update("\0"));
  const directory = `${hash.digest("hex").slice(0, 20)}/`;
  const files = new Map(fileNames.map((name, at) => [`_search/${directory}${name}`, contents[at]]));
  const openings = rows.filter(row => row.start !== undefined).sort((a, b) => a.start! - b.start!)
    .map(row => ({ title: row.title, url: row.url, category: row.category, tab: row.tab, start: row.start!,
      ...(row.method && { method: row.method }), ...(row.path && { path: row.path }), ...(row.qualifiedName && { qualifiedName: row.qualifiedName }), ...(row.owner && { owner: row.owner }) }));
  return { entry: { version: 2, files: directory, chunks, words, fragment: FRAGMENT_ROWS, categories, tabs, openings }, files };
}
