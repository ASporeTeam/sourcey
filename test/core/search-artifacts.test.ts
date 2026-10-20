import { describe, expect, it } from "vitest";
import { buildSearchArtifacts } from "../../src/core/search-artifacts.js";
import type { SearchEntry } from "../../src/core/search-indexer.js";
import { createSearch } from "../../src/core/search-query.js";
import { loadSearchIndex } from "../../src/client/search-index.js";

const WORDS = ["account", "budget", "currency", "transaction", "webhook", "piggy", "rule", "tag", "category", "report", "import", "export", "liability", "recurrence", "subscription", "attachment"];

/** A corpus large enough to shard: each row's words differ, so postings spread across the vocabulary. */
function corpus(count: number): SearchEntry[] {
  return Array.from({ length: count }, (_, index) => {
    const words = WORDS.filter((_, word) => (index + word) % 5 === 0);
    return {
      title: `${words[0]} ${index}`,
      content: `About ${words.join(" ")}.`,
      searchText: `${words.join(" ")} unique${index} term${index % 97} ${"filler".repeat(1 + (index % 3))}`,
      url: `/page-${index}/`, tab: "docs", category: "Guides",
    };
  });
}

/** A static host over the built artifacts, counting what the browser asks for. */
function host(files: Map<string, string>) {
  const requested: string[] = [];
  const fetcher = (async (url: string) => {
    const path = new URL(url).pathname.slice(1);
    requested.push(path);
    const body = path === "_search/context.json" ? JSON.stringify({ index: [...files.keys()].at(-1)!.slice("_search/".length) }) : files.get(path);
    return body === undefined ? new Response(null, { status: 404 }) : new Response(body, { status: 200 });
  }) as typeof fetch;
  return { requested, fetcher };
}

describe("search artifacts", () => {
  it("keeps a small site's index whole", () => {
    const { files } = buildSearchArtifacts(corpus(20));
    expect(files.size).toBe(1);
    expect(JSON.parse([...files.values()][0]).shards).toEqual([]);
  });

  it("shards a large index's postings and answers every query as the whole index does", async () => {
    const rows = corpus(6000);
    const { path, files } = buildSearchArtifacts(rows);
    expect(files.size).toBeGreaterThan(3);
    expect(path).toBe([...files.keys()].at(-1));
    const whole = createSearch(rows);
    const { requested, fetcher } = host(files);
    const index = await loadSearchIndex("https://docs.test/_search/context.json", fetcher);
    for (const query of ["transaction", "budg", "curency", "piggy rule", "unique4321", "term42 webhook", "nothing-matches"]) {
      const expected = whole.scored(query).map((result) => result.row.url);
      expect((await index.scored(query)).map((result) => result.row.url), query).toEqual(expected);
    }
    // A query reads the manifest and only the postings its terms can match.
    const shards = files.size - 1;
    const before = requested.length;
    await index.scored("unique1234");
    expect(requested.length - before).toBeLessThan(shards);
  });
});
