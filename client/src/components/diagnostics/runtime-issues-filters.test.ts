import { describe, expect, it } from "vitest";
import { incrementByHour } from "@shared/runtime-issues";
import {
  FILTER_ALL,
  applyRuntimeIssueView,
  deviceLabel,
  filterRuntimeIssues,
  isAssetPath,
  sortDevices,
  type RuntimeIssueFilters,
} from "./runtime-issues-filters";

function row(
  overrides: Partial<{
    fingerprint: string;
    path: string;
    locale: string;
    sampleReferrer?: string;
    uaBucket?: string;
    sources?: string[];
    count: number;
    lastSeen: number;
    byHour?: ReturnType<typeof incrementByHour>;
  }> = {},
) {
  const lastSeen = overrides.lastSeen ?? Date.now();
  return {
    fingerprint: overrides.fingerprint ?? "fp",
    path: overrides.path ?? "/es/missing",
    locale: overrides.locale ?? "es",
    sampleReferrer: overrides.sampleReferrer,
    uaBucket: overrides.uaBucket,
    sources: overrides.sources,
    count: overrides.count ?? 1,
    lastSeen,
    byHour: overrides.byHour,
  };
}

const none: RuntimeIssueFilters = {
  pathQuery: "",
  referrerQuery: "",
  locale: FILTER_ALL,
  device: FILTER_ALL,
  pagesOnly: false,
  windowDays: 30,
  tz: "UTC",
  source: FILTER_ALL,
};

describe("filterRuntimeIssues", () => {
  const issues = [
    row({
      fingerprint: "a",
      path: "/es/us/old-blog",
      locale: "es",
      sampleReferrer: "https://google.com/search",
      uaBucket: "mobile",
    }),
    row({
      fingerprint: "b",
      path: "/en/pricing",
      locale: "en",
      sampleReferrer: "https://4geeks.com/es",
      uaBucket: "desktop",
    }),
    row({ fingerprint: "c", path: "/en/missing-page", locale: "en", uaBucket: "unknown" }),
  ];

  it("returns all rows when filters are empty", () => {
    expect(filterRuntimeIssues(issues, none)).toHaveLength(3);
  });

  it("matches path by case-insensitive substring", () => {
    const filtered = filterRuntimeIssues(issues, { ...none, pathQuery: "PRICING" });
    expect(filtered.map((i) => i.fingerprint)).toEqual(["b"]);
  });

  it("matches referrer by case-insensitive substring", () => {
    const filtered = filterRuntimeIssues(issues, { ...none, referrerQuery: "google" });
    expect(filtered.map((i) => i.fingerprint)).toEqual(["a"]);
  });

  it("excludes rows with no referrer when a referrer query is set", () => {
    const filtered = filterRuntimeIssues(issues, { ...none, referrerQuery: "4geeks" });
    expect(filtered.map((i) => i.fingerprint)).toEqual(["b"]);
  });

  it("filters by locale", () => {
    const filtered = filterRuntimeIssues(issues, { ...none, locale: "en" });
    expect(filtered.map((i) => i.fingerprint)).toEqual(["b", "c"]);
  });

  it("filters by device, treating missing uaBucket as unknown", () => {
    const withMissingUa = [...issues, row({ fingerprint: "d", path: "/x", locale: "en" })];
    const filtered = filterRuntimeIssues(withMissingUa, { ...none, device: "unknown" });
    expect(filtered.map((i) => i.fingerprint)).toEqual(["c", "d"]);
  });

  it("applies filters together", () => {
    const filtered = filterRuntimeIssues(issues, {
      ...none,
      pathQuery: "/en",
      locale: "en",
      device: "desktop",
    });
    expect(filtered.map((i) => i.fingerprint)).toEqual(["b"]);
  });

  it("pagesOnly hides asset paths except internal", () => {
    const mixed = [
      ...issues,
      row({ fingerprint: "js", path: "/assets/index-abc.js" }),
      row({ fingerprint: "img", path: "/og-image.png" }),
      row({ fingerprint: "gif", path: "/static/images/loader.gif", sources: ["internal"] }),
      row({ fingerprint: "page", path: "/en/ai-2.0" }),
    ];
    const filtered = filterRuntimeIssues(mixed, { ...none, pagesOnly: true });
    expect(filtered.map((i) => i.fingerprint)).toEqual(["a", "b", "c", "gif", "page"]);
  });

  it("windowDays 7 hides a path that only has hits 20 days ago", () => {
    const now = Date.UTC(2026, 7, 14, 12, 0, 0);
    const oldTs = Date.UTC(2026, 6, 25, 12, 0, 0);
    const recentTs = Date.UTC(2026, 7, 13, 12, 0, 0);
    const old = row({
      fingerprint: "old",
      path: "/en/coding-bootcamp/old",
      lastSeen: oldTs,
      byHour: incrementByHour(undefined, oldTs, ["human"]),
    });
    const recent = row({
      fingerprint: "new",
      path: "/en/coding-bootcamp/new",
      lastSeen: recentTs,
      byHour: incrementByHour(undefined, recentTs, ["human"]),
    });
    const filtered = filterRuntimeIssues([old, recent], {
      ...none,
      pathQuery: "coding-bootcamp",
      windowDays: 7,
      now,
    });
    expect(filtered.map((i) => i.fingerprint)).toEqual(["new"]);
  });
});

describe("applyRuntimeIssueView", () => {
  it("filters then sorts so table and CSV share one pipeline", () => {
    const now = Date.now();
    const rows = [
      { fingerprint: "low", path: "/en/a", locale: "en", count: 1, lastSeen: now },
      { fingerprint: "high", path: "/en/b", locale: "en", count: 9, lastSeen: now },
      { fingerprint: "es", path: "/es/c", locale: "es", count: 50, lastSeen: now },
    ];
    const result = applyRuntimeIssueView(rows, { ...none, locale: "en" }, "count", "desc");
    expect(result.map((i) => i.fingerprint)).toEqual(["high", "low"]);
  });

  it("sets count to the window sum", () => {
    const now = Date.UTC(2026, 7, 14, 12, 0, 0);
    const oldTs = Date.UTC(2026, 6, 25, 12, 0, 0);
    const recentTs = Date.UTC(2026, 7, 13, 12, 0, 0);
    let byHour = incrementByHour(undefined, oldTs, ["human"]);
    byHour = incrementByHour(byHour, recentTs, ["human"]);
    const result = applyRuntimeIssueView(
      [row({ fingerprint: "mix", path: "/en/x", lastSeen: recentTs, count: 2, byHour })],
      { ...none, windowDays: 7, now },
      "count",
      "desc",
    );
    expect(result[0]?.count).toBe(1);
    expect(result[0]?.count30).toBe(2);
  });
});

describe("isAssetPath", () => {
  it("detects common static file extensions on the last segment", () => {
    expect(isAssetPath("/assets/app.js")).toBe(true);
    expect(isAssetPath("/hero.webp")).toBe(true);
    expect(isAssetPath("/chunk.js.map")).toBe(true);
    expect(isAssetPath("/en/blog/old-slug")).toBe(false);
    expect(isAssetPath("/en/ai-2.0")).toBe(false);
  });
});

describe("sortDevices", () => {
  it("orders known buckets desktop → mobile → unknown", () => {
    expect(sortDevices(["unknown", "desktop", "mobile", "search_crawler"])).toEqual([
      "desktop",
      "mobile",
      "unknown",
    ]);
  });
});

describe("deviceLabel", () => {
  it("humanizes known buckets", () => {
    expect(deviceLabel("likely_bot")).toBe("Likely bot");
    expect(deviceLabel("custom")).toBe("custom");
  });
});
