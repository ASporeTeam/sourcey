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

/** The fields a row is found by, and how much a word in each counts. */
export const SEARCH_FIELDS = [["title", 5], ["path", 9], ["qualifiedName", 12], ["searchText", 1], ["content", 1]] as const;
/** An operation or a schema ranks above prose that mentions it as often. */
export const kindBoost = (row: SearchRow) => (row.kind === "operation" || row.kind === "schema" ? 1.5 : 1);
/** A row named by the whole query, as a title, path or qualified name, singular or plural, comes first. */
export const EXACT_BONUS = 100000;
const PREFIX_WEIGHT = 0.375, FUZZY_WEIGHT = 0.45, FUZZY = 0.15, MAX_FUZZY = 6;

/**
 * A word's postings: each row it appears in, by id, with what it adds to
 * that row's score when the word is matched exactly. The score is Okapi BM25
 * over each field with its boost, summed, as MiniSearch scores it, so a query
 * only adds what the build stored.
 */
export type Postings = readonly (readonly [id: number, score: number])[];
/** Scores are kept in thousandths, as an index publishes them, so every reader of it ranks alike. */
export const SCORE_SCALE = 1000;

/** What a query reads from an index: words by prefix or whole, and the rows whole names name. */
export interface TermIndex {
  /** Each word that starts with `prefix`, the prefix itself included, with its postings. */
  prefixed(prefix: string): Iterable<readonly [term: string, postings: Postings]>;
  /** One word's postings. */
  postings(term: string): Postings | undefined;
  /** The rows a whole title, path or qualified name names, normalized. */
  named(name: string): readonly number[] | undefined;
}

/** The names a query can name: itself, singular or plural. */
export function namesFor(normalized: string): string[] {
  const names = [normalized, `${normalized}s`, `${normalized}es`];
  if (normalized.endsWith("s")) names.push(normalized.slice(0, -1));
  if (normalized.endsWith("es")) names.push(normalized.slice(0, -2));
  return names;
}

/** The words a query reads, and the most edits a typo of each may make. */
export function queryTerms(query: string): { normalized: string; terms: { term: string; distance: number }[] } {
  const normalized = normalizeSearch(query.trim());
  return { normalized, terms: tokenizeSearch(normalized).map(term => ({ term, distance: Math.min(MAX_FUZZY, Math.round(term.length * FUZZY)) })) };
}

/** Levenshtein distance up to `limit`, or `limit + 1` beyond it. */
export function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, current[j]);
    }
    if (best > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

export interface Ranked { id: number; score: number }

/**
 * Rank an index's rows for a query as MiniSearch does: every word must
 * match, exactly or as a prefix; a prefix counts less the more it leaves
 * unread; the score is multiplied by the number of distinct words matched;
 * a row the whole query names comes first; ties keep the rows' order.
 * `typos`, the words each query word is a typo of (see `typosOf`), adds
 * what MiniSearch's fuzzy matching adds for them.
 */
export function rankSearch(index: TermIndex, query: string, typos?: ReadonlyMap<string, readonly (readonly [term: string, distance: number])[]>): Ranked[] {
  const { normalized, terms } = queryTerms(query);
  if (!terms.length) return [];
  let combined: Map<number, number> | undefined;
  for (const { term } of terms) {
    const scores = new Map<number, number>();
    const add = (postings: Postings, weight: number) => {
      for (const [id, score] of postings) scores.set(id, (scores.get(id) ?? 0) + weight * score);
    };
    const prefixed = new Set<string>();
    for (const [candidate, postings] of index.prefixed(term)) {
      prefixed.add(candidate);
      const distance = candidate.length - term.length;
      add(postings, distance ? PREFIX_WEIGHT * candidate.length / (candidate.length + 0.3 * distance) : 1);
    }
    for (const [candidate, distance] of typos?.get(term) ?? []) {
      if (!distance || prefixed.has(candidate)) continue;
      add(index.postings(candidate) ?? [], FUZZY_WEIGHT * candidate.length / (candidate.length + distance));
    }
    if (combined) {
      const next = new Map<number, number>();
      for (const [id, score] of scores) { const before = combined.get(id); if (before !== undefined) next.set(id, before + score); }
      combined = next;
    } else combined = scores;
    if (!combined.size) return [];
  }
  if (!combined) return [];
  const quality = new Set(terms.map(({ term }) => term)).size;
  const named = new Set(namesFor(normalized).flatMap(name => index.named(name) ?? []));
  return [...combined].map(([id, score]) => ({ id, score: score * quality + (named.has(id) ? EXACT_BONUS : 0) }))
    .sort((a, b) => b.score - a.score || a.id - b.id);
}

/** The leading letters a typo keeps, whose words a query word's typos are read among. */
export const typoPrefix = (term: string) => [...term].slice(0, 2).join("");
/** The prefixes of the query words a typo can be read in. */
export function typoPrefixes(query: string): string[] {
  return [...new Set(queryTerms(query).terms.filter(({ distance }) => distance).map(({ term }) => typoPrefix(term)))];
}

/**
 * The words of `vocabulary` each query word is a typo of, within the edits
 * its length allows. A typo is an edit after a word's first two letters, as
 * Elasticsearch's `prefix_length` 2 reads one: a word that differs from the
 * query's in those is another word. `anyLetter` lifts that, for a query that
 * matches nothing as written.
 */
export function typosOf(query: string, vocabulary: Iterable<string>, anyLetter = false): Map<string, [string, number][]> {
  const typos = new Map<string, [string, number][]>();
  const words = [...vocabulary];
  for (const { term, distance } of queryTerms(query).terms) {
    if (!distance || typos.has(term)) continue;
    const prefix = typoPrefix(term), found: [string, number][] = [];
    for (const candidate of words) {
      if (!anyLetter && !candidate.startsWith(prefix)) continue;
      const edits = editDistance(term, candidate, distance);
      if (edits <= distance && edits > 0) found.push([candidate, edits]);
    }
    typos.set(term, found);
  }
  return typos;
}
