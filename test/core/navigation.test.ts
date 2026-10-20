import { describe, expect, it } from "vitest";
import { buildNavFromSpec, projectNavigation, withActivePage } from "../../src/core/navigation.js";
import type { NormalizedOperation, NormalizedSpec } from "../../src/core/types.js";

const operation: NormalizedOperation = {
  method: "get",
  path: "/cheeses",
  tags: ["Cheese"],
  summary: "List cheeses",
  parameters: [],
  responses: [{ statusCode: "200", description: "OK" }],
  security: [],
  deprecated: false,
};

const spec: NormalizedSpec = {
  info: { title: "Cheese Store", version: "1.0.0" },
  servers: [],
  tags: [
    {
      name: "Cheese",
      description: "Cheese endpoints explain the catalog before the operations.",
      operations: [operation],
    },
  ],
  operations: [operation],
  schemas: {},
  securitySchemes: {},
  webhooks: [],
};

describe("buildNavFromSpec", () => {
  it("links OpenAPI tag groups to their rendered intro sections", () => {
    const nav = buildNavFromSpec(spec, "api");
    const tagGroup = nav.groups.find((group) => group.label === "Cheese");

    expect(tagGroup).toMatchObject({
      id: "tag-cheese",
      href: "api.html#tag-cheese",
      items: [
        {
          id: "operation-cheeses-get",
          href: "api.html#operation-cheeses-get",
          label: "List cheeses",
          method: "get",
        },
      ],
    });
  });

  it("nests a tag in its parent's group, and leaves out a branch with no operations", () => {
    const child = { ...operation, path: "/cheeses/aged", tags: ["Aged"], summary: "List aged cheeses" };
    const tags = [
      { name: "Cheese", operations: [operation] },
      { name: "Aged", summary: "Aged cheeses", parent: "Cheese", operations: [child] },
      { name: "Retired", parent: "Cheese", operations: [] },
      { name: "Catalog", summary: "Catalog", operations: [] },
      { name: "Imports", parent: "Catalog", operations: [] },
    ];
    const nav = buildNavFromSpec({ ...spec, tags, operations: [operation, child] }, "api");
    expect(nav.groups.slice(1).map(group => group.label)).toEqual(["Cheese"]);
    expect(nav.groups[1].items.map(item => item.label)).toEqual(["List cheeses", "Aged cheeses"]);
    expect(nav.groups[1].items[1]).toMatchObject({ id: "tag-aged", items: [{ label: "List aged cheeses" }] });
  });
});

describe("projectNavigation", () => {
  // 120 operations in two families of three sections: past 100, branches away from the page collapse.
  const section = (family: string, name: string) => ({ label: name, id: `${family}-${name}`, items: Array.from({ length: 20 }, (_, index) => ({ label: `${name} ${index}`, href: `/api/${family}-${name}-${index}/`, id: `${family}-${name}-${index}` })) });
  const families = ["public", "admin"].map(family => ({ label: family, id: family, items: ["a", "b", "c"].map(name => section(family, name)) }));
  const nav = { tabs: [{ label: "API", slug: "api", href: "/api/", kind: "spec" as const, groups: families }], activeTabSlug: "api", activePageSlug: "" };

  it("keeps the page's branch whole and the others as links to their sections", () => {
    const [current, other] = projectNavigation(nav, "api", "public-b-3").tabs[0].groups;
    expect(current.items).toHaveLength(3);
    expect((current.items[1] as { items: unknown[] }).items).toHaveLength(20);
    // The family is a heading, reached through its sections; each section links to its start.
    expect(other.href).toBeUndefined();
    expect(other).toMatchObject({ items: [{ label: "a", href: "/api/admin-a-0/", items: [] }, { label: "b", href: "/api/admin-b-0/", items: [] }, { label: "c", href: "/api/admin-c-0/", items: [] }] });
  });

  it("keeps a group without a heading as its entries, never a link without a name", () => {
    const intro = { label: "", items: [{ label: "Introduction", href: "/api/", id: "introduction" }, { label: "Authentication", href: "/api/#authentication", id: "authentication" }] };
    const groups = projectNavigation({ ...nav, tabs: [{ ...nav.tabs[0], groups: [intro, ...families] }] }, "api", "public-b-3").tabs[0].groups;
    expect(groups[0]).toEqual(intro);
  });

  it("shows every family's sections on a page outside them, such as the overview", () => {
    const groups = projectNavigation(nav, "api", "introduction").tabs[0].groups;
    expect(groups.map(group => group.items.map(item => item.label))).toEqual([["a", "b", "c"], ["a", "b", "c"]]);
  });

  it("keeps a single-page reference's whole tree, its operations all sections of that one page", () => {
    const onePage = (group: (typeof families)[number]) => ({ ...group, items: group.items.map(sub => ({ ...sub, items: sub.items.map(item => ({ ...item, href: `/api/#${item.id}` })) })) });
    const single = { ...nav, tabs: [{ ...nav.tabs[0], groups: families.map(onePage) }] };
    const groups = projectNavigation(single, "api", "introduction").tabs[0].groups;
    expect(groups.flatMap(group => group.items.map(sub => (sub as { items: unknown[] }).items.length))).toEqual([20, 20, 20, 20, 20, 20]);
  });
});

describe("withActivePage", () => {
  it("leads previous and next to other pages, past links to sections of a page already listed", () => {
    const tab = { label: "API", slug: "api", href: "/api/", kind: "spec" as const, groups: [
      { label: "", items: [{ label: "Introduction", href: "/api/", id: "introduction" }, { label: "Authentication", href: "/api/#authentication", id: "authentication" }] },
      { label: "Cheese", href: "/api/#tag-cheese", id: "tag-cheese", items: [{ label: "List cheeses", href: "/api/list/", id: "list" }, { label: "Get a cheese", href: "/api/get/", id: "get" }] },
    ] };
    const nav = { tabs: [tab], activeTabSlug: "api", activePageSlug: "" };
    expect(withActivePage(nav, "api", "introduction").adjacentPages).toEqual({ previous: undefined, next: expect.objectContaining({ label: "List cheeses" }) });
    expect(withActivePage(nav, "api", "list").adjacentPages).toEqual({ previous: expect.objectContaining({ label: "Introduction", href: "/api/" }), next: expect.objectContaining({ label: "Get a cheese" }) });
  });
});
