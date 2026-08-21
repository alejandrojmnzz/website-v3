import { describe, it, expect } from "vitest";
import {
  SEO_CLUSTER_MONITORING_DISABLED_WARNING,
  SEO_INCLUDE_IN_CLUSTERING,
  SEO_IS_PILLAR,
  SEO_PILLAR_PATH,
  deriveIncludeInClustering,
  expandSeoClusterToggle,
} from "./seo-cluster-toggle";

const monitored = { monitoringEnabled: true as const };

describe("deriveIncludeInClustering", () => {
  it("treats missing seo / missing pillar_path as included", () => {
    expect(deriveIncludeInClustering(undefined)).toBe(true);
    expect(deriveIncludeInClustering({})).toBe(true);
    expect(deriveIncludeInClustering({ pillar_path: "" })).toBe(true);
    expect(deriveIncludeInClustering({ pillar_path: "/en/hub" })).toBe(true);
  });

  it("treats explicit null as opted out", () => {
    expect(deriveIncludeInClustering({ pillar_path: null })).toBe(false);
  });
});

describe("expandSeoClusterToggle", () => {
  it("passes through without virtual field", () => {
    const updates = [{ field_path: "seo.main_keyword", value: "js" }];
    const r = expandSeoClusterToggle({ contentType: "blog", updates, ...monitored });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.updates).toEqual(updates);
    expect(r.cluster_monitoring_disabled).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  it("warns on raw pillar_path null without virtual field", () => {
    const r = expandSeoClusterToggle({
      contentType: "blog",
      updates: [{ field_path: SEO_PILLAR_PATH, value: null }],
      ...monitored,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cluster_monitoring_disabled).toBe(true);
    expect(r.warnings).toEqual([SEO_CLUSTER_MONITORING_DISABLED_WARNING]);
  });

  it("expands off to pillar_path null + is_pillar false", () => {
    const r = expandSeoClusterToggle({
      contentType: "blog",
      updates: [{ field_path: SEO_INCLUDE_IN_CLUSTERING, value: false }],
      currentSeo: { pillar_path: "/en/hub", is_pillar: true },
      ...monitored,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cluster_monitoring_disabled).toBe(true);
    expect(r.updates).toEqual([
      { field_path: SEO_PILLAR_PATH, value: null },
      { field_path: SEO_IS_PILLAR, value: false },
    ]);
    expect(r.warnings[0]?.code).toBe("seo_cluster_monitoring_disabled");
  });

  it("rejects false with non-null pillar_path in same call", () => {
    const r = expandSeoClusterToggle({
      contentType: "blog",
      updates: [
        { field_path: SEO_INCLUDE_IN_CLUSTERING, value: false },
        { field_path: SEO_PILLAR_PATH, value: "/en/hub" },
      ],
      ...monitored,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect(r.code).toBe("seo_cluster_toggle_conflict");
  });

  it("allows false with explicit pillar_path null in same call", () => {
    const r = expandSeoClusterToggle({
      contentType: "blog",
      updates: [
        { field_path: SEO_INCLUDE_IN_CLUSTERING, value: false },
        { field_path: SEO_PILLAR_PATH, value: null },
      ],
      ...monitored,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.updates.find((u) => u.field_path === SEO_PILLAR_PATH)?.value).toBeNull();
  });

  it("turns on when current seo already has pillar_path", () => {
    const r = expandSeoClusterToggle({
      contentType: "blog",
      updates: [{ field_path: SEO_INCLUDE_IN_CLUSTERING, value: true }],
      currentSeo: { pillar_path: "/en/blog/hub" },
      ...monitored,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.updates).toEqual([]);
    expect(r.cluster_monitoring_disabled).toBe(false);
  });

  it("turns on with is_pillar true in same call", () => {
    const r = expandSeoClusterToggle({
      contentType: "blog",
      updates: [
        { field_path: SEO_INCLUDE_IN_CLUSTERING, value: true },
        { field_path: SEO_IS_PILLAR, value: true },
      ],
      currentSeo: { pillar_path: null },
      ...monitored,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.updates).toEqual([{ field_path: SEO_IS_PILLAR, value: true }]);
  });

  it("turns on with non-empty pillar_path in same call", () => {
    const r = expandSeoClusterToggle({
      contentType: "blog",
      updates: [
        { field_path: SEO_INCLUDE_IN_CLUSTERING, value: true },
        { field_path: SEO_PILLAR_PATH, value: "/en/hub" },
      ],
      currentSeo: {},
      ...monitored,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.updates.some((u) => u.field_path === SEO_PILLAR_PATH)).toBe(true);
  });

  it("action_required when on without membership", () => {
    const r = expandSeoClusterToggle({
      contentType: "blog",
      slug: "lonely",
      locale: "en",
      updates: [{ field_path: SEO_INCLUDE_IN_CLUSTERING, value: true }],
      currentSeo: { pillar_path: null },
      ...monitored,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("action_required");
    if (r.kind !== "action_required") return;
    expect(r.action_required).toBe("seo_cluster_membership_required");
    expect(r.next_actions[0]?.tool).toBe("update_fields");
  });

  it("fails when type not monitored", () => {
    const r = expandSeoClusterToggle({
      contentType: "lesson",
      updates: [{ field_path: SEO_INCLUDE_IN_CLUSTERING, value: false }],
      monitoringEnabled: false,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect(r.code).toBe("seo_type_not_monitored");
  });

  it("rejects non-boolean virtual value", () => {
    const r = expandSeoClusterToggle({
      contentType: "blog",
      updates: [{ field_path: SEO_INCLUDE_IN_CLUSTERING, value: "yes" }],
      ...monitored,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect(r.code).toBe("seo_include_in_clustering_invalid");
  });
});
