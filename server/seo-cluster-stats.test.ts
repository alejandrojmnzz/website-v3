import { describe, expect, it } from "vitest";
import { classifyClusterEntry } from "./seo-cluster-stats";
import type { SeoIndexEntry } from "./seo-index";

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
