import { describe, it, expect } from "vitest";
import type { PageCacheEntry } from "../../scripts/validation/shared/types";
import {
  CACHE_FRESHNESS_MAX_AGE_SECONDS,
  summarizeCacheFreshness,
} from "./validationCacheMerge";

function entry(lastFullRunAt?: string): PageCacheEntry {
  return {
    lastRunAt: lastFullRunAt ?? new Date().toISOString(),
    lastFullRunAt,
    errors: [],
    warnings: [],
  };
}

describe("summarizeCacheFreshness", () => {
  const now = Date.parse("2026-08-18T20:00:00.000Z");
  const maxAge = CACHE_FRESHNESS_MAX_AGE_SECONDS;

  it("counts fresh, expired, and missing lastFullRunAt", () => {
    const freshAt = new Date(now - 60 * 60 * 1000).toISOString();
    const staleAt = new Date(now - (maxAge + 1) * 1000).toISOString();
    const summary = summarizeCacheFreshness(
      [entry(freshAt), entry(staleAt), entry(undefined), undefined],
      maxAge,
      now,
    );
    expect(summary).toEqual({
      fresh: 1,
      stale: 3,
      total: 4,
      max_age_seconds: maxAge,
    });
  });

  it("treats a timestamp exactly at max_age as fresh", () => {
    const atLimit = new Date(now - maxAge * 1000).toISOString();
    const summary = summarizeCacheFreshness([entry(atLimit)], maxAge, now);
    expect(summary.fresh).toBe(1);
    expect(summary.stale).toBe(0);
  });

  it("returns zeros for an empty cache", () => {
    expect(summarizeCacheFreshness([], maxAge, now)).toEqual({
      fresh: 0,
      stale: 0,
      total: 0,
      max_age_seconds: maxAge,
    });
  });
});
