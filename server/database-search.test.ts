import { describe, it, expect, beforeEach } from "vitest";
import {
  normalizeSearchQuery,
  intersectSearchWithFiltersAndBackfill,
  clearDatabaseSearchMemoryCacheForTests,
  getDatabaseSearchCacheStats,
  peekDatabaseSearchCacheL1,
  SEARCH_CACHE_TTL_MS,
} from "./database-search";

describe("normalizeSearchQuery", () => {
  it("trims, lower-cases, and collapses whitespace", () => {
    expect(normalizeSearchQuery("  Job   Guarantee  ")).toBe("job guarantee");
  });
});

describe("intersectSearchWithFiltersAndBackfill", () => {
  it("keeps search rank then backfills from filter-only", () => {
    const searchHits = [
      { slug: "a", question: "A?" },
      { slug: "b", question: "B?" },
    ];
    const filterOnly = [
      { slug: "b", question: "B?" },
      { slug: "c", question: "C?" },
      { slug: "d", question: "D?" },
    ];
    const result = intersectSearchWithFiltersAndBackfill(searchHits, filterOnly, 3);
    expect(result.map((i) => i.slug)).toEqual(["a", "b", "c"]);
  });

  it("stops at remaining slots", () => {
    const result = intersectSearchWithFiltersAndBackfill(
      [{ slug: "a" }, { slug: "b" }],
      [{ slug: "c" }],
      1,
    );
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe("a");
  });
});

describe("search cache L1 helpers", () => {
  beforeEach(() => {
    clearDatabaseSearchMemoryCacheForTests();
  });

  it("starts empty", () => {
    expect(getDatabaseSearchCacheStats("faqs").memoryEntries).toBe(0);
    expect(peekDatabaseSearchCacheL1("faqs", "job guarantee", "en")).toBeNull();
  });
});

describe("SEARCH_CACHE_TTL_MS", () => {
  it("is seven days", () => {
    expect(SEARCH_CACHE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
