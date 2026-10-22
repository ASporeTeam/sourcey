import { describe, expect, it } from "vitest";
import { indexSearch } from "../../src/core/search-artifacts.js";
import { editDistance, rankSearch, typosOf, type SearchRow } from "../../src/core/search-query.js";

const rows: SearchRow[] = [
  { kind: "operation", title: "Update existing webhook.", path: "/v1/webhooks/{id}", searchText: "Update an existing webhook." },
  { kind: "operation", title: "Store a new webhook", path: "/v1/webhooks", searchText: "Creates a webhook." },
  { kind: "operation", title: "Delete a webhook.", path: "/v1/webhooks/{id}", searchText: "Deletes a webhook." },
  { title: "Webhooks", searchText: "Firefly III can send a webhook message when a transaction is created." },
  { title: "Addresses", searchText: "Where mail goes." },
];
const index = indexSearch(rows);
const titles = (query: string) => rankSearch(index, query, typosOf(query, index.terms)).map(({ id }) => rows[id].title);

describe("search ranking", () => {
  it("puts the page named by the query first, singular or plural, ahead of the endpoints that mention it", () => {
    expect(titles("webhook")[0]).toBe("Webhooks");
    expect(titles("webhooks")[0]).toBe("Webhooks");
    expect(titles("address")[0]).toBe("Addresses");
  });

  it("matches every word, by prefix, and reads a typo after a word's first two letters", () => {
    expect(titles("store web")).toEqual(["Store a new webhook"]);
    expect(titles("adresses")).toEqual(["Addresses"]);
    // A first letter changed is another word, until nothing else matches.
    expect(titles("eddresses")).toEqual([]);
    expect(rankSearch(index, "eddresses", typosOf("eddresses", index.terms, true)).map(({ id }) => rows[id].title)).toEqual(["Addresses"]);
  });

  it("counts edits up to its limit", () => {
    expect(editDistance("webhook", "webhooks", 2)).toBe(1);
    expect(editDistance("kitten", "sitting", 3)).toBe(3);
    expect(editDistance("kitten", "sitting", 1)).toBe(2);
  });
});
