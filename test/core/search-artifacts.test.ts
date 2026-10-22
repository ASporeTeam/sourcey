import { describe, expect, it } from "vitest";
import { buildSearchArtifacts, indexSearch } from "../../src/core/search-artifacts.js";
import type { SearchEntry } from "../../src/core/search-indexer.js";
import { rankSearch, typosOf } from "../../src/core/search-query.js";
import { loadSearchIndex } from "../../src/client/search-index.js";

const WORDS = ["account", "budget", "currency", "transaction", "webhook", "piggy", "rule", "tag", "category", "report", "import", "export", "liability", "recurrence", "subscription", "attachment"];

/** A corpus large enough to split: each row's words differ, so postings spread across the vocabulary. */
function corpus(count: number): SearchEntry[] {
  return Array.from({ length: count }, (_, index) => {
    const words = WORDS.filter((_, word) => (index + word) % 5 === 0);
    return {
      title: `${words[0]} ${index}`,
      content: `About ${words.join(" ")}.`,
      searchText: `${words.join(" ")} unique${index} term${index % 97} ${"filler".repeat(1 + (index % 3))}`,
      url: `/page-${Math.floor(index / 3)}/${index % 3 ? `#section-${index}` : ""}`, tab: "docs", category: index % 3 ? "Sections" : "Guides",
      ...(index % 50 === 0 && { start: index / 50 }),
    };
  });
}

/** A static host over the built artifacts, counting what the browser asks for. */
function host(entry: object, files: Map<string, string>) {
  const requested: string[] = [];
  const fetcher = (async (url: string) => {
    const path = new URL(url).pathname.slice(1);
    requested.push(path);
    const body = path === "_search/context.json" ? JSON.stringify(entry) : files.get(path);
    return body === undefined ? new Response(null, { status: 404 }) : new Response(body, { status: 200 });
  }) as typeof fetch;
  return { requested, fetcher };
}

/** The in-memory ranking a site's documents export uses: typos after a word's first letters, then in any. */
function rank(index: ReturnType<typeof indexSearch>, query: string) {
  const ranked = rankSearch(index, query, typosOf(query, index.terms));
  return (ranked.length ? ranked : rankSearch(index, query, typosOf(query, index.terms, true))).slice(0, 50);
}

describe("search artifacts", () => {
  it("answers every query from the files it reads as the whole index does, reading only what the query needs", async () => {
    const rows = corpus(6000);
    const { entry, files } = buildSearchArtifacts(rows);
    const whole = indexSearch(rows);
    const { requested, fetcher } = host(entry, files);
    const index = await loadSearchIndex("https://docs.test/_search/context.json", fetcher);
    for (const query of ["transaction", "budg", "curency", "ucrrency", "piggy rule", "unique4321", "term42 webhook", "nothing-matches"]) {
      expect((await index.rank(query)).map(({ id }) => id), query).toEqual(rank(whole, query).map(({ id }) => id));
    }
    const before = requested.length;
    await index.rank("unique1234");
    expect(requested.length - before).toBeLessThan(5);
    expect(files.size).toBeGreaterThan(100);
  });

  it("shows each result as the row it was built from, and opens on the rows the build chose", async () => {
    const rows = corpus(100);
    const { entry, files } = buildSearchArtifacts(rows);
    const index = await loadSearchIndex("https://docs.test/_search/context.json", host(entry, files).fetcher);
    for (const id of [0, 1, 2, 7, 8, 99]) {
      const { title, url, tab, category } = rows[id];
      expect(await index.result(id)).toEqual({ title, url, tab, category });
    }
    expect(index.openings.map(({ url, start }) => [url, start])).toEqual([["/page-0/", 0], ["/page-16/#section-50", 1]]);
  });

  it("names its files by their content and its entry by nothing that changes between builds", () => {
    const first = buildSearchArtifacts(corpus(40)), again = buildSearchArtifacts(corpus(40)), other = buildSearchArtifacts(corpus(41));
    expect([...again.files.keys()]).toEqual([...first.files.keys()]);
    expect(other.entry.files).not.toBe(first.entry.files);
    expect([...first.files.keys()].every((path) => path.startsWith(`_search/${first.entry.files}`))).toBe(true);
  });
});
