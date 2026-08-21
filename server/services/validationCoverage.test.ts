import { describe, it, expect } from "vitest";
import { buildUrlCoveragePage } from "./validationCoverage";

describe("buildUrlCoveragePage", () => {
  const expected = ["meta", "required-fields", "content-quality"];

  const rows = [
    {
      url: "/a",
      lastFullRunAt: null,
      runMeta: { lastRunAt: "2026-01-01T00:00:00.000Z", byValidator: {} },
    },
    {
      url: "/b",
      lastFullRunAt: "2026-01-02T00:00:00.000Z",
      runMeta: {
        lastRunAt: "2026-01-02T00:00:00.000Z",
        byValidator: { meta: "2026-01-02T00:00:00.000Z" },
      },
    },
    {
      url: "/c",
      lastFullRunAt: "2026-01-03T00:00:00.000Z",
      runMeta: {
        lastRunAt: "2026-01-03T00:00:00.000Z",
        byValidator: {
          meta: "2026-01-03T00:00:00.000Z",
          "required-fields": "2026-01-03T00:10:00.000Z",
          "content-quality": "2026-01-03T00:20:00.000Z",
        },
      },
    },
  ];

  it("computes coverage summary and stale-first order", () => {
    const out = buildUrlCoveragePage(rows, expected, { page: 1, pageSize: 50, filter: "all" });
    expect(out.coverage).toEqual({
      meanPercent: 44,
      fullyCovered: 1,
      totalUrls: 3,
      expectedValidators: 3,
    });
    expect(out.items.map((r) => r.url)).toEqual(["/a", "/b", "/c"]);
    expect(out.items[2].isFresh).toBe(true);
    expect(out.items[2].coveragePercent).toBe(100);
  });

  it("filters and searches", () => {
    const notFresh = buildUrlCoveragePage(rows, expected, { filter: "not_fresh" });
    expect(notFresh.items.map((r) => r.url)).toEqual(["/a", "/b"]);
    const searched = buildUrlCoveragePage(rows, expected, { q: "/c", filter: "all" });
    expect(searched.totalItems).toBe(1);
    expect(searched.items[0].url).toBe("/c");
  });

  it("clamps pageSize and page", () => {
    const out = buildUrlCoveragePage(rows, expected, { pageSize: 999, page: 999 });
    expect(out.pageSize).toBe(200);
    expect(out.page).toBe(1);
  });
});

