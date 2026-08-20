/**
 * Cluster health buckets and stats derived from seo-index.json
 * plus monitored pages with no SEO signal (Unclustered gap).
 */

import type { ContentIndex } from "./content-index";
import { contentIndex } from "./content-index";
import { createPublicUrlResolver } from "./redirects";
import type { MonitoredSeoGap } from "./seo-monitored-scan";
import type { SeoIndex, SeoIndexEntry } from "./seo-index";

export type ClusterBucket =
  | "hub"
  | "clustered"
  | "unclustered"
  | "partiallySet"
  | "optedOut"
  | "brokenRef";

export type BrokenClusterRefReason = "hub_not_found" | "hub_not_pillar";

export type ClusterBucketCounts = {
  unclustered: number;
  partiallySet: number;
  brokenRefs: number;
  optedOut: number;
  clustered: number;
  hub: number;
};

export type ClusterHealth = {
  emptyHubCount: number;
  stats: ClusterBucketCounts;
  byContentType: Record<string, ClusterBucketCounts>;
  byLocale: Record<string, ClusterBucketCounts>;
};

function emptyCounts(): ClusterBucketCounts {
  return {
    unclustered: 0,
    partiallySet: 0,
    brokenRefs: 0,
    optedOut: 0,
    clustered: 0,
    hub: 0,
  };
}

function bump(target: ClusterBucketCounts, bucket: ClusterBucket): void {
  if (bucket === "hub") target.hub++;
  else if (bucket === "clustered") target.clustered++;
  else if (bucket === "unclustered") target.unclustered++;
  else if (bucket === "partiallySet") target.partiallySet++;
  else if (bucket === "optedOut") target.optedOut++;
  else if (bucket === "brokenRef") target.brokenRefs++;
}

export function classifyClusterEntry(
  row: SeoIndexEntry,
  orphanIds: Set<string>,
): ClusterBucket {
  const id = `${row.content_type}/${row.slug}/${row.locale}`;
  if (row.is_pillar) return "hub";
  if (orphanIds.has(id)) return "brokenRef";
  if (row.pillar_opted_out || row.pillar_path === null) {
    return "optedOut";
  }
  const pp = typeof row.pillar_path === "string" ? row.pillar_path.trim() : "";
  if (pp) return "clustered";
  const kw = typeof row.main_keyword === "string" ? row.main_keyword.trim() : "";
  if (kw) return "partiallySet";
  return "unclustered";
}

export function resolveBrokenClusterRefReason(
  index: SeoIndex,
  row: SeoIndexEntry,
  ci: ContentIndex = contentIndex,
): BrokenClusterRefReason {
  const pp = typeof row.pillar_path === "string" ? row.pillar_path.trim() : "";
  if (!pp) return "hub_not_found";
  const id = `${row.content_type}/${row.slug}/${row.locale}`;
  if (!index.orphans.includes(id)) return "hub_not_found";
  if (index.by_path[pp]) return "hub_not_found";

  const resolver = createPublicUrlResolver(ci, { freshRedirects: true });
  const live = resolver.isLive(pp, row.locale);
  if (live) {
    const hubEntry = Object.values(index.entries).find(
      (e) => e.is_pillar && (e.path === pp || e.pillar_path === pp),
    );
    if (!hubEntry) return "hub_not_pillar";
  }
  return "hub_not_found";
}

function bumpUnclusteredGap(
  stats: ClusterBucketCounts,
  byContentType: Record<string, ClusterBucketCounts>,
  byLocale: Record<string, ClusterBucketCounts>,
  gap: MonitoredSeoGap,
): void {
  bump(stats, "unclustered");
  const ct = gap.contentType || "unknown";
  if (!byContentType[ct]) byContentType[ct] = emptyCounts();
  bump(byContentType[ct], "unclustered");
  const loc = gap.locale || "en";
  if (!byLocale[loc]) byLocale[loc] = emptyCounts();
  bump(byLocale[loc], "unclustered");
}

/**
 * @param noSignalGaps Monitored pages with no effective SEO signal (not in index entries).
 *   Opted-out index rows stay in optedOut and must not be passed here.
 */
export function computeClusterHealth(
  index: SeoIndex,
  ci: ContentIndex = contentIndex,
  noSignalGaps: MonitoredSeoGap[] = [],
): ClusterHealth {
  const orphanIds = new Set(index.orphans);
  const stats = emptyCounts();
  const byContentType: Record<string, ClusterBucketCounts> = {};
  const byLocale: Record<string, ClusterBucketCounts> = {};

  for (const row of Object.values(index.entries)) {
    const bucket = classifyClusterEntry(row, orphanIds);
    bump(stats, bucket);

    const ct = row.content_type || "unknown";
    if (!byContentType[ct]) byContentType[ct] = emptyCounts();
    bump(byContentType[ct], bucket);

    const loc = row.locale || "en";
    if (!byLocale[loc]) byLocale[loc] = emptyCounts();
    bump(byLocale[loc], bucket);
  }

  for (const gap of noSignalGaps) {
    const id = `${gap.contentType}/${gap.slug}/${gap.locale}`;
    if (index.entries[id]) continue;
    bumpUnclusteredGap(stats, byContentType, byLocale, gap);
  }

  let emptyHubCount = 0;
  for (const cluster of Object.values(index.clusters)) {
    if (!cluster.members.length) emptyHubCount++;
  }

  return { emptyHubCount, stats, byContentType, byLocale };
}

export type BrokenClusterRefRow = {
  slug: string;
  contentType: string;
  locale: string;
  path: string;
  pillar_path: string;
  filePath: string;
  main_keyword: string | null;
  reason: BrokenClusterRefReason;
};

export function listBrokenClusterRefs(
  index: SeoIndex,
  ci: ContentIndex = contentIndex,
): BrokenClusterRefRow[] {
  return index.orphans.map((id) => {
    const row = index.entries[id];
    const parts = id.split("/");
    const reason = row
      ? resolveBrokenClusterRefReason(index, row, ci)
      : ("hub_not_found" as const);
    return {
      slug: row?.slug || parts[1] || id,
      contentType: row?.content_type || parts[0] || "",
      locale: row?.locale || parts[2] || "en",
      path: row?.path || "",
      pillar_path: typeof row?.pillar_path === "string" ? row.pillar_path : "",
      filePath: row?.file || "",
      main_keyword: row?.main_keyword ?? null,
      reason,
    };
  });
}
