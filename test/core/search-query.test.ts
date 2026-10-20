import { describe, expect, it } from "vitest";
import { createSearch, type SearchRow } from "../../src/core/search-query.js";

const rows: SearchRow[] = [
  { kind: "operation", title: "Update existing webhook.", path: "/v1/webhooks/{id}", searchText: "Update an existing webhook." },
  { kind: "operation", title: "Store a new webhook", path: "/v1/webhooks", searchText: "Creates a webhook." },
  { kind: "operation", title: "Delete a webhook.", path: "/v1/webhooks/{id}", searchText: "Deletes a webhook." },
  { title: "Webhooks", searchText: "Firefly III can send a webhook message when a transaction is created." },
  { title: "Addresses", searchText: "Where mail goes." },
];

describe("search ranking", () => {
  it("puts the page named by the query first, singular or plural, ahead of the endpoints that mention it", () => {
    const search = createSearch(rows);
    expect(search.query("webhook")[0].title).toBe("Webhooks");
    expect(search.query("webhooks")[0].title).toBe("Webhooks");
    expect(search.query("address")[0].title).toBe("Addresses");
  });
});
