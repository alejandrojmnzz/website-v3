import { describe, expect, it } from "vitest";
import { classifyClusterEntry, computeClusterHealth } from "./seo-cluster-stats";
import type { SeoIndex, SeoIndexEntry } from "./seo-index";

function row(partial: Partial<SeoIndexEntry> & { slug: string }): SeoIndexEntry {
  return {
    content_type: "blog",
    slug: partial.slug,
    locale: "en",
    file: "blog/x/en.yml",
    path: "/en/blog/x",
    main_keyword: null,
    is_pillar: false,
    pillar_path: null,
    pillar_live: null,
    ...partial,
  };
}

function emptyIndex(entries: Record<string, SeoIndexEntry> = {}): SeoIndex {
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    rebuilt: true,
    entries,
    by_path: {},
    clusters: {},
    orphans: [],
    warnings: [],
  };
}

describe("classifyClusterEntry", () => {
  it("classifies hub, clustered, partially set, unclustered, opted out, broken", () => {
    const orphans = new Set(["blog/broken/en"]);
    expect(classifyClusterEntry(row({ slug: "hub", is_pillar: true }), orphans)).toBe("hub");
    expect(
      classifyClusterEntry(row({ slug: "spoke", pillar_path: "/en/hub" }), orphans),
    ).toBe("clustered");
    expect(
      classifyClusterEntry(row({ slug: "kw", main_keyword: "javascript", pillar_path: "" }), orphans),
    ).toBe("partiallySet");
    expect(classifyClusterEntry(row({ slug: "bare", pillar_path: "" }), orphans)).toBe("unclustered");
    expect(
      classifyClusterEntry(row({ slug: "solo", pillar_opted_out: true, main_keyword: "x" }), orphans),
    ).toBe("optedOut");
    expect(
      classifyClusterEntry(row({ slug: "broken", pillar_path: "/en/missing" }), orphans),
    ).toBe("brokenRef");
  });
});

describe("computeClusterHealth", () => {
  it("counts no-signal monitored gaps as unclustered and keeps opted-out separate", () => {
    const opted = row({
      slug: "opted",
      pillar_opted_out: true,
      main_keyword: "solo topic",
      pillar_path: null,
    });
    const partial = row({
      slug: "partial",
      main_keyword: "javascript",
      pillar_path: "",
    });
    const clustered = row({
      slug: "spoke",
      pillar_path: "/en/hub",
      main_keyword: "hub topic",
    });
    const index = emptyIndex({
      "blog/opted/en": opted,
      "blog/partial/en": partial,
      "blog/spoke/en": clustered,
    });

    const health = computeClusterHealth(index, undefined, [
      { contentType: "blog", slug: "missing-seo", locale: "en" },
      { contentType: "blog", slug: "also-bare", locale: "es" },
    ]);

    expect(health.stats.unclustered).toBe(2);
    expect(health.stats.optedOut).toBe(1);
    expect(health.stats.partiallySet).toBe(1);
    expect(health.stats.clustered).toBe(1);
    expect(health.byContentType.blog.unclustered).toBe(2);
    expect(health.byLocale.en.unclustered).toBe(1);
    expect(health.byLocale.es.unclustered).toBe(1);
  });

  it("does not double-count a gap that already has an index entry", () => {
    const bare = row({ slug: "bare", pillar_path: "" });
    const index = emptyIndex({ "blog/bare/en": bare });
    const health = computeClusterHealth(index, undefined, [
      { contentType: "blog", slug: "bare", locale: "en" },
    ]);
    expect(health.stats.unclustered).toBe(1);
  });

  it("counts bare index rows as unclustered without gaps", () => {
    const bare = row({ slug: "bare", pillar_path: "" });
    const health = computeClusterHealth(emptyIndex({ "blog/bare/en": bare }));
    expect(health.stats.unclustered).toBe(1);
    expect(health.stats.optedOut).toBe(0);
  });
});
